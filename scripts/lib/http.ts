/**
 * Polite HTTP helper for the asset scripts:
 * - descriptive User-Agent
 * - per-host rate limit (min interval between requests)
 * - retry with exponential backoff on 429 / 5xx / network errors
 * - on-disk cache for API JSON (.asset-cache/api) and downloads (.asset-cache/files)
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const CACHE_DIR = join(process.cwd(), '.asset-cache');
export const USER_AGENT =
  'ModuloEscape-AssetFetcher/0.1 (indie browser game build script; +https://github.com/leiffurthersocial-rgb/modulo-escape)';

const MIN_INTERVAL_MS = Number(process.env.ASSET_MIN_INTERVAL_MS ?? 500);
const lastRequestAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(url: string): Promise<void> {
  const host = new URL(url).host;
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

export async function politeFetch(url: string, init: RequestInit = {}, retries = 4): Promise<Response> {
  let delay = 2000;
  for (let attempt = 0; ; attempt++) {
    await throttle(url);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
        redirect: 'follow',
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= retries) return res;
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
        delay *= 2;
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(delay);
      delay *= 2;
    }
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** GET JSON with an on-disk cache (default TTL 7 days). */
export async function cachedJson<T>(url: string, init: RequestInit = {}, ttlMs = 7 * 864e5): Promise<T> {
  const file = join(CACHE_DIR, 'api', `${sha(url)}.json`);
  if (await exists(file)) {
    const s = await stat(file);
    if (Date.now() - s.mtimeMs < ttlMs) return JSON.parse(await readFile(file, 'utf8')) as T;
  }
  const res = await politeFetch(url, init);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const text = await res.text();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return JSON.parse(text) as T;
}

/** Download a file into the cache (skipped when already present). Returns the local path. */
export async function cachedDownload(url: string, relPath: string, init: RequestInit = {}): Promise<string> {
  const file = join(CACHE_DIR, 'files', relPath);
  if (await exists(file)) return file;
  const res = await politeFetch(url, init);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.part`, buf);
  await rename(`${file}.part`, file);
  return file;
}
