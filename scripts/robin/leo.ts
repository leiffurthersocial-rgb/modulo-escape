/**
 * Leo's anatomy: his own sculpt on the shared 53-bone skeleton (same bone names as anatomy.ts, so
 * the animation rig drives him too). A hulking brute: barrel chest and gut, a hump of trapezius
 * with the small head sunk forward in front of it, boulder shoulders, arms nearly as long as he is
 * tall with enormous forearms and fists (he walks on his knuckles), short thick bowed legs and wide
 * feet. Wears what's left of a T-shirt (burst at the back, torn wide open at the chest, sleeves gone)
 * and ragged shorts.
 */
import type { BoneDef, Prim, Region, V3 } from './anatomy.ts';
import { buildFaceHead, LEO_FACE } from './heads.ts';

/** Overall scale of the sculpt below. */
export const LEO_SCALE = 1.08;

export interface ClothHelpers {
  noise: (x: number, y: number, z: number) => number;
  fbm: (x: number, y: number, z: number, o?: number) => number;
  /** Position along a bone (0 at its joint, 1 at its first child). */
  along: (bone: string, p: V3) => number;
}
export type ClothFn = (p: V3, bone: string, h: ClothHelpers) => Region;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rot = (v: V3, k: V3, t: number): V3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const kv = cross(k, v);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [v[0] * c + kv[0] * s + k[0] * d * (1 - c), v[1] * c + kv[1] * s + k[1] * d * (1 - c), v[2] * c + kv[2] * s + k[2] * d * (1 - c)];
};

/** Eye line and half eye distance (unscaled), for the face photo. */
const EYE_Y = 2.52;
const EYE_HALF = 0.056;
const HEM_Y = 1.2;

