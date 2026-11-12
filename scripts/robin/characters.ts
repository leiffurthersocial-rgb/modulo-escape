/**
 * The sculpted monsters share one anatomy (anatomy.ts, sculpted as Robin) and one skeleton, so they
 * share the animation rig. Each character re-proportions it per bone:
 *   len   — scales the bone's length (its children move along the bone)
 *   thick — scales everything around the bone across it (x, y, z in world axes)
 * Every primitive keeps a map back to Robin's space, so cloth rules, hairline and noise patterns
 * are evaluated where they were authored.
 */
import { buildAnatomy, CLOTH, type BoneDef, type Prim, type V3 } from './anatomy.ts';
import { buildFaceHead, JOVAN_FACE, type FaceParams } from './heads.ts';
import { buildLeoAnatomy, type ClothFn } from './leo.ts';

export type CharacterName = 'robin' | 'leo' | 'jovan';

export interface BoneScale {
  len?: number;
  thick?: number | V3;
}

export interface Character {
  name: CharacterName;
  bones: Record<string, BoneScale>;
  /** Clothing: the T-shirt, and trousers ('long' to the shins, 'short' above the knee). */
  shirt: boolean;
  pants: 'long' | 'short';
  /** Torn shirt: holes, claw-slash rips, ragged hem and tattered sleeves. */
  ripped?: boolean;
  /** Hoodie (long sleeves, ribbed hem, hood bunched at the back, front pocket), jeans, sneakers. */
  hoodie?: boolean;
  /** Replace Robin's head with one sculpted to match this face (heads.ts). */
  face?: FaceParams;
  /** A sculpt of its own (same skeleton) instead of re-proportioning Robin. */
  custom?: 'leo';
}

const side = (names: string[], s: BoneScale): Record<string, BoneScale> => {
  const out: Record<string, BoneScale> = {};
  for (const n of names) for (const sd of ['L', 'R']) out[`${n}${sd}`] = s;
  return out;
};
const fingers = (s: BoneScale) => side(['index1', 'index2', 'index3', 'middle1', 'middle2', 'middle3', 'ring1', 'ring2', 'ring3', 'pinky1', 'pinky2', 'pinky3', 'thumb1', 'thumb2', 'thumb3'], s);

export const CHARACTERS: Record<CharacterName, Character> = {
  robin: { name: 'robin', bones: {}, shirt: true, pants: 'long' },
  /** Leo: his own sculpt (scripts/robin/leo.ts). */
  leo: { name: 'leo', bones: {}, shirt: true, pants: 'short', custom: 'leo' },
  /**
   * Jovan: impossibly tall and lanky (≈ 4 m standing), so he walks stooped with his palms pressed
   * flat against the ceiling. Long torso and limbs, narrow but not skeletal, big spidery hands.
   */
  jovan: {
    name: 'jovan',
    // ≈ 4.4 m: folded under the 3.6 m ceiling. Gaunt; a ripped black shirt; torn black trousers; barefoot.
    shirt: true,
    ripped: true,
    pants: 'long',
    face: JOVAN_FACE,
    bones: {
      hips: { len: 1.15, thick: [1.0, 1.0, 0.95] },
      spine1: { len: 1.3, thick: [0.95, 1, 0.92] },
      spine2: { len: 1.3, thick: [0.97, 1, 0.94] },
      chest: { len: 1.2, thick: [1.05, 1, 0.96] },
      neck1: { len: 1.15, thick: 1.0 },
      neck2: { len: 1.15, thick: 1.0 },
      head: { len: 1, thick: 0.97 },
      ...side(['clavicle'], { len: 1.25, thick: 1.0 }),
      ...side(['upperarm'], { len: 1.55, thick: 0.95 }),
      ...side(['forearm'], { len: 1.6, thick: 0.92 }),
      ...side(['hand'], { len: 1.4, thick: 1.1 }),
      ...fingers({ len: 1.8, thick: 0.95 }),
      ...side(['thigh'], { len: 1.6, thick: 1.0 }),
      ...side(['shin'], { len: 1.6, thick: 0.98 }),
      ...side(['foot'], { len: 1.2, thick: 1.0 }),
    },
  },
};

