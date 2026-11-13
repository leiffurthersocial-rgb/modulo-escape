/**
 * fetch-assets — download candidate/selected assets into .asset-cache/ and record licences.
 *
 * Usage:
 *   tsx scripts/fetch-assets.ts search polyhaven textures concrete     # category search
 *   tsx scripts/fetch-assets.ts search ambientcg textures "wet concrete"
 *   tsx scripts/fetch-assets.ts search polyhaven models props
 *   tsx scripts/fetch-assets.ts search sketchfab models "school chair"  # CC0 / CC-BY only
 *   tsx scripts/fetch-assets.ts fetch [--res 2k] [--only <id>] [--dry-run]
 *
 * `fetch` downloads every entry of assets/asset-sources.json and writes assets/LICENSES.json.
 * Sketchfab downloads need an API token: set SKETCHFAB_API_TOKEN (or have the cloud proxy inject it).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cachedDownload, cachedJson, CACHE_DIR } from './lib/http.ts';
import { ALLOWED_LICENSES, upsertLicense, type AssetKind, type AssetSource } from './lib/licenses.ts';

export interface SourceEntry {
  source: AssetSource;
  id: string;
  kind: AssetKind;
  /** Game category, e.g. concrete, plaster, metal, wetfloor, moss, brick, rubble, prop:barrel */
  category: string;
  /** Override download resolution ("1k" | "2k" | "4k") */
  res?: string;
  /** Texture tiers to ship (process step). Default 512 + 1k. */
  tiers?: string[];
  /** Models: max texture size, and meshoptimizer simplify ratio (0..1). */
  textureSize?: number;
  simplify?: number;
  /** Models: keep only the nodes whose name contains one of these (files that bundle several objects). */
  keep?: string[];
  /** source 'url': direct download plus the licence facts we verified by hand. */
  url?: string;
  name?: string;
  author?: string;
  license?: 'cc0' | 'by';
  sourceUrl?: string;
}

const SOURCES_PATH = join(process.cwd(), 'assets', 'asset-sources.json');
const PH = 'https://api.polyhaven.com';
const ACG = 'https://ambientcg.com/api/v2/full_json';
const SF = 'https://api.sketchfab.com/v3';

// ───────────────────────────── Poly Haven ─────────────────────────────

interface PhInfo {
  name: string;
  type: number;
  categories: string[];
  tags: string[];
  authors: Record<string, string>;
  max_resolution?: [number, number];
}
interface PhFile { url: string; size: number; md5: string }
type PhFiles = Record<string, unknown>;

async function phSearch(kind: string, category: string) {
  const t = kind === 'models' ? 'models' : kind === 'hdris' ? 'hdris' : 'textures';
  const list = await cachedJson<Record<string, PhInfo>>(`${PH}/assets?t=${t}&c=${encodeURIComponent(category)}`);
  for (const [id, info] of Object.entries(list)) {
    console.log(`${id.padEnd(36)} ${info.name.padEnd(36)} max=${info.max_resolution?.join('x') ?? '?'}  [${info.categories.join(', ')}]`);
  }
  console.log(`${Object.keys(list).length} results`);
}

/**
 * Pick the map files Poly Haven offers for a texture at the requested resolution.
 * JPG for colour/ORM (it gets recompressed anyway), PNG for normals (JPG blocks show up as bumps).
 * Separate rough/AO are only fetched when no packed ARM (= ORM) map exists.
 */
function phTextureMaps(files: PhFiles, res: string): Record<string, PhFile> {
  const pick = (key: string, prefer: 'jpg' | 'png'): PhFile | undefined => {
    const entry = (files[key] as Record<string, Record<string, PhFile>> | undefined)?.[res];
    return prefer === 'png' ? (entry?.png ?? entry?.jpg) : (entry?.jpg ?? entry?.png);
  };
  const out: Record<string, PhFile> = {};
  const albedo = pick('Diffuse', 'jpg') ?? pick('diff', 'jpg');
  const normal = pick('nor_gl', 'png');
  const arm = pick('arm', 'jpg');
  if (albedo) out.albedo = albedo;
  if (normal) out.normal = normal;
  if (arm) out.arm = arm;
  else {
    const rough = pick('Rough', 'jpg') ?? pick('rough', 'jpg');
    const ao = pick('AO', 'jpg') ?? pick('ao', 'jpg');
    if (rough) out.rough = rough;
    if (ao) out.ao = ao;
  }
  return out;
}