export function buildLeoAnatomy() {
  const bones: BoneDef[] = [];
  const prims: Prim[] = [];
  const bone = (name: string, parent: string | null, pos: V3) => bones.push({ name, parent, pos });
  const cone = (bn: string, a: V3, ra: number, b: V3, rb: number, k: number, region?: Region) => prims.push({ kind: 'cone', a, b, ra, rb, k, bone: bn, region });
  const sphere = (bn: string, c: V3, r: number, k: number, region?: Region) => prims.push({ kind: 'cone', a: c, b: c, ra: r, rb: r, k, bone: bn, region });
  const ell = (bn: string, c: V3, r: V3, k: number, axisTo?: V3, region?: Region) => prims.push({ kind: 'ell', a: c, b: axisTo ?? add(c, [0, 1, 0]), ra: 0, rb: 0, r, k, bone: bn, region });
  const carve = (bn: string, c: V3, r: V3, k: number) => prims.push({ kind: 'ell', a: c, b: add(c, [0, 1, 0]), ra: 0, rb: 0, r, k, sub: true, bone: bn });

  // ── spine, neck, head ──
  bone('hips', null, [0, 1.0, 0]);
  bone('spine1', 'hips', [0, 1.2, -0.01]);
  bone('spine2', 'spine1', [0, 1.47, -0.03]);
  bone('chest', 'spine2', [0, 1.76, -0.04]);
  bone('neck1', 'chest', [0, 2.08, 0.0]);
  bone('neck2', 'neck1', [0, 2.22, 0.08]);
  bone('head', 'neck2', [0, 2.34, 0.15]);

  // A V-taper: narrow, hard waist; everything above it flares out. Tight blend radii keep the
  // muscles separate (grooves between them) instead of melting into fat.
  ell('hips', [0, 1.0, -0.02], [0.3, 0.19, 0.22], 0.05);
  for (const s of [1, -1]) ell('hips', [s * 0.14, 0.95, -0.13], [0.16, 0.17, 0.13], 0.04);
  ell('spine1', [0, 1.3, 0.0], [0.27, 0.27, 0.21], 0.06);
  ell('spine2', [0, 1.5, 0.0], [0.27, 0.2, 0.18], 0.06);
  // Ribcage: the frame the chest and back sit on.
  ell('chest', [0, 1.74, -0.05], [0.38, 0.34, 0.27], 0.06);
  for (const s of [1, -1]) {
    const cl = `clavicle${s === 1 ? 'L' : 'R'}`;
    // Eight-pack, split down the middle; obliques; serratus fingers on the ribs.
    for (const [y, bn, rz] of [
      [1.17, 'spine1', 0.165],
      [1.29, 'spine1', 0.19],
      [1.41, 'spine2', 0.18],
      [1.53, 'spine2', 0.17],
    ] as const)
      ell(bn, [s * 0.072, y, rz], [0.068, 0.054, 0.035], 0.035);
    ell('spine1', [s * 0.22, 1.28, 0.04], [0.07, 0.17, 0.13], 0.04);
    for (let i = 0; i < 3; i++) ell('chest', [s * 0.33, 1.55 + i * 0.075, 0.1 - i * 0.02], [0.045, 0.03, 0.05], 0.018);
    // Pecs: broad slabs with a hard lower edge, tied into the shoulders.
    ell('chest', [s * 0.18, 1.86, 0.17], [0.2, 0.135, 0.1], 0.035);
    cone('chest', [s * 0.22, 1.9, 0.16], 0.085, [s * 0.52, 1.98, 0.1], 0.075, 0.035);
    // Lats: wings from the armpits down to the waist.
    ell('chest', [s * 0.33, 1.62, -0.1], [0.13, 0.34, 0.16], 0.04, [s * 0.48, 1.95, -0.06]);
    // Traps sweeping out to the shoulders; upper back; erector ridges down the spine.
    cone('chest', [0, 2.18, -0.08], 0.13, [s * 0.5, 2.1, -0.05], 0.1, 0.05);
    ell('chest', [s * 0.15, 1.88, -0.25], [0.15, 0.15, 0.08], 0.04);
    cone('spine1', [s * 0.07, 1.08, -0.17], 0.07, [s * 0.07, 1.55, -0.24], 0.07, 0.04);
    cone(cl, [s * 0.12, 2.06, 0.08], 0.07, [s * 0.55, 2.1, 0.0], 0.08, 0.05);
    // Neck: thick, with the cords standing out.
    cone('neck1', [s * 0.06, 2.0, 0.12], 0.045, [s * 0.1, 2.36, 0.06], 0.04, 0.03);
  }
  ell('chest', [0, 2.04, -0.12], [0.3, 0.16, 0.18], 0.05);
  carve('chest', [0, 1.7, -0.33], [0.03, 0.3, 0.04], 0.05);
  carve('spine1', [0, 1.35, 0.235], [0.012, 0.25, 0.03], 0.02); // linea alba
  cone('neck1', [0, 1.98, -0.05], 0.17, [0, 2.24, 0.02], 0.135, 0.06);
  cone('neck2', [0, 2.22, 0.03], 0.13, [0, 2.41, 0.09], 0.105, 0.05);
  // Head: sculpted to match Leo's photo (heads.ts), eyes at EYE_Y.
  buildFaceHead(LEO_FACE, [0, EYE_Y, 0.27], 2 * EYE_HALF, prims);

  // ── arms: boulder shoulders, huge forearms, fists ──
  for (const [s, side] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const X = (v: V3): V3 => [s * v[0], v[1], v[2]];
    const shoulder = X([0.6, 2.08, -0.02]);
    const u: V3 = norm(X([0.5, -0.866, 0])); // rest: hanging 30° out (as the shared rig expects)
    const elbow = add(shoulder, mul(u, 0.8));
    const wrist = add(elbow, mul(u, 0.78));
    bone(`clavicle${side}`, 'chest', X([0.12, 2.08, 0.06]));
    bone(`upperarm${side}`, `clavicle${side}`, shoulder);
    bone(`forearm${side}`, `upperarm${side}`, elbow);
    bone(`hand${side}`, `forearm${side}`, wrist);
    // Deltoid in three heads, biceps peak, triceps horseshoe, forearms like hams.
    ell(`upperarm${side}`, X([0.61, 2.06, 0.09]), [0.12, 0.17, 0.11], 0.03);
    ell(`upperarm${side}`, X([0.7, 2.05, 0]), [0.13, 0.18, 0.13], 0.03);
    ell(`upperarm${side}`, X([0.61, 2.06, -0.09]), [0.12, 0.16, 0.11], 0.03);
    cone(`upperarm${side}`, shoulder, 0.13, elbow, 0.1, 0.04);
    const outw: V3 = X([0.866, 0.5, 0]);
    ell(`upperarm${side}`, add(add(shoulder, mul(u, 0.46)), [0, 0, 0.075]), [0.13, 0.25, 0.14], 0.03, elbow);
    ell(`upperarm${side}`, add(add(shoulder, mul(u, 0.35)), [0, 0, -0.08]), [0.12, 0.28, 0.12], 0.03, elbow);
    ell(`upperarm${side}`, add(add(shoulder, mul(u, 0.4)), mul(outw, 0.06)), [0.1, 0.24, 0.1], 0.03, elbow);
    sphere(`forearm${side}`, add(elbow, [0, 0, -0.07]), 0.075, 0.035);
    cone(`forearm${side}`, elbow, 0.12, wrist, 0.1, 0.04);
    ell(`forearm${side}`, add(add(elbow, mul(u, 0.22)), [0, 0, 0.05]), [0.17, 0.3, 0.15], 0.04, wrist);
    ell(`forearm${side}`, add(add(elbow, mul(u, 0.3)), [0, 0, -0.06]), [0.15, 0.32, 0.13], 0.04, wrist);
    ell(`forearm${side}`, add(add(elbow, mul(u, 0.12)), mul(outw, 0.07)), [0.1, 0.18, 0.1], 0.03, wrist);
    // Hand: palm faces the thigh (n), fingers spread along ±z. Thick, short fingers; blunt claws.
    const n: V3 = norm(X([-0.866, -0.5, 0]));
    const zA: V3 = [0, 0, 1];
    const handP = prims.length;
    const handB = bones.length;
    const palmC = add(wrist, mul(u, 0.1));
    ell(`hand${side}`, palmC, [0.06, 0.11, 0.11], 0.04, add(palmC, u));
    const fingers: { name: string; dz: number; len: [number, number, number] }[] = [
      { name: 'index', dz: 0.075, len: [0.1, 0.072, 0.058] },
      { name: 'middle', dz: 0.025, len: [0.108, 0.078, 0.062] },
      { name: 'ring', dz: -0.025, len: [0.102, 0.074, 0.058] },
      { name: 'pinky', dz: -0.072, len: [0.085, 0.062, 0.05] },
    ];
    for (const f of fingers) {
      const knuckle = add(add(wrist, mul(u, 0.2)), mul(zA, f.dz));
      let dir = norm(add(u, mul(zA, f.dz * 1.2)));
      const curlAxis = norm(cross(dir, n));
      sphere(`hand${side}`, add(knuckle, mul(n, -0.016)), 0.046, 0.009);
      let p = knuckle;
      let r = 0.036;
      for (let j = 0; j < 3; j++) {
        dir = norm(rot(dir, curlAxis, j === 0 ? 0.1 : 0.2));
        const bn = `${f.name}${j + 1}${side}`;
        bone(bn, j === 0 ? `hand${side}` : `${f.name}${j}${side}`, p);
        const q = add(p, mul(dir, f.len[j]!));
        const r2 = r * 0.9;
        cone(bn, p, r, q, r2, 0.006);
        if (j < 2) sphere(bn, q, r2 * 1.1, 0.01);
        else cone(bn, add(add(p, mul(dir, f.len[j]! * 0.4)), mul(n, -r2 * 0.75)), r2 * 0.7, add(add(q, mul(dir, 0.022)), mul(n, 0.004)), 0.004, 0.006, 'nail');
        p = q;
        r = r2;
      }
    }
    {
      const base = add(add(wrist, mul(u, 0.05)), add(mul(zA, 0.085), mul(n, 0.03)));
      let dir = norm(add(add(mul(u, 0.55), mul(zA, 0.75)), mul(n, 0.35)));
      const lens = [0.085, 0.07, 0.055];
      let p = base;
      let r = 0.042;
      for (let j = 0; j < 3; j++) {
        const bn = `thumb${j + 1}${side}`;
        bone(bn, j === 0 ? `hand${side}` : `thumb${j}${side}`, p);
        dir = norm(rot(dir, norm(cross(dir, n)), 0.15));
        const q = add(p, mul(dir, lens[j]!));
        const r2 = r * 0.86;
        cone(bn, p, r, q, r2, j === 0 ? 0.03 : 0.01);
        if (j === 2) cone(bn, add(add(p, mul(dir, 0.02)), mul(n, -r2 * 0.7)), r2 * 0.7, add(add(q, mul(dir, 0.02)), mul(n, 0.004)), 0.004, 0.006, 'nail');
        else sphere(bn, q, r2 * 1.08, 0.01);
        p = q;
        r = r2;
      }
    }
    // Big fists: scale the whole hand about the wrist.
    const HSC = 1.3;
    const about = (v: V3): V3 => add(wrist, mul(add(v, mul(wrist, -1)), HSC));
    for (let i = handP; i < prims.length; i++) {
      const q = prims[i]!;
      q.a = about(q.a);
      q.b = about(q.b);
      q.ra *= HSC;
      q.rb *= HSC;
      q.k *= HSC;
      if (q.r) q.r = mul(q.r, HSC);
    }
    for (let i = handB; i < bones.length; i++) bones[i]!.pos = about(bones[i]!.pos);
  }

  // ── legs: short, thick, bowed; wide feet ──
  for (const [s, side] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const X = (v: V3): V3 => [s * v[0], v[1], v[2]];
    const hip = X([0.22, 0.95, 0]);
    const knee = X([0.28, 0.53, 0.07]);
    const ankle = X([0.29, 0.13, -0.02]);
    const ball = X([0.31, 0.04, 0.2]);
    bone(`thigh${side}`, 'hips', hip);
    bone(`shin${side}`, `thigh${side}`, knee);
    bone(`foot${side}`, `shin${side}`, ankle);
    bone(`toes${side}`, `foot${side}`, ball);
    // Quads in their separate heads (teardrop over the knee), hamstrings, split calves.
    cone(`thigh${side}`, hip, 0.17, knee, 0.11, 0.04);
    ell(`thigh${side}`, X([0.27, 0.78, 0.11]), [0.1, 0.24, 0.09], 0.03, knee);
    ell(`thigh${side}`, X([0.36, 0.78, 0.03]), [0.1, 0.26, 0.12], 0.03, knee);
    ell(`thigh${side}`, X([0.2, 0.62, 0.08]), [0.09, 0.12, 0.09], 0.03, knee);
    ell(`thigh${side}`, X([0.27, 0.8, -0.1]), [0.12, 0.25, 0.11], 0.03, knee);
    ell(`thigh${side}`, X([0.15, 0.82, 0]), [0.08, 0.18, 0.1], 0.04);
    ell(`shin${side}`, add(knee, [0, 0, 0.09]), [0.06, 0.065, 0.035], 0.03);
    cone(`shin${side}`, knee, 0.1, ankle, 0.075, 0.04);
    ell(`shin${side}`, X([0.33, 0.4, -0.08]), [0.08, 0.16, 0.09], 0.03, ankle);
    ell(`shin${side}`, X([0.25, 0.41, -0.08]), [0.08, 0.17, 0.09], 0.03, ankle);
    ell(`shin${side}`, X([0.29, 0.27, -0.05]), [0.1, 0.14, 0.08], 0.04, ankle);
    cone(`shin${side}`, X([0.3, 0.48, 0.07]), 0.04, X([0.3, 0.2, 0.04]), 0.03, 0.03);
    sphere(`shin${side}`, X([0.34, 0.12, -0.02]), 0.04, 0.03);
    sphere(`shin${side}`, X([0.24, 0.13, -0.02]), 0.04, 0.03);
    cone(`foot${side}`, X([0.29, 0.07, -0.1]), 0.07, ball, 0.055, 0.05);
    ell(`foot${side}`, X([0.3, 0.05, 0.07]), [0.045, 0.14, 0.1], 0.04, ball);
    [0.24, 0.28, 0.32, 0.36].forEach((x, i) => {
      const base: V3 = X([x, 0.035, 0.21 - Math.abs(i - 1.2) * 0.02]);
      const tip = add(base, X([(x - 0.3) * 0.3, -0.005, 0.07]));
      cone(`toes${side}`, base, 0.03, tip, 0.024, 0.012);
      cone(`toes${side}`, add(base, [0, 0.015, 0.03]), 0.016, add(tip, [0, 0.008, 0.012]), 0.004, 0.006, 'nail');
    });
  }

  // Scale everything.
  const S = LEO_SCALE;
  const sc = (v: V3): V3 => [v[0] * S, v[1] * S, v[2] * S];
  for (const b of bones) b.pos = sc(b.pos);
  for (const q of prims) {
    q.a = sc(q.a);
    q.b = sc(q.b);
    q.ra *= S;
    q.rb *= S;
    q.k *= S;
    if (q.r) q.r = sc(q.r);
    if (q.clip) q.clip = { ...q.clip, origin: sc(q.clip.origin), D: q.clip.D * S };
  }

  /** The shirt is burst, ripped and sleeveless; ragged shorts. (Rules in unscaled space.) */
  // LEO_SHIRT=none (default: bare-chested, shorts only) | torn | full — to compare looks.
  const shirtStyle = (typeof process !== 'undefined' && process.env.LEO_SHIRT) || 'none';
  const cloth: ClothFn = (p0, b, h) => {
    const [x, y, z]: V3 = [p0[0] / S, p0[1] / S, p0[2] / S];
    if (shirtStyle !== 'torn') {
      const torso = b === 'chest' || b === 'spine2' || b.startsWith('clavicle') || b === 'spine1' || b === 'neck1';
      const neck = Math.hypot(x, (z + 0.02) * 1.1) < 0.24 && y > 1.98;
      const waist = 1.15 + 0.02 * h.noise(x * 15, 0, z * 15);
      if (shirtStyle === 'full' && torso && y > HEM_Y - 0.02) return neck ? 'skin' : 'shirt';
      if (shirtStyle === 'full' && b.startsWith('upperarm')) return h.along(b, p0) < 0.45 ? 'shirt' : 'skin';
      if (b === 'hips' || (b === 'spine1' && y < waist)) return y < waist ? 'pants' : 'skin';
      if (b.startsWith('thigh')) return h.along(b, p0) < 0.48 + 0.1 * h.fbm(x * 18, y * 7, z * 18, 2) ? 'pants' : 'skin';
      return 'skin';
    }
    const torso = b === 'chest' || b === 'spine2' || b.startsWith('clavicle') || b === 'spine1' || b === 'neck1';
    const hole = h.fbm(x * 3.2 + 3, y * 3.2, z * 3.2 + 7, 3) > 0.12;
    const rip = z > 0.12 && y > 1.42 && Math.abs(x - 0.06 - 0.05 * Math.sin(y * 12)) < 0.05 + 0.12 * (y - 1.42);
    const burst = z < -0.18 && y > 1.38 && Math.abs(x + 0.05 * Math.sin(y * 9)) < 0.05 + 0.16 * (y - 1.38);
    const torn = hole || rip || burst;
    const hem = HEM_Y + 0.07 * h.fbm(x * 6, 0, z * 6, 2) + 0.05 * Math.max(0, h.noise(x * 25, 3.3, z * 25));
    const neck = Math.hypot(x, (z + 0.02) * 1.1) < 0.25 + 0.03 * h.noise(x * 20, 1, z * 20) && y > 1.98;
    const waist = 1.15 + 0.02 * h.noise(x * 15, 0, z * 15);
    if (torso && y > hem) return !torn && !neck ? 'shirt' : 'skin';
    if (b.startsWith('upperarm')) return h.along(b, p0) < 0.1 + 0.08 * h.noise(x * 20, y * 20, z * 20) && !hole ? 'shirt' : 'skin';
    if (b === 'hips' || (b === 'spine1' && y < waist)) return y < waist ? 'pants' : 'skin';
    if (b.startsWith('thigh')) return h.along(b, p0) < 0.48 + 0.1 * h.fbm(x * 18, y * 7, z * 18, 2) ? 'pants' : 'skin';
    return 'skin';
  };
  const meta = { eyeY: EYE_Y * S, eyeHalf: EYE_HALF * S, eyeZ: 0.27 * S, collarY: 2.0 * S, shirtHalfWidth: 0.5 * S, hemY: HEM_Y * S };
  return { bones, prims, cloth, meta };
}
