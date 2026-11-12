/**
 * Robin's anatomy: skeleton (rest joint positions, model space, metres, Y up, facing +Z, feet on
 * y = 0) and the signed-distance primitives that are smooth-blended into one continuous skin.
 * The character's left is +X; the right side is mirrored.
 *
 * Proportions: a 3.1 m, emaciated humanoid — long neck, arms to the knees, long jointed fingers
 * with claws, visible ribs and spine, sunken belly — wearing the white T-shirt from the photo and
 * torn dark trousers. The head is sized so robin.png's face maps 1:1 (eyes ±4.3 cm at y 2.955).
 */
export type V3 = [number, number, number];

export interface BoneDef {
  name: string;
  parent: string | null;
  pos: V3;
}

export type Region = 'skin' | 'shirt' | 'pants' | 'hair' | 'nail';

export interface Prim {
  kind: 'cone' | 'ell' | 'hair';
  a: V3;
  b: V3;
  ra: number;
  rb: number;
  /** Ellipsoid radii (across1, along axis a→b, across2) — for 'ell'/'hair', a is the centre. */
  r?: V3;
  /** Blend radius into the body. */
  k: number;
  sub?: boolean;
  bone: string;
  region?: Region;
  /** Hair: clip below a hairline, clumpy surface (see heads.ts). Evaluated in authored space. */
  clip?: import('./heads.ts').HairClip;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Rotate v around unit axis k by angle t (Rodrigues). */
const rot = (v: V3, k: V3, t: number): V3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const kv = cross(k, v);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [v[0] * c + kv[0] * s + k[0] * d * (1 - c), v[1] * c + kv[1] * s + k[1] * d * (1 - c), v[2] * c + kv[2] * s + k[2] * d * (1 - c)];
};

/** Head scale (around the skull base) — big enough that the photo face reads from a distance. */
export const HEAD_SCALE = 1.32;
export const HEAD_PIVOT: V3 = [0, 2.84, 0];
const HS = (v: V3): V3 => [HEAD_PIVOT[0] + (v[0] - HEAD_PIVOT[0]) * HEAD_SCALE, HEAD_PIVOT[1] + (v[1] - HEAD_PIVOT[1]) * HEAD_SCALE, HEAD_PIVOT[2] + (v[2] - HEAD_PIVOT[2]) * HEAD_SCALE];

