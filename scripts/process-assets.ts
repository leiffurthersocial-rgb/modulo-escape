/**
 * process-assets — turn cached source assets into shippable, GPU-friendly files in public/assets/.
 *
 * Textures:  albedo → KTX2 ETC1S (sRGB)            small download, fine for colour
 *            normal → KTX2 UASTC + RDO + zstd       ETC1S wrecks normals
 *            ORM    → packed R=AO G=Rough B=Metal, KTX2 UASTC + RDO + zstd (linear)
 *            tiers  512 / 1k / 2k (shipped) and 4k (only with --tiers ...,4k)
 * Models:    glTF → GLB with meshopt geometry (or --draco), KTX2 textures capped at 1k, dedup/prune/weld.
 *
 * Output:    public/assets/tex/<id>/<map>_<tier>.<hash>.ktx2
 *            public/assets/models/<id>.<hash>.glb
 *            public/assets/manifest.json (urls + byte sizes per tier), plus a size report.
 *
 * Usage:     tsx scripts/process-assets.ts [--tiers 512,1k,2k] [--only <id>] [--draco]
 * Needs:     KTX-Software (toktx + ktx) on PATH, in tools/ktx/bin, or $KTX_BIN_DIR. See SETUP.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { CACHE_DIR } from './lib/http.ts';
import type { SourceEntry } from './fetch-assets.ts';

const ROOT = process.cwd();
const OUT = join(ROOT, 'public', 'assets');
const WORK = join(CACHE_DIR, 'work');
const TIER_PX: Record<string, number> = { '512': 512, '1k': 1024, '2k': 2048, '4k': 4096 };

// ───────── tool discovery ─────────
const KTX_DIR = [process.env.KTX_BIN_DIR, join(ROOT, 'tools', 'ktx', 'bin')].find((d) => d && existsSync(join(d, 'toktx')));
const TOOL_ENV = { ...process.env };
if (KTX_DIR) {
  TOOL_ENV.PATH = `${KTX_DIR}:${process.env.PATH}`;
  TOOL_ENV.LD_LIBRARY_PATH = `${join(KTX_DIR, '..', 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}`;
}
function run(cmd: string, args: string[]) {
  const out = execFileSync(cmd, args, { env: TOOL_ENV, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  // gltf-transform reports per-texture failures but still exits 0: treat them as errors.
  if (/\berror:/i.test(out)) throw new Error(`${cmd} ${args[0]} failed:\n${out.split('\n').filter((l) => /error|fatal/i.test(l)).join('\n')}`);
}

// ───────── manifest types (also read by the game at runtime) ─────────
export interface TexTier { albedo: string; normal: string; orm: string; bytes: number; px: number }
export interface Manifest {
  generated: string;
  textures: Record<string, { category: string; source: string; tiers: Record<string, TexTier> }>;
  hdris: Record<string, { category: string; tiers: Record<string, { url: string; bytes: number }> }>;
  models: Record<string, { category: string; source: string; url: string; bytes: number; triangles: number }>;
}

const sha8 = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 8);

async function emit(tmpFile: string, outRelNoExt: string, ext: string): Promise<{ url: string; bytes: number }> {
  const buf = await readFile(tmpFile);
  const rel = `${outRelNoExt}.${sha8(buf)}.${ext}`;
  const dst = join(OUT, rel);
  await mkdir(join(dst, '..'), { recursive: true });
  await copyFile(tmpFile, dst);
  return { url: `/assets/${rel}`, bytes: buf.length };
}

// ───────── texture source discovery ─────────
interface MapFiles { albedo: string; normal: string; arm?: string; rough?: string; ao?: string; metal?: string }

async function findMaps(e: SourceEntry): Promise<{ maps: MapFiles; res: string } | null> {
  const base = join(CACHE_DIR, 'files', e.source, e.id);
  if (!existsSync(base)) return null;
  const resDirs = (await readdir(base)).sort((a, b) => (TIER_PX[b] ?? 0) - (TIER_PX[a] ?? 0));
  for (const res of resDirs) {
    const dir = join(base, res);
    if (e.source === 'polyhaven') {
      const files = await readdir(dir);
      const f = (stem: string) => files.find((x) => x.startsWith(`${stem}.`));
      const albedo = f('albedo');
      const normal = f('normal');
      if (!albedo || !normal) continue;
      const maps: MapFiles = { albedo: join(dir, albedo), normal: join(dir, normal) };
      for (const k of ['arm', 'rough', 'ao'] as const) {
        const x = f(k);
        if (x) maps[k] = join(dir, x);
      }
      return { maps, res };
    }
    if (e.source === 'ambientcg') {
      const x = join(dir, 'x');
      if (!existsSync(x)) continue;
      const files = await readdir(x);
      const f = (suffix: string) => {
        const hit = files.find((n) => n.endsWith(`_${suffix}.jpg`) || n.endsWith(`_${suffix}.png`));
        return hit ? join(x, hit) : undefined;
      };
      const albedo = f('Color');
      const normal = f('NormalGL');
      if (!albedo || !normal) continue;
      const maps: MapFiles = { albedo, normal };
      const rough = f('Roughness');
      const ao = f('AmbientOcclusion');
      const metal = f('Metalness');
      if (rough) maps.rough = rough;
      if (ao) maps.ao = ao;
      if (metal) maps.metal = metal;
      return { maps, res };
    }
  }
  return null;
}

/** Build an ORM PNG (R=AO, G=Roughness, B=Metalness) at size px. */
async function buildOrm(m: MapFiles, px: number, out: string) {
  if (m.arm) {
    await sharp(m.arm).resize(px, px, { kernel: 'lanczos3' }).removeAlpha().png().toFile(out);
    return;
  }
  const chan = async (file: string | undefined, fill: number) =>
    file
      ? sharp(file).resize(px, px, { kernel: 'lanczos3' }).greyscale().extractChannel(0).raw().toBuffer()
      : Buffer.alloc(px * px, fill);
  const [ao, rough, metal] = await Promise.all([chan(m.ao, 255), chan(m.rough, 200), chan(m.metal, 0)]);
  const rgb = Buffer.alloc(px * px * 3);
  for (let i = 0; i < px * px; i++) {
    rgb[i * 3] = ao[i]!;
    rgb[i * 3 + 1] = rough[i]!;
    rgb[i * 3 + 2] = metal[i]!;
  }
  await sharp(rgb, { raw: { width: px, height: px, channels: 3 } }).png().toFile(out);
}

