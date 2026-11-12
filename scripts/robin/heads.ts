/**
 * Heads sculpted to match a face photo (measured from the aligned front photo and the side
 * profiles), so the projected photo sits on matching relief: nose on the nose, lips on the lips,
 * chin on the chin. Built in a face frame: origin between the pupils (on the cornea plane),
 * x right, y up, z forward, unit = the eye distance D (≈ 6.3 cm on a real face).
 *
 * Hair is real geometry: a volume clipped at a hairline (front / sides / back), with clumpy noise.
 */
import type { Prim, Region, V3 } from './anatomy.ts';

export interface FaceParams {
  /** Face width at the eyes / at the mouth / jaw width (in D). */
  wEye: number;
  wMouth: number;
  wJaw: number;
  /** Brow ridge: how far forward and how heavy. */
  browZ: number;
  browR: number;
  /** Nose tip height (below the eyes, negative) and projection; nostril width. */
  noseY: number;
  noseZ: number;
  noseW: number;
  /** Mouth line height, width, lip fullness. */
  mouthY: number;
  mouthW: number;
  lips: number;
  /** Chin bottom height, projection, width. */
  chinY: number;
  chinZ: number;
  chinW: number;
  /** Ear size. */
  ear: number;
  /** Cranium scale (x, y, z). */
  skull: V3;
  hair: { vol: V3; centre: V3; front: number; side: number; back: number; mess: number };
}

export interface HairClip {
  origin: V3;
  D: number;
  front: number;
  side: number;
  back: number;
  mess: number;
}

/** Hairline height (face units) at depth z (face units). */
export function hairline(c: HairClip, z: number): number {
  const s = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  return z > -0.6 ? c.side + (c.front - c.side) * s(-0.6, 0.05, z) : c.back + (c.side - c.back) * s(-2.0, -1.0, z);
}

export const LEO_FACE: FaceParams = {
  wEye: 2.6,
  wMouth: 2.3,
  wJaw: 2.3,
  browZ: 0.34,
  browR: 0.21,
  noseY: -0.7,
  noseZ: 0.62,
  noseW: 0.75,
  mouthY: -1.17,
  mouthW: 1.0,
  lips: 1.15,
  chinY: -1.47,
  chinZ: 0.22,
  chinW: 1.15,
  ear: 1.0,
  skull: [1.06, 1.0, 1.0],
  hair: { vol: [1.42, 1.56, 1.66], centre: [0, 0.62, -1.24], front: 1.18, side: 0.35, back: -1.25, mess: 0.75 },
};

export const JOVAN_FACE: FaceParams = {
  wEye: 2.07,
  wMouth: 1.8,
  wJaw: 1.75,
  browZ: 0.26,
  browR: 0.15,
  noseY: -0.78,
  noseZ: 0.74,
  noseW: 0.6,
  mouthY: -1.2,
  mouthW: 0.72,
  lips: 0.9,
  chinY: -1.62,
  chinZ: 0.16,
  chinW: 0.8,
  ear: 1.25,
  skull: [0.92, 1.05, 1.0],
  hair: { vol: [1.6, 1.88, 1.88], centre: [0, 0.55, -1.12], front: 0.42, side: -0.6, back: -1.55, mess: 2.0 },
};

/**
 * Push the head's primitives (bone 'head'), placed at `origin` (between the pupils, world/authored
 * space) with eye distance `D` metres.
 */