async function phFetch(e: SourceEntry, res: string, dry: boolean) {
  const info = await cachedJson<PhInfo>(`${PH}/info/${e.id}`);
  const files = await cachedJson<PhFiles>(`${PH}/files/${e.id}`);
  const dir = `polyhaven/${e.id}/${res}`;
  if (e.kind === 'texture') {
    const maps = phTextureMaps(files, res);
    if (!maps.albedo || !maps.normal) throw new Error(`${e.id}: missing albedo/normal at ${res}`);
    for (const [map, f] of Object.entries(maps)) {
      const ext = f.url.split('.').pop();
      if (dry) console.log(`  would download ${map} ${(f.size / 1e6).toFixed(1)} MB`);
      else await cachedDownload(f.url, `${dir}/${map}.${ext}`);
    }
  } else if (e.kind === 'hdri') {
    const f = (files.hdri as Record<string, Record<string, PhFile>>)[res]?.hdr;
    if (!f) throw new Error(`${e.id}: no hdr at ${res}`);
    if (!dry) await cachedDownload(f.url, `${dir}/${e.id}.hdr`);
  } else {
    const g = (files.gltf as Record<string, { gltf: PhFile & { include: Record<string, PhFile> } }>)[res]?.gltf;
    if (!g) throw new Error(`${e.id}: no gltf at ${res}`);
    if (!dry) {
      await cachedDownload(g.url, `${dir}/${e.id}.gltf`);
      for (const [rel, f] of Object.entries(g.include)) await cachedDownload(f.url, `${dir}/${rel}`);
    }
  }
  const authors = Object.keys(info.authors).join(', ');
  await upsertLicense({
    id: e.id,
    source: 'polyhaven',
    kind: e.kind,
    category: e.category,
    name: info.name,
    sourceUrl: `https://polyhaven.com/a/${e.id}`,
    author: authors,
    license: ALLOWED_LICENSES.cc0!.label,
    licenseUrl: ALLOWED_LICENSES.cc0!.url,
    attributionRequired: false,
  });
}

// ───────────────────────────── ambientCG ─────────────────────────────

interface AcgDownload { attribute: string; downloadLink: string; fileName: string; size: number }
interface AcgAsset {
  assetId: string;
  displayName: string;
  dataType: string;
  tags: string[];
  downloadFolders?: { default?: { downloadFiletypeCategories?: { zip?: { downloads: AcgDownload[] } } } };
}

async function acgSearch(kind: string, q: string) {
  const type = kind === 'models' ? '3DModel' : kind === 'hdris' ? 'HDRI' : 'Material';
  const url = `${ACG}?type=${type}&q=${encodeURIComponent(q)}&limit=60&include=downloadData,tagData`;
  const d = await cachedJson<{ foundAssets: AcgAsset[] }>(url);
  for (const a of d.foundAssets) {
    const dl = a.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? [];
    const sizes = dl.filter((x) => /JPG$/.test(x.attribute)).map((x) => `${x.attribute}:${(x.size / 1e6).toFixed(0)}MB`);
    console.log(`${a.assetId.padEnd(24)} ${a.displayName.padEnd(28)} ${sizes.join(' ')}`);
  }
  console.log(`${d.foundAssets.length} results`);
}