export interface Retargeted {
  bones: BoneDef[];
  prims: Prim[];
  /** Per primitive: map a point of the new body back to Robin's space. */
  toOrig: ((p: V3) => V3)[];
  /** Per primitive: the bone's thickness scale (average), for displacement amplitudes. */
  girth: number[];
  /** Own clothing rules (custom sculpts; evaluated in the body's own space). */
  cloth?: ClothFn;
  /** Face / shirt / hem placement (custom sculpts). */
  meta?: { eyeY: number; eyeHalf: number; eyeZ: number; collarY: number; shirtHalfWidth: number; hemY: number };
  /** Height of Robin's shirt hem on this body. */
  hemY: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function buildCharacter(c: Character): Retargeted {
  if (c.custom === 'leo') {
    const L = buildLeoAnatomy();
    const id = (p: V3) => p;
    return { bones: L.bones, prims: L.prims, toOrig: L.prims.map(() => id), girth: L.prims.map(() => 1), cloth: L.cloth, meta: L.meta, hemY: L.meta.hemY };
  }
  const anat = buildAnatomy();
  const { bones } = anat;
  let prims = anat.prims;
  if (c.face) {
    // Robin's eyes sit at y 2.994, cornea z ≈ 0.14, 11.35 cm apart (head scale 1.32).
    prims = prims.filter((q) => q.bone !== 'head');
    buildFaceHead(c.face, [0, 2.994, 0.14], 0.1135, prims);
  }
  if (c.hoodie) {
    // Cloth and shoes (in Robin's space; mapped like everything else).
    const ell = (bone: string, ctr: V3, r: V3, k: number, to?: V3) => prims.push({ kind: 'ell', a: ctr, b: to ?? [ctr[0], ctr[1] + 1, ctr[2]], ra: 0, rb: 0, r, k, bone });
    ell('chest', [0, 2.19, -0.01], [0.19, 0.24, 0.146], 0.04); // hoodie body over the ribs
    ell('spine2', [0, 2.02, -0.005], [0.172, 0.13, 0.135], 0.05);
    ell('spine1', [0, 1.82, -0.005], [0.162, 0.15, 0.135], 0.05); // over the sunken belly
    ell('spine1', [0, 1.675, -0.005], [0.172, 0.03, 0.142], 0.02); // ribbed hem
    ell('spine1', [0, 1.79, 0.128], [0.11, 0.055, 0.014], 0.012); // front pocket
    ell('chest', [0, 2.49, -0.11], [0.16, 0.06, 0.07], 0.03); // hood, bunched up at the back
    for (const [s, sd] of [
      [1, 'L'],
      [-1, 'R'],
    ] as const) {
      // Sneakers: a rounded shell over the foot (toes inside), a padded collar at the ankle.
      ell(`foot${sd}`, [s * 0.172, 0.05, 0.07], [0.05, 0.185, 0.066], 0.012, [s * 0.172, 0.05, 1]);
      ell(`foot${sd}`, [s * 0.172, 0.016, 0.07], [0.016, 0.195, 0.07], 0.008, [s * 0.172, 0.016, 1]); // sole
      prims.push({ kind: 'cone', a: [s * 0.165, 0.1, -0.03], b: [s * 0.165, 0.14, -0.02], ra: 0.05, rb: 0.047, k: 0.02, bone: `foot${sd}` });
    }
  }
  const byName = new Map(bones.map((b) => [b.name, b]));
  const scale = (n: string) => c.bones[n] ?? {};
  const thickV = (n: string): V3 => {
    const t = scale(n).thick ?? 1;
    return typeof t === 'number' ? [t, t, t] : t;
  };
  // Bone direction (towards its first child, or continuing its parent's direction).
  const firstChild = new Map<string, BoneDef>();
  for (const b of bones) if (b.parent && !firstChild.has(b.parent)) firstChild.set(b.parent, b);
  const dir = (n: string): V3 => {
    const b = byName.get(n)!;
    const ch = firstChild.get(n);
    if (ch) return norm(sub(ch.pos, b.pos));
    if (b.parent) return norm(sub(b.pos, byName.get(b.parent)!.pos));
    return [0, 1, 0];
  };
  // New joint positions: each child offset stretched along the parent bone by the parent's len.
  const newPos = new Map<string, V3>();
  for (const b of bones) {
    if (!b.parent) {
      newPos.set(b.name, b.pos);
      continue;
    }
    const p = byName.get(b.parent)!;
    const o = sub(b.pos, p.pos);
    const d = dir(p.name);
    const along = dot(o, d);
    const perp = sub(o, scl(d, along));
    const t = thickV(p.name);
    const len = scale(p.name).len ?? 1;
    newPos.set(b.name, addv(newPos.get(p.name)!, addv(scl(d, along * len), [perp[0] * t[0], perp[1] * t[1], perp[2] * t[2]])));
  }
  // Stand on the floor: the ankles at Robin's ankle height × the feet's thickness.
  const ankle = newPos.get('footL')!;
  const want = byName.get('footL')!.pos[1] * thickV('footL')[1];
  const lift = want - ankle[1];
  for (const [k, v] of newPos) newPos.set(k, [v[0], v[1] + lift, v[2]]);

  const map = (bn: string) => {
    const b = byName.get(bn)!;
    const d = dir(bn);
    const t = thickV(bn);
    const len = scale(bn).len ?? 1;
    const np = newPos.get(bn)!;
    const fwd = (p: V3): V3 => {
      const o = sub(p, b.pos);
      const along = dot(o, d);
      const perp = sub(o, scl(d, along));
      return addv(np, addv(scl(d, along * len), [perp[0] * t[0], perp[1] * t[1], perp[2] * t[2]]));
    };
    const back = (p: V3): V3 => {
      const o = sub(p, np);
      const along = dot(o, d);
      const perp = sub(o, scl(d, along));
      return addv(b.pos, addv(scl(d, along / len), [perp[0] / t[0], perp[1] / t[1], perp[2] / t[2]]));
    };
    return { fwd, back, t, len };
  };

  const outPrims: Prim[] = [];
  const toOrig: ((p: V3) => V3)[] = [];
  const girth: number[] = [];
  for (const q of prims) {
    const m = map(q.bone);
    const tAvg = (m.t[0] + m.t[1] + m.t[2]) / 3;
    const n: Prim = { ...q, a: m.fwd(q.a), b: m.fwd(q.b), ra: q.ra * tAvg, rb: q.rb * tAvg, k: q.k * Math.min(tAvg, 2) };
    if (q.r) {
      // Ellipsoid radii: the along-axis one follows the bone length when the axis is the bone's.
      const ax = norm(sub(q.b, q.a));
      const alongBone = Math.abs(dot(ax, dir(q.bone))) > 0.8;
      n.r = [q.r[0] * tAvg, q.r[1] * (alongBone ? m.len : m.t[1]), q.r[2] * tAvg];
      // Axis-aligned ellipsoids keep x/y/z meaning: scale per axis.
      if (Math.abs(ax[1] - 1) < 1e-6) n.r = [q.r[0] * m.t[0], q.r[1] * m.t[1], q.r[2] * m.t[2]];
    }
    outPrims.push(n);
    toOrig.push(m.back);
    girth.push(tAvg);
  }
  const outBones = bones.map((b) => ({ ...b, pos: newPos.get(b.name)! }));
  return { bones: outBones, prims: outPrims, toOrig, girth, hemY: map('spine1').fwd([0, CLOTH.hemY, 0.1])[1] };
}
