/** Runtime view of public/assets/manifest.json (written by scripts/process-assets.ts). */
export interface TexTier {
  albedo: string;
  normal: string;
  orm: string;
  bytes: number;
  px: number;
}
export interface Manifest {
  generated: string;
  textures: Record<string, { category: string; source: string; tiers: Record<string, TexTier> }>;
  models: Record<string, { category: string; source: string; url: string; bytes: number; triangles: number }>;
  hdris: Record<string, { category: string; tiers: Record<string, { url: string; bytes: number }> }>;
}

export type TexTierName = '512' | '1k' | '2k' | '4k';
export const TIER_ORDER: TexTierName[] = ['512', '1k', '2k', '4k'];

let cached: Promise<Manifest> | null = null;

/** Loads the manifest once. Resolves to an empty manifest if assets were never processed. */
export function loadManifest(): Promise<Manifest> {
  cached ??= fetch('/assets/manifest.json')
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error(String(r.status)))))
    .catch(() => ({ generated: '', textures: {}, models: {}, hdris: {} }));
  return cached;
}

/** Best available tier ≤ wanted (falls back upward if nothing smaller exists). */
export function pickTier(tiers: Record<string, unknown>, wanted: TexTierName): string | null {
  const have = TIER_ORDER.filter((t) => t in tiers);
  if (!have.length) return null;
  const le = have.filter((t) => TIER_ORDER.indexOf(t) <= TIER_ORDER.indexOf(wanted));
  return le.length ? le[le.length - 1]! : have[0]!;
}

/** GPU memory estimate for one PBR set at px: ASTC/BC7-class 1 B/px for UASTC, ~0.5–1 B/px for ETC1S → BC1/ETC2; +33% mips. */
export function vramEstimateBytes(px: number): number {
  const albedo = px * px * 1; // ETC1S → BC7/ASTC on most GPUs (worst case 1 B/px)
  const normal = px * px * 1;
  const orm = px * px * 1;
  return Math.round((albedo + normal + orm) * 1.333);
}