const ETC1S_SRGB = ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '200', '--genmipmap', '--assign_oetf', 'srgb'];
const ETC1S_LINEAR = ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '220', '--genmipmap', '--assign_oetf', 'linear'];
// Normals keep UASTC (ETC1S blocks read as bumps); RDO + zstd keeps the download small.
const UASTC_LINEAR = ['--t2', '--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '2.0', '--zcmp', '19', '--genmipmap', '--assign_oetf', 'linear'];

async function processTexture(e: SourceEntry, defaultTiers: string[], manifest: Manifest) {
  const tiers = e.tiers ?? defaultTiers;
  const found = await findMaps(e);
  if (!found) {
    console.warn(`  ✗ ${e.id}: no cached source maps (run assets:fetch first)`);
    return;
  }
  const srcPx = (await sharp(found.maps.albedo).metadata()).width ?? 0;
  const work = join(WORK, e.id);
  await mkdir(work, { recursive: true });
  const entry = (manifest.textures[e.id] = { category: e.category, source: e.source, tiers: {} as Record<string, TexTier> });
  for (const tier of tiers) {
    const px = TIER_PX[tier]!;
    if (px > srcPx) {
      console.log(`  - ${tier}: skipped (source is ${srcPx}px)`);
      continue;
    }
    const a = join(work, `albedo_${tier}.png`);
    const n = join(work, `normal_${tier}.png`);
    const o = join(work, `orm_${tier}.png`);
    await sharp(found.maps.albedo).resize(px, px, { kernel: 'lanczos3' }).removeAlpha().png().toFile(a);
    await sharp(found.maps.normal).resize(px, px, { kernel: 'lanczos3' }).removeAlpha().png().toFile(n);
    await buildOrm(found.maps, px, o);
    run('toktx', [...ETC1S_SRGB, `${a}.ktx2`, a]);
    run('toktx', [...UASTC_LINEAR, `${n}.ktx2`, n]);
    run('toktx', [...ETC1S_LINEAR, `${o}.ktx2`, o]);
    const A = await emit(`${a}.ktx2`, `tex/${e.id}/albedo_${tier}`, 'ktx2');
    const N = await emit(`${n}.ktx2`, `tex/${e.id}/normal_${tier}`, 'ktx2');
    const O = await emit(`${o}.ktx2`, `tex/${e.id}/orm_${tier}`, 'ktx2');
    entry.tiers[tier] = { albedo: A.url, normal: N.url, orm: O.url, bytes: A.bytes + N.bytes + O.bytes, px };
    console.log(`  ✓ ${tier}: ${(entry.tiers[tier]!.bytes / 1024).toFixed(0)} KB`);
  }
}

async function findModelFile(e: SourceEntry): Promise<string | null> {
  const base = join(CACHE_DIR, 'files', e.source, e.id);
  if (!existsSync(base)) return null;
  const all = (await readdir(base, { recursive: true })).map((f) => join(base, String(f)));
  return all.find((f) => f.endsWith('.glb')) ?? all.find((f) => f.endsWith('.gltf')) ?? null;
}

async function processModel(e: SourceEntry, draco: boolean, manifest: Manifest) {
  let src = await findModelFile(e);
  if (!src) {
    console.warn(`  ✗ ${e.id}: no cached model`);
    return;
  }
  const tmp = join(WORK, `${e.id}.glb`);
  await mkdir(WORK, { recursive: true });
  if (e.keep?.length) {
    // The file bundles several objects: keep only the named parts.
    const { NodeIO } = await import('@gltf-transform/core');
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
    const { prune } = await import('@gltf-transform/functions');
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(src);
    for (const n of doc.getRoot().listNodes()) if (!e.keep.some((k) => n.getName().includes(k))) n.dispose();
    await doc.transform(prune());
    const kept = join(WORK, `${e.id}.keep.glb`);
    await io.write(kept, doc);
    src = kept;
  }
  const gt = join(ROOT, 'node_modules', '.bin', 'gltf-transform');
  // 1) geometry: dedup/prune/weld (+simplify), meshopt or Draco; textures resized, left uncompressed.
  const mid = join(WORK, `${e.id}.mid.glb`);
  const mid2 = join(WORK, `${e.id}.mid2.glb`);
  const args = [
    'optimize', src, mid,
    '--compress', draco ? 'draco' : 'meshopt',
    '--texture-compress', 'false',
    '--texture-size', String(e.textureSize ?? 1024),
  ];
  if (e.simplify) args.push('--simplify', 'true', '--simplify-ratio', String(e.simplify), '--simplify-error', '0.002');
  else args.push('--simplify', 'false');
  run(gt, args);
  // 2) normals → UASTC + RDO + zstd; 3) everything else → ETC1S (small download).
  // optimize only resizes when it also compresses, so resize explicitly.
  const midR = join(WORK, `${e.id}.midr.glb`);
  run(gt, ['resize', mid, midR, '--width', String(e.textureSize ?? 1024), '--height', String(e.textureSize ?? 1024)]);
  run(gt, ['uastc', midR, mid2, '--slots', 'normalTexture', '--level', '2', '--rdo', '--rdo-lambda', '2', '--zstd', '18']);
  run(gt, ['etc1s', mid2, tmp, '--slots', '!normalTexture', '--quality', '200']);
  const triangles = countTriangles(execFileSync(gt, ['inspect', tmp, '--format', 'csv'], { env: TOOL_ENV }).toString());
  const r = await emit(tmp, `models/${e.id}`, 'glb');
  manifest.models[e.id] = { category: e.category, source: e.source, url: r.url, bytes: r.bytes, triangles };
  console.log(`  ✓ ${(r.bytes / 1024).toFixed(0)} KB, ~${triangles} tris`);
}

/** Parse `gltf-transform inspect --format csv` output and sum primitive triangle counts (best effort). */
function countTriangles(csv: string): number {
  const lines = csv.split('\n');
  const header = lines.findIndex((l) => /glPrimitives/.test(l) && /name/.test(l));
  if (header < 0) return 0;
  const cols = lines[header]!.split(',');
  const idx = cols.indexOf('glPrimitives');
  let sum = 0;
  for (const l of lines.slice(header + 1)) {
    if (!l.trim()) break;
    sum += Number(l.split(',')[idx]?.replace(/[^0-9]/g, '')) || 0;
  }
  return sum;
}

async function dirSize(p: string): Promise<number> {
  if (!existsSync(p)) return 0;
  let total = 0;
  for (const f of await readdir(p, { recursive: true })) {
    const s = await stat(join(p, String(f)));
    if (s.isFile()) total += s.size;
  }
  return total;
}

async function main() {
  const args = process.argv.slice(2);
  const tiersArg = args.includes('--tiers') ? args[args.indexOf('--tiers') + 1]! : '512,1k,2k';
  const tiers = tiersArg.split(',').filter((t) => t in TIER_PX);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  const onlyKind = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : undefined;
  const draco = args.includes('--draco');
  if (!KTX_DIR) {
    try {
      run('toktx', ['--version']);
    } catch {
      throw new Error('toktx not found. Install KTX-Software (see SETUP.md) or set KTX_BIN_DIR.');
    }
  }

  const sources = JSON.parse(await readFile(join(ROOT, 'assets', 'asset-sources.json'), 'utf8')) as SourceEntry[];
  const manifestPath = join(OUT, 'manifest.json');
  const manifest: Manifest = existsSync(manifestPath)
    ? (JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest)
    : { generated: '', textures: {}, models: {}, hdris: {} };
  manifest.hdris ??= {};

  for (const e of sources) {
    if (only && e.id !== only) continue;
    if (onlyKind && e.kind !== onlyKind) continue;
    console.log(`[${e.kind}] ${e.id}`);
    // Remove stale hashed outputs for this asset before re-emitting.
    if (e.kind === 'texture') {
      await rm(join(OUT, 'tex', e.id), { recursive: true, force: true });
      await processTexture(e, tiers, manifest);
    } else if (e.kind === 'hdri') {
      const src = join(CACHE_DIR, 'files', e.source, e.id, e.res ?? '1k', `${e.id}.hdr`);
      if (!existsSync(src)) {
        console.warn(`  ✗ ${e.id}: no cached hdr`);
        continue;
      }
      const hdir = join(OUT, 'hdri');
      if (existsSync(hdir)) for (const f of await readdir(hdir)) if (f.startsWith(`${e.id}_${e.res}.`)) await rm(join(hdir, f));
      const r = await emit(src, `hdri/${e.id}_${e.res}`, 'hdr');
      manifest.hdris[e.id] ??= { category: e.category, tiers: {} };
      manifest.hdris[e.id]!.tiers[e.res ?? '1k'] = r;
      console.log(`  ✓ ${e.res}: ${(r.bytes / 1e6).toFixed(1)} MB`);
    } else if (e.kind === 'model') {
      const mdir = join(OUT, 'models');
      if (existsSync(mdir)) {
        for (const f of await readdir(mdir)) if (f.startsWith(`${e.id}.`)) await rm(join(mdir, f));
      }
      await processModel(e, draco, manifest);
    }
  }
  manifest.generated = new Date().toISOString();
  await mkdir(OUT, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // ───────── report ─────────
  console.log('\nSize per texture tier (download, all materials):');
  for (const tier of Object.keys(TIER_PX)) {
    let bytes = 0;
    let n = 0;
    for (const t of Object.values(manifest.textures)) {
      const x = t.tiers[tier];
      if (x) {
        bytes += x.bytes;
        n++;
      }
    }
    if (n) {
      // GPU estimate: ASTC/BC7 ≈ 1 B/px (UASTC transcodes) for normal+ORM, ~0.5–1 B/px for albedo; +33% mips.
      const px = TIER_PX[tier]!;
      const vram = n * 3 * px * px * 1.33;
      console.log(`  ${tier.padEnd(4)} ${String(n).padStart(3)} materials  ${(bytes / 1e6).toFixed(2)} MB download  ~${(vram / 1e6).toFixed(0)} MB VRAM`);
    }
  }
  const hd = Object.values(manifest.hdris).flatMap((h) => Object.entries(h.tiers));
  for (const t of ['1k', '2k']) {
    const b = hd.filter(([k]) => k === t).reduce((s2, [, v]) => s2 + v.bytes, 0);
    if (b) console.log(`  hdri ${t}: ${(b / 1e6).toFixed(2)} MB`);
  }
  const models = Object.values(manifest.models);
  if (models.length) {
    console.log(`  models: ${models.length}, ${(models.reduce((s, m) => s + m.bytes, 0) / 1e6).toFixed(2)} MB`);
  }
  console.log(`  public/assets total: ${((await dirSize(OUT)) / 1e6).toFixed(2)} MB  (${basename(OUT)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