export function buildAnatomy(): { bones: BoneDef[]; prims: Prim[] } {
  const bones: BoneDef[] = [];
  const prims: Prim[] = [];
  const bone = (name: string, parent: string | null, pos: V3) => bones.push({ name, parent, pos });
  const cone = (bn: string, a: V3, ra: number, b: V3, rb: number, k: number, region?: Region) => prims.push({ kind: 'cone', a, b, ra, rb, k, bone: bn, region });
  const sphere = (bn: string, c: V3, r: number, k: number, region?: Region) => prims.push({ kind: 'cone', a: c, b: c, ra: r, rb: r, k, bone: bn, region });
  /** Ellipsoid: centre c, long axis towards `to` (radii [across, along, across2]). */
  const ell = (bn: string, c: V3, r: V3, k: number, axisTo?: V3, region?: Region) =>
    prims.push({ kind: 'ell', a: c, b: axisTo ?? add(c, [0, 1, 0]), ra: 0, rb: 0, r, k, bone: bn, region });
  const carve = (bn: string, c: V3, r: V3, k: number) => prims.push({ kind: 'ell', a: c, b: add(c, [0, 1, 0]), ra: 0, rb: 0, r, k, sub: true, bone: bn });

  // ── Spine, neck, head ──
  bone('hips', null, [0, 1.55, 0]);
  bone('spine1', 'hips', [0, 1.72, -0.005]);
  bone('spine2', 'spine1', [0, 1.95, -0.01]);
  bone('chest', 'spine2', [0, 2.2, -0.01]);
  bone('neck1', 'chest', [0, 2.5, -0.005]);
  bone('neck2', 'neck1', [0, 2.67, 0.0]);
  bone('head', 'neck2', [0, 2.84, 0.0]);

  // Pelvis, buttocks, hip crests (they jut out above the waistband).
  ell('hips', [0, 1.55, -0.005], [0.165, 0.12, 0.12], 0.05);
  ell('hips', [0.075, 1.48, -0.07], [0.075, 0.09, 0.065], 0.04);
  ell('hips', [-0.075, 1.48, -0.07], [0.075, 0.09, 0.065], 0.04);
  sphere('hips', [0.125, 1.67, 0.035], 0.03, 0.035);
  sphere('hips', [-0.125, 1.67, 0.035], 0.03, 0.035);
  // Abdomen: thin, belly sucked in under the ribs.
  cone('spine1', [0, 1.6, -0.005], 0.118, [0, 1.95, -0.012], 0.108, 0.05);
  // Ribcage and individual ribs.
  ell('chest', [0, 2.21, -0.01], [0.165, 0.245, 0.122], 0.04);
  for (const s of [1, -1]) {
    for (let i = 0; i < 9; i++) {
      const yBack = 2.42 - i * 0.04;
      const end = i < 6 ? 1.25 : 0.9 - (i - 6) * 0.25; // floating ribs stop short of the front
      const pts: V3[] = [];
      for (let t = 0; t <= 12; t++) {
        const ph = -Math.PI / 2 + (t / 12) * (Math.PI / 2 + end);
        const yy = yBack - 0.085 * (t / 12);
        const e = Math.max(0, 1 - ((yy - 2.21) / 0.26) ** 2);
        const rx = 0.168 * Math.sqrt(e) + 0.004;
        const rz = 0.125 * Math.sqrt(e) + 0.004;
        pts.push([s * rx * Math.cos(ph), yy, -0.01 + rz * Math.sin(ph)]);
      }
      for (let t = 0; t < pts.length - 1; t++) cone('chest', pts[t]!, 0.0115, pts[t + 1]!, 0.0115, 0.012);
    }
  }
  cone('chest', [0, 2.4, 0.118], 0.018, [0, 2.06, 0.118], 0.014, 0.025); // sternum
  // T-shirt: a cloth shell clinging to the ribcage (ribs press through), loose at the hem.
  ell('chest', [0, 2.24, -0.008], [0.171, 0.27, 0.131], 0.035);
  ell('spine2', [0, 2.02, -0.01], [0.158, 0.1, 0.122], 0.05);
  // Upper chest / shoulder girdle mass so the shirt hangs from the shoulders.
  ell('chest', [0, 2.41, -0.012], [0.255, 0.085, 0.118], 0.06);
  carve('spine1', [0, 1.83, 0.135], [0.1, 0.12, 0.05], 0.045); // sunken belly
  // Spine: a ridge of vertebrae down the back.
  for (let i = 0; i < 18; i++) {
    const y = 1.66 + i * 0.05;
    const bn = y < 1.95 ? 'spine1' : y < 2.2 ? 'spine2' : y < 2.48 ? 'chest' : 'neck1';
    const z = y > 2.45 ? -0.07 : -0.118 - 0.006 * Math.sin(((y - 1.66) / 0.8) * Math.PI);
    sphere(bn, [0, y, z], 0.017, 0.016);
  }
  // Shoulder blades, collarbones, trapezius.
  for (const s of [1, -1]) {
    ell('chest', [s * 0.105, 2.33, -0.108], [0.07, 0.1, 0.022], 0.03, [s * 0.09, 2.45, -0.11]);
    cone('chest', [s * 0.025, 2.465, 0.09], 0.015, [s * 0.27, 2.5, 0.02], 0.013, 0.02);
    cone('chest', [0, 2.6, -0.035], 0.045, [s * 0.27, 2.5, -0.02], 0.028, 0.05);
  }
  // Neck: long, with straining tendons and an Adam's apple.
  cone('neck1', [0, 2.45, -0.01], 0.06, [0, 2.67, 0.0], 0.052, 0.04);
  cone('neck2', [0, 2.67, 0.0], 0.052, [0, 2.86, 0.0], 0.05, 0.04);
  for (const s of [1, -1]) cone('neck2', [s * 0.03, 2.47, 0.08], 0.016, [s * 0.065, 2.83, -0.015], 0.014, 0.03);
  sphere('neck2', [0, 2.65, 0.06], 0.016, 0.02);
  const headStart = prims.length;
  // Head: cranium, jaw, cheekbones, brow, nose, lips, ears; eyes slightly sunken.
  ell('head', [0, 2.99, -0.005], [0.093, 0.125, 0.115], 0.03);
  cone('head', [0, 2.92, 0.015], 0.08, [0, 2.845, 0.07], 0.03, 0.05);
  for (const s of [1, -1]) {
    sphere('head', [s * 0.056, 2.925, 0.066], 0.034, 0.04);
    ell('head', [s * 0.1, 2.95, -0.005], [0.014, 0.034, 0.024], 0.012);
    carve('head', [s * 0.043, 2.957, 0.112], [0.022, 0.017, 0.016], 0.02);
    sphere('head', [s * 0.014, 2.917, 0.108], 0.01, 0.012);
  }
  cone('head', [-0.07, 2.99, 0.088], 0.016, [0.07, 2.99, 0.088], 0.016, 0.03);
  cone('head', [0, 2.965, 0.105], 0.011, [0, 2.92, 0.124], 0.016, 0.02);
  ell('head', [0, 2.877, 0.098], [0.03, 0.011, 0.013], 0.02, [0, 2.877 + 0.011, 0.098]);
  // Hair: a messy cap clipped at the hairline (fringe at the front, low at the back).
  prims.push({ kind: 'hair', a: [0, 3.0, -0.01], b: [0, 3.1, -0.01], ra: 0, rb: 0, r: [0.103, 0.13, 0.126], k: 0.012, bone: 'head', region: 'hair' });

  for (let i = headStart; i < prims.length; i++) {
    const q = prims[i]!;
    q.a = HS(q.a);
    q.b = HS(q.b);
    q.ra *= HEAD_SCALE;
    q.rb *= HEAD_SCALE;
    q.k *= HEAD_SCALE;
    if (q.r) q.r = [q.r[0] * HEAD_SCALE, q.r[1] * HEAD_SCALE, q.r[2] * HEAD_SCALE];
  }

  // ── Arms and hands ──
  for (const [s, side] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const X = (v: V3): V3 => [s * v[0], v[1], v[2]];
    const shoulder = X([0.3, 2.47, -0.01]);
    const u: V3 = norm(X([0.5, -0.866, 0])); // arm hangs 30° out
    const elbow = add(shoulder, mul(u, 0.62));
    const wrist = add(elbow, mul(u, 0.6));
    bone(`clavicle${side}`, 'chest', X([0.06, 2.48, 0.03]));
    bone(`upperarm${side}`, `clavicle${side}`, shoulder);
    bone(`forearm${side}`, `upperarm${side}`, elbow);
    bone(`hand${side}`, `forearm${side}`, wrist);
    ell(`upperarm${side}`, X([0.31, 2.44, -0.01]), [0.062, 0.088, 0.062], 0.04);
    cone(`upperarm${side}`, shoulder, 0.052, elbow, 0.036, 0.03);
    cone(`upperarm${side}`, add(shoulder, mul(u, 0.02)), 0.064, add(shoulder, mul(u, 0.27)), 0.054, 0.02); // sleeve
    ell(`upperarm${side}`, add(shoulder, mul(u, 0.3)), [0.042, 0.14, 0.046], 0.035, elbow); // biceps
    ell(`upperarm${side}`, add(add(shoulder, mul(u, 0.26)), [0, 0, -0.022]), [0.036, 0.15, 0.03], 0.035, elbow); // triceps
    sphere(`forearm${side}`, add(elbow, [0, 0, -0.032]), 0.034, 0.02); // bony elbow
    sphere(`forearm${side}`, add(elbow, [s * 0.018, 0, 0.012]), 0.026, 0.02);
    cone(`forearm${side}`, elbow, 0.041, wrist, 0.026, 0.03);
    ell(`forearm${side}`, add(elbow, mul(u, 0.15)), [0.048, 0.14, 0.04], 0.03, wrist); // forearm muscle
    // Tendons running down to the wrist, and the knobbly wrist bones.
    cone(`forearm${side}`, add(add(elbow, mul(u, 0.3)), [0, 0, 0.022]), 0.008, add(wrist, [0, 0, 0.016]), 0.007, 0.012);
    cone(`forearm${side}`, add(add(elbow, mul(u, 0.3)), [0, 0, -0.02]), 0.008, add(wrist, [0, 0, -0.015]), 0.007, 0.012);
    sphere(`forearm${side}`, add(wrist, [0, 0, -0.019]), 0.018, 0.012);
    sphere(`forearm${side}`, add(wrist, [0, 0, 0.017]), 0.014, 0.012);

    // Hand: palm faces the thigh (normal n), fingers spread along ±z.
    const n: V3 = norm(X([-0.866, -0.5, 0]));
    const zA: V3 = [0, 0, 1];
    const palmC = add(wrist, mul(u, 0.09));
    ell(`hand${side}`, palmC, [0.05, 0.1, 0.016], 0.018, add(palmC, u));
    const fingers: { name: string; dz: number; len: [number, number, number]; r: number }[] = [
      { name: 'index', dz: 0.05, len: [0.1, 0.07, 0.052], r: 0.0125 },
      { name: 'middle', dz: 0.017, len: [0.112, 0.08, 0.056], r: 0.013 },
      { name: 'ring', dz: -0.017, len: [0.104, 0.074, 0.052], r: 0.0122 },
      { name: 'pinky', dz: -0.05, len: [0.082, 0.056, 0.042], r: 0.011 },
    ];
    for (const f of fingers) {
      const knuckle = add(add(wrist, mul(u, 0.18)), mul(zA, f.dz));
      // Fingers splay outwards and curl slightly towards the palm.
      let dir = norm(add(u, mul(zA, f.dz * 3.2)));
      const curlAxis = norm(cross(dir, n));
      sphere(`hand${side}`, add(knuckle, mul(n, -0.004)), 0.014, 0.012);
      cone(`hand${side}`, add(wrist, add(mul(zA, f.dz * 0.5), mul(n, -0.012))), 0.0055, knuckle, 0.006, 0.008); // tendon
      let p = knuckle;
      let r = f.r;
      for (let j = 0; j < 3; j++) {
        dir = norm(rot(dir, curlAxis, j === 0 ? 0.12 : 0.22));
        const bn = `${f.name}${j + 1}${side}`;
        bone(bn, j === 0 ? `hand${side}` : `${f.name}${j}${side}`, p);
        const q = add(p, mul(dir, f.len[j]!));
        const r2 = r * (j === 2 ? 0.7 : 0.88);
        cone(bn, p, r, q, r2, 0.006);
        if (j < 2) sphere(bn, q, r2 * 1.12, 0.006);
        else {
          // Claw: a curved, pointed nail growing past the fingertip.
          const back = mul(n, -1);
          cone(bn, add(add(p, mul(dir, f.len[j]! * 0.45)), mul(back, r2 * 0.75)), r2 * 0.62, add(add(q, mul(dir, 0.03)), mul(n, 0.004)), 0.0012, 0.004, 'nail');
        }
        p = q;
        r = r2;
      }
    }
    // Thumb.
    {
      const base = add(add(wrist, mul(u, 0.035)), add(mul(zA, 0.035), mul(n, 0.012)));
      let dir = norm(add(add(mul(u, 0.55), mul(zA, 0.75)), mul(n, 0.35)));
      const lens = [0.07, 0.06, 0.046];
      let p = base;
      let r = 0.016;
      for (let j = 0; j < 3; j++) {
        const bn = `thumb${j + 1}${side}`;
        bone(bn, j === 0 ? `hand${side}` : `thumb${j}${side}`, p);
        dir = norm(rot(dir, norm(cross(dir, n)), 0.15));
        const q = add(p, mul(dir, lens[j]!));
        const r2 = r * 0.82;
        cone(bn, p, r, q, r2, j === 0 ? 0.016 : 0.006);
        if (j === 2) cone(bn, add(add(p, mul(dir, 0.02)), mul(n, -r2 * 0.7)), r2 * 0.65, add(add(q, mul(dir, 0.028)), mul(n, 0.004)), 0.0012, 0.004, 'nail');
        else sphere(bn, q, r2 * 1.1, 0.006);
        p = q;
        r = r2;
      }
    }
  }

  // ── Legs and feet ──
  for (const [s, side] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const X = (v: V3): V3 => [s * v[0], v[1], v[2]];
    const hip = X([0.12, 1.5, 0]);
    const knee = X([0.15, 0.8, 0.025]);
    const ankle = X([0.165, 0.11, -0.025]);
    const ball = X([0.18, 0.035, 0.15]);
    bone(`thigh${side}`, 'hips', hip);
    bone(`shin${side}`, `thigh${side}`, knee);
    bone(`foot${side}`, `shin${side}`, ankle);
    bone(`toes${side}`, `foot${side}`, ball);
    cone(`thigh${side}`, hip, 0.085, knee, 0.052, 0.04);
    ell(`thigh${side}`, X([0.14, 1.22, 0.035]), [0.055, 0.2, 0.05], 0.05, knee);
    ell(`shin${side}`, add(knee, [0, 0, 0.05]), [0.033, 0.038, 0.02], 0.02);
    cone(`shin${side}`, knee, 0.048, ankle, 0.028, 0.03);
    ell(`shin${side}`, X([0.155, 0.58, -0.035]), [0.04, 0.14, 0.042], 0.035, ankle);
    cone(`shin${side}`, X([0.15, 0.74, 0.045]), 0.012, X([0.165, 0.18, 0.018]), 0.01, 0.015);
    sphere(`shin${side}`, X([0.195, 0.105, -0.025]), 0.019, 0.012);
    sphere(`shin${side}`, X([0.135, 0.115, -0.022]), 0.019, 0.012);
    // Foot: heel, arch, tendons, long toes.
    cone(`foot${side}`, X([0.165, 0.055, -0.07]), 0.038, ball, 0.026, 0.03);
    ell(`foot${side}`, X([0.172, 0.045, 0.05]), [0.048, 0.11, 0.026], 0.025, ball);
    const toes: [number, number, number][] = [
      [0.142, 0.017, 0.012],
      [0.163, 0.013, 0.0],
      [0.18, 0.012, -0.006],
      [0.196, 0.011, -0.014],
      [0.21, 0.01, -0.024],
    ];
    toes.forEach(([x, r, dz], i) => {
      const base: V3 = X([x, 0.03, 0.155 + dz]);
      cone(`foot${side}`, X([x * 0.9 + 0.017, 0.075, -0.0]), 0.005, add(base, [0, 0.008, 0]), 0.005, 0.008);
      const d1 = norm(X([(x - 0.175) * 0.6, -0.12, 1]));
      const m = add(base, mul(d1, i === 0 ? 0.05 : 0.042));
      const tip = add(m, mul(norm(X([(x - 0.175) * 0.6, -0.35, 1])), i === 0 ? 0.034 : 0.03));
      cone(`toes${side}`, base, r, m, r * 0.9, 0.008);
      cone(`toes${side}`, m, r * 0.9, tip, r * 0.7, 0.005);
      cone(`toes${side}`, add(m, [0, r * 0.6, 0.005]), r * 0.55, add(tip, [0, 0.0, 0.012]), 0.0015, 0.004, 'nail');
    });
  }
  return { bones, prims };
}

/** Distance from the hem/collar rules to decide cloth (used by the sculpt and the masks). */
export const CLOTH = {
  hemY: 1.97,
  waistY: 1.7,
  collarY: 2.565,
};
