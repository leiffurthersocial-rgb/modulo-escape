/**
 * Sculpts Robin's body offline: smooth-blended SDF anatomy (anatomy.ts) → surface nets at 3.5 mm →
 * meshopt simplification → per-vertex SDF normals, baked AO, cloth/hair/nail masks and skin
 * weights → skinned GLB (public/assets/monster/robin_body.glb).
 *
 *   npm run robin:build            (all three monsters)
 *   npx tsx scripts/robin/build-robin.ts leo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { buildAnatomy, CLOTH, HEAD_PIVOT, HEAD_SCALE, type Prim, type Region, type V3 } from './anatomy.ts';
import { buildCharacter, CHARACTERS, type CharacterName } from './characters.ts';

const H = Number(process.env.ROBIN_RES ?? 0.0035);
const TARGET_TRIS = Number(process.env.ROBIN_TRIS ?? 85000);
const CHAR = (process.argv[2] ?? 'robin') as CharacterName;
const CH = CHARACTERS[CHAR];
if (!CH) throw new Error(`unknown character ${CHAR}`);
const OUT = `public/assets/monster/${CHAR}_body.glb`;

const RT = buildCharacter(CH);
const { bones, prims, toOrig, girth } = RT;
const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
// Cloth rules, hairline and noise are evaluated in Robin's (authored) space.
const orig = buildAnatomy();
const bonePos = new Map(orig.bones.map((b) => [b.name, b.pos]));
const childOf = new Map<string, V3>();
for (const b of orig.bones) if (b.parent && !childOf.has(b.parent)) childOf.set(b.parent, b.pos);
console.log(`${bones.length} bones, ${prims.length} primitives, grid ${H * 1000} mm`);

// ── noise ──
const perm = new Uint8Array(512);
{
  let s = 1337;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
}
const G = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1],
];
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function noise(x: number, y: number, z: number): number {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const xf = x - X, yf = y - Y, zf = z - Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255;
  const g = (i: number, j: number, k: number, dx: number, dy: number, dz: number) => {
    const v = G[perm[i + perm[j + perm[k]!]!]! & 15]!;
    return v[0]! * dx + v[1]! * dy + v[2]! * dz;
  };
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  return L(
    L(L(g(xi, yi, zi, xf, yf, zf), g(xi + 1, yi, zi, xf - 1, yf, zf), u), L(g(xi, yi + 1, zi, xf, yf - 1, zf), g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u), v),
    L(L(g(xi, yi, zi + 1, xf, yf, zf - 1), g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u), L(g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u), v),
    w,
  );
}
const fbm = (x: number, y: number, z: number, o = 3) => {
  let a = 0, f = 1, amp = 0.5;
  for (let i = 0; i < o; i++) {
    a += amp * noise(x * f, y * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return a;
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ── primitives (precomputed) ──
interface P {
  src: Prim;
  kind: number; // 0 cone, 1 ell, 2 hair
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  ra: number; rb: number;
  // ellipsoid frame (rows) and radii
  m: number[];
  r: V3;
  k: number;
  sub: boolean;
  min: V3;
  max: V3;
  region: Region | undefined;
  bone: number;
  /** Map a point back to Robin's space, and the bone's girth scale. */
  back: (p: V3) => V3;
  girth: number;
}
const P: P[] = prims.map((p, pi) => {
  const kind = p.kind === 'cone' ? 0 : p.kind === 'ell' ? 1 : 2;
  let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let ext: V3;
  if (kind > 0) {
    // Frame: Y along a→b, X/Z perpendicular.
    let yv: V3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
    const l = Math.hypot(...yv) || 1;
    yv = [yv[0] / l, yv[1] / l, yv[2] / l];
    const ref: V3 = Math.abs(yv[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let xv: V3 = [yv[1] * ref[2] - yv[2] * ref[1], yv[2] * ref[0] - yv[0] * ref[2], yv[0] * ref[1] - yv[1] * ref[0]];
    const lx = Math.hypot(...xv);
    xv = [xv[0] / lx, xv[1] / lx, xv[2] / lx];
    const zv: V3 = [xv[1] * yv[2] - xv[2] * yv[1], xv[2] * yv[0] - xv[0] * yv[2], xv[0] * yv[1] - xv[1] * yv[0]];
    // Keep world-aligned frames for axis-aligned ellipsoids (so radii mean x/y/z).
    if (Math.abs(yv[1] - 1) < 1e-6) m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    else m = [...xv, ...yv, ...zv];
    const R = Math.max(...p.r!);
    ext = [R, R, R];
  } else ext = [0, 0, 0];
  const pad = p.k + 0.02;
  const min: V3 = kind > 0 ? [p.a[0] - ext[0] - pad, p.a[1] - ext[1] - pad, p.a[2] - ext[2] - pad] : [Math.min(p.a[0] - p.ra, p.b[0] - p.rb) - pad, Math.min(p.a[1] - p.ra, p.b[1] - p.rb) - pad, Math.min(p.a[2] - p.ra, p.b[2] - p.rb) - pad];
  const max: V3 = kind > 0 ? [p.a[0] + ext[0] + pad, p.a[1] + ext[1] + pad, p.a[2] + ext[2] + pad] : [Math.max(p.a[0] + p.ra, p.b[0] + p.rb) + pad, Math.max(p.a[1] + p.ra, p.b[1] + p.rb) + pad, Math.max(p.a[2] + p.ra, p.b[2] + p.rb) + pad];
  return { src: p, kind, ax: p.a[0], ay: p.a[1], az: p.a[2], bx: p.b[0], by: p.b[1], bz: p.b[2], ra: p.ra, rb: p.rb, m, r: p.r ?? [0, 0, 0], k: p.k, sub: !!p.sub, min, max, region: p.region, bone: boneIndex.get(p.bone)!, back: toOrig[pi]!, girth: girth[pi]! };
});

function primDist(q: P, x: number, y: number, z: number): number {
  if (q.kind === 0) {
    // iq's round cone
    const bax = q.bx - q.ax, bay = q.by - q.ay, baz = q.bz - q.az;
    const pax = x - q.ax, pay = y - q.ay, paz = z - q.az;
    const l2 = bax * bax + bay * bay + baz * baz;
    if (l2 < 1e-12) return Math.hypot(pax, pay, paz) - q.ra;
    const rr = q.ra - q.rb;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const yy = pax * bax + pay * bay + paz * baz;
    const zz = yy - l2;
    const xx = pax * l2 - bax * yy, xy = pay * l2 - bay * yy, xz = paz * l2 - baz * yy;
    const x2 = xx * xx + xy * xy + xz * xz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - q.rb;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - q.ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - q.ra;
  }
  const dx = x - q.ax, dy = y - q.ay, dz = z - q.az;
  const m = q.m;
  const lx = m[0]! * dx + m[1]! * dy + m[2]! * dz;
  const ly = m[3]! * dx + m[4]! * dy + m[5]! * dz;
  const lz = m[6]! * dx + m[7]! * dy + m[8]! * dz;
  const r = q.r;
  const k0 = Math.hypot(lx / r[0], ly / r[1], lz / r[2]);
  const k1 = Math.hypot(lx / (r[0] * r[0]), ly / (r[1] * r[1]), lz / (r[2] * r[2]));
  let d = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
  if (q.kind === 2) {
    // Hair: clip below the hairline (fringe at the front, nape at the back), messy clumps.
    // Work in the unscaled head space the hairline was authored in.
    const S = HEAD_SCALE;
    const [ox, oy, oz] = q.back([x, y, z]);
    const ux = HEAD_PIVOT[0] + (ox - HEAD_PIVOT[0]) / S, uy = HEAD_PIVOT[1] + (oy - HEAD_PIVOT[1]) / S, uz = HEAD_PIVOT[2] + (oz - HEAD_PIVOT[2]) / S;
    const front = smooth(-0.06, 0.08, uz);
    const line = 2.9 + 0.135 * front + 0.015 * noise(ux * 40, 0, uz * 40);
    d = Math.max(d, (line - uy) * S);
    d -= S * (0.009 * Math.abs(fbm(ux * 28, uy * 20, uz * 28, 3)) + 0.004 * noise(ux * 90, uy * 50, uz * 90));
  }
  return d;
}

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** Cloth/hair/nail region for a point given its dominant primitive. */
function regionAt(px: number, py: number, pz: number, q: P): Region {
  if (q.region) return q.region;
  if (RT.cloth) return RT.cloth([px, py, pz], q.src.bone, clothHelpers);
  const [x, y, z] = q.back([px, py, pz]);
  const r = clothRule(x, y, z, q.src.bone);
  if (CH.longSleeves && q.src.bone.startsWith('upperarm')) return 'shirt';
  if (CH.longSleeves && q.src.bone.startsWith('forearm')) {
    const a = bonePos.get(q.src.bone)!;
    const c = childOf.get(q.src.bone)!;
    const t = ((x - a[0]) * (c[0] - a[0]) + (y - a[1]) * (c[1] - a[1]) + (z - a[2]) * (c[2] - a[2])) / ((c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2);
    return t < 0.88 + 0.05 * noise(x * 40, y * 40, z * 40) ? 'shirt' : 'skin';
  }
  if (r === 'shirt' && !CH.shirt) return 'skin';
  if (r === 'pants' && CH.pants === 'short' && q.src.bone.startsWith('thigh')) {
    const a = bonePos.get(q.src.bone)!;
    const c = childOf.get(q.src.bone)!;
    const t = ((x - a[0]) * (c[0] - a[0]) + (y - a[1]) * (c[1] - a[1]) + (z - a[2]) * (c[2] - a[2])) / ((c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2);
    return t < 0.55 + 0.08 * fbm(x * 25, y * 9, z * 25, 2) ? 'pants' : 'skin';
  }
  if (r === 'pants' && CH.pants === 'short' && q.src.bone.startsWith('shin')) return 'skin';
  return r;
}

const ownChild = new Map<string, V3>();
for (const b of bones) if (b.parent && !ownChild.has(b.parent)) ownChild.set(b.parent, b.pos);
const clothHelpers = {
  noise,
  fbm,
  along: (bn: string, p: V3) => {
    const a = bones.find((b) => b.name === bn)!.pos;
    const c = ownChild.get(bn)!;
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy + (p[2] - a[2]) * vz) / (vx * vx + vy * vy + vz * vz);
  },
};

/** Robin's clothing rules (in his space). */
function clothRule(x: number, y: number, z: number, b: string): Region {
  const along = (bn: string) => {
    const a = bonePos.get(bn)!;
    const c = childOf.get(bn)!;
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return ((x - a[0]) * vx + (y - a[1]) * vy + (z - a[2]) * vz) / (vx * vx + vy * vy + vz * vz);
  };
  const hem = CLOTH.hemY + 0.035 * fbm(x * 7, 0, z * 7, 2) + 0.03 * Math.max(0, noise(x * 31, 3.3, z * 31));
  // Round T-shirt neckline: skin inside a ring around the neck (scooped at the front).
  const ring = Math.hypot(x, z * 1.15) - (0.088 + 0.035 * smooth(-0.02, 0.1, z) + 0.004 * noise(x * 50, 1, z * 50));
  const collar = ring > 0 ? CLOTH.collarY + 0.06 : 2.4;
  if (b === 'chest' || b === 'spine2' || b.startsWith('clavicle') || (b === 'spine1' && y > hem)) return y > hem && y < collar ? 'shirt' : 'skin';
  if (b.startsWith('upperarm')) return along(b) < 0.42 + 0.06 * noise(x * 30, y * 30, z * 30) ? 'shirt' : 'skin';
  if (b === 'neck1' && y < collar - 0.01 && y < 2.53) return 'shirt';
  const waist = CLOTH.waistY + 0.01 * noise(x * 20, 0, z * 20);
  if (b === 'hips' || b.startsWith('thigh') || (b === 'spine1' && y < waist)) return y < waist ? 'pants' : 'skin';
  if (b.startsWith('shin')) return along(b) < 0.32 + 0.08 * fbm(x * 25, y * 9, z * 25, 2) ? 'pants' : 'skin';
  return 'skin';
}

/** Cloth stands off the skin a little and folds; trousers wrinkle at the knees. */
function displace(x: number, y: number, z: number, reg: Region): number {
  if (reg === 'shirt') return -0.005 - 0.0045 * fbm(x * 9, y * 3.5, z * 9, 3) - 0.0015 * noise(x * 40, y * 25, z * 40);
  if (reg === 'pants') {
    const knee = Math.exp(-(((y - 0.82) / 0.12) ** 2));
    return -0.007 - 0.004 * fbm(x * 8, y * 4, z * 8, 2) - (0.003 + 0.004 * knee) * Math.abs(noise(x * 14, y * 34, z * 14));
  }
  if (reg === 'skin') return -0.0008 * noise(x * 60, y * 60, z * 60);
  return 0;
}

// ── spatial blocks ──
const PAD = 0.04;
const bmin: V3 = [Infinity, Infinity, Infinity];
const bmax: V3 = [-Infinity, -Infinity, -Infinity];
for (const q of P) for (let i = 0; i < 3; i++) {
  bmin[i] = Math.min(bmin[i]!, q.min[i]!);
  bmax[i] = Math.max(bmax[i]!, q.max[i]!);
}
const NX = Math.ceil((bmax[0] - bmin[0] + 2 * PAD) / H) + 1;
const NY = Math.ceil((bmax[1] - bmin[1] + 2 * PAD) / H) + 1;
const NZ = Math.ceil((bmax[2] - bmin[2] + 2 * PAD) / H) + 1;
const O: V3 = [bmin[0] - PAD, bmin[1] - PAD, bmin[2] - PAD];
const B = 8;
const BX = Math.ceil(NX / B), BY = Math.ceil(NY / B), BZ = Math.ceil(NZ / B);
console.log(`grid ${NX}×${NY}×${NZ}, blocks ${BX}×${BY}×${BZ}`);

function lists(minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number): P[] {
  return P.filter((q) => q.max[0] >= minx && q.min[0] <= maxx && q.max[1] >= miny && q.min[1] <= maxy && q.max[2] >= minz && q.min[2] <= maxz);
}

/** Field: smooth union / subtraction of the primitives, then cloth displacement. */
function field(x: number, y: number, z: number, list: P[]): number {
  let d = 1e9;
  let best: P | null = null;
  let bd = 1e9;
  for (let i = 0; i < list.length; i++) {
    const q = list[i]!;
    const dp = primDist(q, x, y, z);
    if (q.sub) d = smax(d, -dp, q.k);
    else {
      d = smin(d, dp, q.k);
      if (dp < bd) {
        bd = dp;
        best = q;
      }
    }
  }
  if (best && d < 0.03) {
    const [ox, oy, oz] = best.back([x, y, z]);
    d += displace(ox, oy, oz, regionAt(x, y, z, best)) * Math.min(1.8, best.girth);
  }
  return d;
}

const blockList: (P[] | null)[] = new Array(BX * BY * BZ).fill(null);
const blockFill = new Float32Array(BX * BY * BZ);
{
  const half = (B * H * Math.sqrt(3)) / 2 + 0.03;
  let active = 0;
  for (let bz = 0; bz < BZ; bz++)
    for (let by = 0; by < BY; by++)
      for (let bx = 0; bx < BX; bx++) {
        const x0 = O[0] + bx * B * H, y0 = O[1] + by * B * H, z0 = O[2] + bz * B * H;
        const x1 = x0 + B * H, y1 = y0 + B * H, z1 = z0 + B * H;
        const l = lists(x0, y0, z0, x1, y1, z1);
        const bi = bx + BX * (by + BY * bz);
        if (!l.length) {
          blockFill[bi] = 1;
          continue;
        }
        const c = field((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, l);
        if (Math.abs(c) > half) {
          blockFill[bi] = c;
          continue;
        }
        blockList[bi] = l;
        active++;
      }
  console.log(`active blocks ${active}`);
}

function sample(i: number, j: number, k: number): number {
  const bi = Math.min(BX - 1, (i / B) | 0) + BX * (Math.min(BY - 1, (j / B) | 0) + BY * Math.min(BZ - 1, (k / B) | 0));
  const l = blockList[bi];
  if (!l) return blockFill[bi]!;
  return field(O[0] + i * H, O[1] + j * H, O[2] + k * H, l);
}
function listAt(x: number, y: number, z: number): P[] {
  const i = Math.max(0, Math.min(BX - 1, Math.floor((x - O[0]) / H / B)));
  const j = Math.max(0, Math.min(BY - 1, Math.floor((y - O[1]) / H / B)));
  const k = Math.max(0, Math.min(BZ - 1, Math.floor((z - O[2]) / H / B)));
  return blockList[i + BX * (j + BY * k)] ?? lists(x - 0.05, y - 0.05, z - 0.05, x + 0.05, y + 0.05, z + 0.05);
}
const f = (x: number, y: number, z: number) => field(x, y, z, listAt(x, y, z));

// ── surface nets, slice by slice along Y ──
const t0 = Date.now();
const pos: number[] = [];
const idx: number[] = [];
const sliceA = new Float32Array(NX * NZ);
const sliceB = new Float32Array(NX * NZ);
let lo = sliceA;
let hi = sliceB;
const fillSlice = (s: Float32Array, j: number) => {
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) s[i + NX * k] = sample(i, j, k);
};
let prevCells = new Int32Array(NX * NZ).fill(-1);
let curCells = new Int32Array(NX * NZ).fill(-1);
fillSlice(lo, 0);
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];
const v = new Float64Array(8);
/** Quad across a sign-changing grid edge along `axis`; outward = towards the positive end if `inLow`. */
const quad = (a: number, b: number, c: number, d: number, inLow: boolean, axis: number) => {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  const e1 = [pos[c * 3]! - pos[a * 3]!, pos[c * 3 + 1]! - pos[a * 3 + 1]!, pos[c * 3 + 2]! - pos[a * 3 + 2]!];
  const e2 = [pos[d * 3]! - pos[b * 3]!, pos[d * 3 + 1]! - pos[b * 3 + 1]!, pos[d * 3 + 2]! - pos[b * 3 + 2]!];
  const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const flip = n[axis]! * (inLow ? 1 : -1) < 0;
  if (flip) idx.push(a, c, b, a, d, c);
  else idx.push(a, b, c, a, c, d);
};
for (let j = 0; j < NY - 1; j++) {
  fillSlice(hi, j + 1);
  curCells.fill(-1);
  // Cells of layer j (corners: bit0 = +x, bit1 = +y, bit2 = +z).
  for (let k = 0; k < NZ - 1; k++)
    for (let i = 0; i < NX - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const ii = i + (c & 1), kk = k + ((c >> 2) & 1);
        const val = (c & 2 ? hi : lo)[ii + NX * kk]!;
        v[c] = val;
        if (val < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of EDGES) {
        const va = v[a]!, vb = v[b]!;
        if (va < 0 === vb < 0) continue;
        const t = va / (va - vb);
        sx += (a & 1) + ((b & 1) - (a & 1)) * t;
        sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
        sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
        n++;
      }
      curCells[i + NX * k] = pos.length / 3;
      pos.push(O[0] + (i + sx / n) * H, O[1] + (j + sy / n) * H, O[2] + (k + sz / n) * H);
    }
  // Y edges between point layers j and j+1 at (i, k): cells (i-1..i, k-1..k) of layer j.
  for (let k = 1; k < NZ - 1; k++)
    for (let i = 1; i < NX - 1; i++) {
      const a = lo[i + NX * k]!, b = hi[i + NX * k]!;
      if (a < 0 === b < 0) continue;
      const c = (ii: number, kk: number) => curCells[ii + NX * kk]!;
      quad(c(i - 1, k - 1), c(i, k - 1), c(i, k), c(i - 1, k), a < 0, 1);
    }
  // X and Z edges at point layer j: cells of layers j-1 (prev) and j (cur).
  if (j > 0)
    for (let k = 1; k < NZ - 1; k++)
      for (let i = 1; i < NX - 1; i++) {
        const p0 = lo[i + NX * k]!;
        if (i < NX - 1) {
          const p1 = lo[i + 1 + NX * k]!;
          if (p0 < 0 !== p1 < 0) quad(prevCells[i + NX * (k - 1)]!, curCells[i + NX * (k - 1)]!, curCells[i + NX * k]!, prevCells[i + NX * k]!, p0 < 0, 0);
        }
        if (k < NZ - 1) {
          const p1 = lo[i + NX * (k + 1)]!;
          if (p0 < 0 !== p1 < 0) quad(prevCells[i - 1 + NX * k]!, prevCells[i + NX * k]!, curCells[i + NX * k]!, curCells[i - 1 + NX * k]!, p0 < 0, 2);
        }
      }
  [prevCells, curCells] = [curCells, prevCells];
  [lo, hi] = [hi, lo];
  if (j % 100 === 0) process.stdout.write(`\r  slice ${j}/${NY}  verts ${pos.length / 3}  tris ${idx.length / 3}   `);
}
console.log(`\nsurface nets: ${pos.length / 3} verts, ${idx.length / 3} tris in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ── winding check: triangles must face along the SDF gradient ──
const grad = (x: number, y: number, z: number, out: number[]) => {
  const e = 0.0012;
  const l = listAt(x, y, z);
  out[0] = field(x + e, y, z, l) - field(x - e, y, z, l);
  out[1] = field(x, y + e, z, l) - field(x, y - e, z, l);
  out[2] = field(x, y, z + e, l) - field(x, y, z - e, l);
  const n = Math.hypot(out[0]!, out[1]!, out[2]!) || 1;
  out[0]! /= n;
  out[1]! /= n;
  out[2]! /= n;
  return out;
};
{
  let agree = 0;
  const g = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3 * 97) {
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    const e1 = [pos[b * 3]! - pos[a * 3]!, pos[b * 3 + 1]! - pos[a * 3 + 1]!, pos[b * 3 + 2]! - pos[a * 3 + 2]!];
    const e2 = [pos[c * 3]! - pos[a * 3]!, pos[c * 3 + 1]! - pos[a * 3 + 1]!, pos[c * 3 + 2]! - pos[a * 3 + 2]!];
    const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!, nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    grad(pos[a * 3]!, pos[a * 3 + 1]!, pos[a * 3 + 2]!, g);
    agree += nx * g[0]! + ny * g[1]! + nz * g[2]! > 0 ? 1 : -1;
  }
  if (agree < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2]!, idx[t + 1]!];
  console.log(`winding ${agree < 0 ? 'flipped' : 'ok'}`);
}

// ── region one-hot per vertex (guides simplification so cloth edges survive) ──
const REG: Region[] = ['skin', 'shirt', 'pants', 'hair', 'nail'];
function dominant(x: number, y: number, z: number): P {
  const l = listAt(x, y, z);
  let best = l[0]!;
  let bd = 1e9;
  for (const q of l) {
    if (q.sub) continue;
    const d = primDist(q, x, y, z);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}
const nv0 = pos.length / 3;
const attr = new Float32Array(nv0 * 5);
for (let i = 0; i < nv0; i++) {
  const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
  attr[i * 5 + REG.indexOf(regionAt(x, y, z, dominant(x, y, z)))] = 1;
}

// ── simplify ──
await MeshoptSimplifier.ready;
const positions = new Float32Array(pos);
const indices0 = new Uint32Array(idx);
const t1 = Date.now();
const simp = MeshoptSimplifier.simplifyWithAttributes(indices0, positions, 3, attr, 5, [0.02, 0.02, 0.02, 0.02, 0.02], null, TARGET_TRIS * 3, 0.01, ['Regularize']);
const sIdx = simp[0];
console.log(`simplified to ${sIdx.length / 3} tris (error ${(simp[1] * 1000).toFixed(2)} mm rel) in ${((Date.now() - t1) / 1000).toFixed(1)} s`);

// Compact the kept vertices.
const remap = new Int32Array(nv0).fill(-1);
const keep: number[] = [];
for (const i of sIdx) if (remap[i] === -1) {
  remap[i] = keep.length;
  keep.push(i);
}
const NV = keep.length;
const outIdx = new Uint32Array(sIdx.length);
for (let t = 0; t < sIdx.length; t++) outIdx[t] = remap[sIdx[t]!]!;

// ── final attributes: snap to surface, SDF normals, AO, masks, skin weights ──
const P3 = new Float32Array(NV * 3);
const N3 = new Float32Array(NV * 3);
const COL = new Float32Array(NV * 4); // ao, shirt, pants, hair
const UV = new Float32Array(NV * 2); // nail, face
const J4 = new Uint16Array(NV * 4);
const W4 = new Float32Array(NV * 4);
const g = [0, 0, 0];
const boneSigma = (name: string) => (/index|middle|ring|pinky|thumb|toes/.test(name) ? 0.004 : name.startsWith('hand') || name.startsWith('foot') ? 0.008 : 0.014);
const sig = bones.map((b) => boneSigma(b.name));
const tA = Date.now();
for (let n = 0; n < NV; n++) {
  const i = keep[n]!;
  let x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
  for (let it = 0; it < 2; it++) {
    const d = f(x, y, z);
    grad(x, y, z, g);
    x -= g[0]! * d;
    y -= g[1]! * d;
    z -= g[2]! * d;
  }
  grad(x, y, z, g);
  P3.set([x, y, z], n * 3);
  N3.set(g, n * 3);
  // AO from the field along the normal.
  let occ = 0;
  let w = 1;
  for (const hh of [0.008, 0.018, 0.035, 0.06, 0.1, 0.15]) {
    occ += w * Math.max(0, hh - f(x + g[0]! * hh, y + g[1]! * hh, z + g[2]! * hh));
    w *= 0.62;
  }
  const ao = Math.max(0.15, Math.min(1, 1 - occ * 7));
  const dom = dominant(x, y, z);
  const reg = regionAt(x, y, z, dom);
  COL.set([ao, reg === 'shirt' ? 1 : 0, reg === 'pants' ? 1 : 0, reg === 'hair' ? 1 : 0], n * 4);
  const headish = dom.src.bone === 'head' || dom.src.bone === 'neck2';
  UV.set([reg === 'nail' ? 1 : 0, headish ? smooth(0.05, 0.45, g[2]!) : 0], n * 2);
  // Skin weights: per bone, nearest own primitive; soft-min over bones.
  const per = new Float64Array(bones.length).fill(1e9);
  for (const q of P) {
    if (q.sub) continue;
    if (x < q.min[0] - 0.15 || x > q.max[0] + 0.15 || y < q.min[1] - 0.15 || y > q.max[1] + 0.15 || z < q.min[2] - 0.15 || z > q.max[2] + 0.15) continue;
    const d = primDist(q, x, y, z);
    if (d < per[q.bone]!) per[q.bone] = d;
  }
  let dmin = 1e9;
  for (let b = 0; b < bones.length; b++) dmin = Math.min(dmin, per[b]!);
  const cand: [number, number][] = [];
  for (let b = 0; b < bones.length; b++) {
    const dd = per[b]! - dmin;
    if (dd > 0.08) continue;
    cand.push([b, Math.exp(-dd / sig[b]!)]);
  }
  cand.sort((a, b) => b[1] - a[1]);
  const top = cand.slice(0, 4).filter((c) => c[1] > 0.02);
  const sum = top.reduce((s, c) => s + c[1], 0);
  top.forEach((c, k) => {
    J4[n * 4 + k] = c[0];
    W4[n * 4 + k] = c[1] / sum;
  });
}
console.log(`attributes for ${NV} verts in ${((Date.now() - tA) / 1000).toFixed(1)} s`);

// ── glTF ──
const doc = new Document();
const buffer = doc.createBuffer();
const nodes = new Map<string, ReturnType<Document['createNode']>>();
for (const b of bones) {
  // Joint offsets from THIS body's skeleton (bonePos holds Robin's, for the cloth rules).
  const parent = b.parent ? bones.find((x) => x.name === b.parent)!.pos : ([0, 0, 0] as V3);
  const node = doc.createNode(b.name).setTranslation([b.pos[0] - parent[0], b.pos[1] - parent[1], b.pos[2] - parent[2]]);
  nodes.set(b.name, node);
  if (b.parent) nodes.get(b.parent)!.addChild(node);
}
const ibm = new Float32Array(bones.length * 16);
bones.forEach((b, i) => {
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.pos[0], -b.pos[1], -b.pos[2], 1], i * 16);
});
const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', arr: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
const skin = doc.createSkin('RobinSkin').setSkeleton(nodes.get('hips')!).setInverseBindMatrices(acc('MAT4', ibm));
for (const b of bones) skin.addJoint(nodes.get(b.name)!);
const prim = doc
  .createPrimitive()
  .setIndices(acc('SCALAR', outIdx))
  .setAttribute('POSITION', acc('VEC3', P3))
  .setAttribute('NORMAL', acc('VEC3', N3))
  .setAttribute('COLOR_0', acc('VEC4', COL))
  .setAttribute('TEXCOORD_0', acc('VEC2', UV))
  .setAttribute('JOINTS_0', acc('VEC4', J4))
  .setAttribute('WEIGHTS_0', acc('VEC4', W4))
  .setMaterial(doc.createMaterial('RobinSkin').setBaseColorFactor([0.8, 0.72, 0.68, 1]).setRoughnessFactor(0.6));
const meshNode = doc.createNode('RobinBody').setMesh(doc.createMesh('RobinBody').addPrimitive(prim)).setSkin(skin);
doc.createScene('Robin').addChild(nodes.get('hips')!).addChild(meshNode);

await MeshoptEncoder.ready;
await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
mkdirSync('public/assets/monster', { recursive: true });
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(OUT, doc);
// Where the face photo and the shirt print map on this body (read by the game's material).
{
  const head = bones.find((b) => b.name === 'head')!.pos;
  const headO = orig.bones.find((b) => b.name === 'head')!.pos;
  const chest = bones.find((b) => b.name === 'chest')!.pos;
  const chestO = orig.bones.find((b) => b.name === 'chest')!.pos;
  const hs = CH.bones.head?.thick ?? 1;
  const headThick = typeof hs === 'number' ? hs : hs[0];
  const cs = CH.bones.chest?.thick ?? 1;
  const chestThick = typeof cs === 'number' ? cs : cs[0];
  const eyeY0 = 2.84 + (2.957 - 2.84) * HEAD_SCALE;
  const top = Math.max(...P.map((q) => q.max[1])) - 0.02;
  const meta = RT.meta ? { character: CHAR, ...RT.meta, hipsY: bones.find((b) => b.name === 'hips')!.pos[1], height: top, shirt: CH.shirt } : {
    character: CHAR,
    hemY: RT.hemY,
    eyeY: head[1] + (eyeY0 - headO[1]) * headThick,
    eyeHalf: 0.043 * HEAD_SCALE * headThick,
    eyeZ: head[2],
    collarY: chest[1] + (2.49 - chestO[1]),
    shirtHalfWidth: 0.3 * chestThick,
    hipsY: bones.find((b) => b.name === 'hips')!.pos[1],
    height: top,
    shirt: CH.shirt,
  };
  writeFileSync(`public/assets/monster/${CHAR}_body.json`, JSON.stringify(meta, null, 1) + '\n');
  console.log(JSON.stringify(meta));
}
const { statSync } = await import('node:fs');
console.log(`wrote ${OUT}: ${(statSync(OUT).size / 1024 / 1024).toFixed(2)} MB, ${NV} verts, ${outIdx.length / 3} tris, ${bones.length} bones`);