async function acgFetch(e: SourceEntry, res: string, dry: boolean) {
  const url = `${ACG}?id=${encodeURIComponent(e.id)}&include=downloadData`;
  const d = await cachedJson<{ foundAssets: AcgAsset[] }>(url);
  const a = d.foundAssets[0];
  if (!a) throw new Error(`ambientCG: ${e.id} not found`);
  const attr = `${res.toUpperCase()}-JPG`;
  const dl = a.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads.find((x) => x.attribute === attr);
  if (!dl) throw new Error(`ambientCG: ${e.id} has no ${attr}`);
  const dir = `ambientcg/${e.id}/${res}`;
  if (dry) {
    console.log(`  would download ${dl.fileName} ${(dl.size / 1e6).toFixed(1)} MB`);
  } else {
    const zip = await cachedDownload(dl.downloadLink, `${dir}/${dl.fileName}`);
    const outDir = join(CACHE_DIR, 'files', dir, 'x');
    if (!existsSync(outDir)) {
      await mkdir(outDir, { recursive: true });
      execFileSync('unzip', ['-o', '-q', zip, '-d', outDir]);
    }
  }
  await upsertLicense({
    id: e.id,
    source: 'ambientcg',
    kind: e.kind,
    category: e.category,
    name: a.displayName,
    sourceUrl: `https://ambientcg.com/view?id=${e.id}`,
    author: 'ambientCG (Lennart Demes)',
    license: ALLOWED_LICENSES.cc0!.label,
    licenseUrl: ALLOWED_LICENSES.cc0!.url,
    attributionRequired: false,
  });
}

// ───────────────────────────── Sketchfab ─────────────────────────────

interface SfModel {
  uid: string;
  name: string;
  viewerUrl: string;
  faceCount: number;
  license: { label: string; slug?: string } | null;
  user: { username: string; displayName: string; profileUrl: string };
  archives?: { gltf?: { size: number; textureMaxResolution: number } };
}

/** Map a Sketchfab licence to our allow-list. Anything not CC0 / CC-BY returns null. */
function sfLicense(l: SfModel['license']): keyof typeof ALLOWED_LICENSES | null {
  if (!l) return null;
  const s = `${l.slug ?? ''} ${l.label}`.toLowerCase();
  if (s.includes('cc0') || s.includes('public domain')) return 'cc0';
  if (/\b(by-sa|by-nd|by-nc|sharealike|noderivs|non-?commercial|editorial|standard)\b/.test(s)) return null;
  if (s.includes('attribution') || /\bby\b/.test(s)) return 'by';
  return null;
}

function sfHeaders(): Record<string, string> {
  const t = process.env.SKETCHFAB_API_TOKEN;
  return t ? { Authorization: `Token ${t}` } : {};
}

async function sfSearch(q: string) {
  for (const lic of ['cc0', 'by']) {
    const url = `${SF}/search?type=models&q=${encodeURIComponent(q)}&downloadable=true&license=${lic}&count=24&sort_by=-likeCount`;
    const d = await cachedJson<{ results: SfModel[] }>(url);
    for (const m of d.results) {
      const ok = sfLicense(m.license);
      if (!ok) continue;
      console.log(
        `${m.uid}  ${m.name.slice(0, 34).padEnd(34)} ${String(m.faceCount).padStart(7)} tris  ${ALLOWED_LICENSES[ok]!.label.padEnd(8)} by ${m.user.username}`,
      );
    }
  }
}