export function buildFaceHead(f: FaceParams, origin: V3, D: number, prims: Prim[]) {
  const P = (v: V3): V3 => [origin[0] + v[0] * D, origin[1] + v[1] * D, origin[2] + v[2] * D];
  const push = (q: Omit<Prim, 'bone'>) => prims.push({ ...q, a: q.a, b: q.b, bone: 'head' } as Prim);
  const ell = (c: V3, r: V3, k: number, to?: V3, region?: Region, sub = false) =>
    push({ kind: 'ell', a: P(c), b: to ? P(to) : P([c[0], c[1] + 1, c[2]]), ra: 0, rb: 0, r: [r[0] * D, r[1] * D, r[2] * D], k: k * D, region, sub });
  const cone = (a: V3, ra: number, b: V3, rb: number, k: number, region?: Region) => push({ kind: 'cone', a: P(a), b: P(b), ra: ra * D, rb: rb * D, k: k * D, region });
  const sph = (c: V3, r: number, k: number) => cone(c, r, c, r, k);
  const hw = f.wEye / 2;

  // Masses first: cranium, forehead, mid-face, mandible, cheekbones, cheeks, jaw, ears.
  ell([0, 0.45, -1.2], [1.23 * f.skull[0] * (hw / 1.2), 1.5 * f.skull[1], 1.55 * f.skull[2]], 0.25);
  ell([0, 0.55, -0.35], [hw * 0.82, 0.75, 0.55], 0.3);
  ell([0, -0.5, -0.55], [hw * 0.85, 0.75, 0.75], 0.3);
  ell([0, -1.0, -0.6], [f.wJaw * 0.45, 0.55, 0.65], 0.3);
  for (const s of [1, -1]) {
    ell([s * hw * 0.72, -0.28, -0.25], [0.38, 0.26, 0.38], 0.25);
    ell([s * f.wMouth * 0.26, -0.72, -0.12], [0.45, 0.42, 0.4], 0.3);
    cone([s * f.chinW * 0.28, f.chinY + 0.2, f.chinZ - 0.25], 0.22, [s * f.wJaw * 0.47, -0.95, -1.0], 0.26, 0.25);
    ell([s * (hw * 0.98 + 0.05), -0.22, -1.25], [0.11 * f.ear, 0.48 * f.ear, 0.3 * f.ear], 0.06);
  }
  // Eye sockets carved, then the eyeballs under the lids.
  for (const s of [1, -1]) ell([s * 0.5, 0.03, 0.08], [0.3, 0.2, 0.16], 0.12, undefined, undefined, true);
  for (const s of [1, -1]) sph([s * 0.5, 0.0, -0.2], 0.2, 0.06);
  // Brow ridge.
  cone([-hw * 0.55, 0.24, f.browZ - f.browR], f.browR, [hw * 0.55, 0.24, f.browZ - f.browR], f.browR, 0.25);
  // Nose: bridge from between the eyes to the tip, ball of the tip, the wings.
  cone([0, 0.06, 0.18], 0.12, [0, f.noseY + 0.12, f.noseZ - 0.12], 0.13, 0.12);
  sph([0, f.noseY + 0.02, f.noseZ - 0.16], 0.17, 0.1);
  for (const s of [1, -1]) sph([s * f.noseW * 0.36, f.noseY - 0.02, f.noseZ - 0.45], 0.15, 0.1);
  // Upper jaw under the nose, lips, the chin.
  ell([0, (f.noseY + f.mouthY) / 2 - 0.03, 0.12], [f.mouthW * 0.6, 0.22, 0.3], 0.2);
  ell([0, f.mouthY + 0.06, 0.26], [f.mouthW * 0.5, 0.075 * f.lips, 0.12 * f.lips], 0.08);
  ell([0, f.mouthY - 0.09, 0.22], [f.mouthW * 0.45, 0.09 * f.lips, 0.13 * f.lips], 0.08);
  ell([0, f.chinY + 0.26, f.chinZ - 0.05], [f.chinW * 0.4, 0.3, 0.26], 0.15);

  // Hair: a volume, clipped at the hairline, clumpy.
  const h = f.hair;
  const clip: HairClip = { origin, D, front: h.front, side: h.side, back: h.back, mess: h.mess };
  push({ kind: 'ell', a: P(h.centre), b: P([h.centre[0], h.centre[1] + 1, h.centre[2]]), ra: 0, rb: 0, r: [h.vol[0] * D, h.vol[1] * D, h.vol[2] * D], k: 0.06 * D, region: 'hair', clip });
}
