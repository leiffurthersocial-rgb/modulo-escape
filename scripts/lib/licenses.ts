import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AssetSource = 'polyhaven' | 'ambientcg' | 'sketchfab';
export type AssetKind = 'texture' | 'model' | 'hdri';

export interface LicenseEntry {
  id: string;
  source: AssetSource;
  kind: AssetKind;
  category: string;
  name: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  attributionRequired: boolean;
}

export const LICENSES_PATH = join(process.cwd(), 'assets', 'LICENSES.json');

export async function readLicenses(): Promise<LicenseEntry[]> {
  try {
    return JSON.parse(await readFile(LICENSES_PATH, 'utf8')) as LicenseEntry[];
  } catch {
    return [];
  }
}

export async function upsertLicense(entry: LicenseEntry): Promise<void> {
  const all = await readLicenses();
  const key = (e: LicenseEntry) => `${e.source}:${e.id}`;
  const next = all.filter((e) => key(e) !== key(entry));
  next.push(entry);
  next.sort((a, b) => key(a).localeCompare(key(b)));
  await writeFile(LICENSES_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

/** Only these licences may ship. Anything else is rejected at fetch time. */
export const ALLOWED_LICENSES: Record<string, { label: string; url: string; attribution: boolean }> = {
  cc0: { label: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: false },
  by: { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution: true },
};