async function sfFetch(e: SourceEntry, dry: boolean) {
  const m = await cachedJson<SfModel>(`${SF}/models/${e.id}`);
  const lic = sfLicense(m.license);
  if (!lic) throw new Error(`Sketchfab ${e.id}: licence "${m.license?.label}" is not CC0/CC-BY — refusing`);
  if (!dry) {
    // Download URLs are short-lived signed links, so this request is never cached.
    const res = await fetch(`${SF}/models/${e.id}/download`, { headers: sfHeaders() });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Sketchfab download needs an API token (SKETCHFAB_API_TOKEN). See SETUP.md.');
    }
    if (!res.ok) throw new Error(`Sketchfab download ${e.id}: ${res.status}`);
    const links = (await res.json()) as { gltf?: { url: string }; glb?: { url: string } };
    const link = links.glb?.url ?? links.gltf?.url;
    if (!link) throw new Error(`Sketchfab ${e.id}: no gltf/glb archive`);
    const isGlb = Boolean(links.glb?.url);
    const file = await cachedDownload(link, `sketchfab/${e.id}/${isGlb ? 'model.glb' : 'model.zip'}`);
    if (!isGlb) {
      const outDir = join(CACHE_DIR, 'files', `sketchfab/${e.id}/x`);
      if (!existsSync(outDir)) {
        await mkdir(outDir, { recursive: true });
        execFileSync('unzip', ['-o', '-q', file, '-d', outDir]);
      }
    }
  }
  const L = ALLOWED_LICENSES[lic]!;
  await upsertLicense({
    id: e.id,
    source: 'sketchfab',
    kind: 'model',
    category: e.category,
    name: m.name,
    sourceUrl: m.viewerUrl,
    author: `${m.user.displayName || m.user.username} (${m.user.profileUrl})`,
    license: L.label,
    licenseUrl: L.url,
    attributionRequired: L.attribution,
  });
}

// ───────────────────────────── direct URL (hand-verified licence) ─────────────────────────────

async function urlFetch(e: SourceEntry, dry: boolean) {
  if (!e.url || !e.license || !e.author || !e.sourceUrl) throw new Error(`${e.id}: url sources need url, license, author, sourceUrl`);
  const L = ALLOWED_LICENSES[e.license];
  if (!L) throw new Error(`${e.id}: licence ${e.license} not allowed`);
  const ext = e.url.split('?')[0]!.split('.').pop();
  if (!dry) await cachedDownload(e.url, `url/${e.id}/model.${ext}`);
  await upsertLicense({
    id: e.id,
    source: 'url',
    kind: e.kind,
    category: e.category,
    name: e.name ?? e.id,
    sourceUrl: e.sourceUrl,
    author: e.author,
    license: L.label,
    licenseUrl: L.url,
    attributionRequired: L.attribution,
  });
}

// ───────────────────────────── CLI ─────────────────────────────

async function readSources(): Promise<SourceEntry[]> {
  try {
    return JSON.parse(await readFile(SOURCES_PATH, 'utf8')) as SourceEntry[];
  } catch {
    return [];
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'search') {
    const [source, kind = 'textures', ...rest] = args;
    const q = rest.join(' ');
    if (source === 'polyhaven') return phSearch(kind, q || 'all');
    if (source === 'ambientcg') return acgSearch(kind, q);
    if (source === 'sketchfab') return sfSearch(q);
    throw new Error(`unknown source ${source}`);
  }
  if (cmd === 'fetch') {
    const defRes = flag(args, '--res') ?? '2k';
    const only = flag(args, '--only');
    const dry = args.includes('--dry-run');
    const sources = (await readSources()).filter((s) => !only || s.id === only);
    let ok = 0;
    const failed: string[] = [];
    for (const e of sources) {
      const res = e.res ?? (e.kind === 'model' ? '1k' : defRes);
      console.log(`[${e.source}] ${e.id} (${e.kind}, ${e.category}, ${res})`);
      try {
        if (e.source === 'polyhaven') await phFetch(e, res, dry);
        else if (e.source === 'ambientcg') await acgFetch(e, res, dry);
        else if (e.source === 'url') await urlFetch(e, dry);
        else await sfFetch(e, dry);
        ok++;
      } catch (err) {
        failed.push(`${e.id}: ${(err as Error).message}`);
        console.error(`  ✗ ${(err as Error).message}`);
      }
    }
    console.log(`\n${ok}/${sources.length} fetched.`);
    if (failed.length) console.log(`Failed:\n  ${failed.join('\n  ')}`);
    return;
  }
  if (cmd === 'cache') {
    const files = await readdir(join(CACHE_DIR, 'files'), { recursive: true }).catch(() => []);
    console.log(`${files.length} cached entries in ${CACHE_DIR}`);
    return;
  }
  console.log('usage: fetch-assets.ts search <polyhaven|ambientcg|sketchfab> <textures|models|hdris> <query> | fetch [--res 2k] [--only id] [--dry-run]');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
