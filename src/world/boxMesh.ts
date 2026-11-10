/** Writes axis-aligned boxes straight into one BufferGeometry (positions, normals, world-space UVs). */
import * as THREE from 'three';

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
  /** Optional linear RGB vertex colour. */
  color?: [number, number, number];
}

// 6 faces: normal, and the two in-plane axes used for the 4 corners.
const FACES: { n: [number, number, number]; corners: [number, number, number][] }[] = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

export function boxesToGeometry(boxes: AABB[], uvScale = 0.5): THREE.BufferGeometry {
  const pos = new Float32Array(boxes.length * 24 * 3);
  const nor = new Float32Array(boxes.length * 24 * 3);
  const uv = new Float32Array(boxes.length * 24 * 2);
  const withColor = boxes.some((b) => b.color);
  const col = withColor ? new Float32Array(boxes.length * 24 * 3) : null;
  const idx = new Uint32Array(boxes.length * 36);
  let v = 0;
  let k = 0;
  for (const b of boxes) {
    for (const f of FACES) {
      const base = v;
      for (const c of f.corners) {
        const x = c[0] ? b.max[0] : b.min[0];
        const y = c[1] ? b.max[1] : b.min[1];
        const z = c[2] ? b.max[2] : b.min[2];
        pos.set([x, y, z], v * 3);
        nor.set(f.n, v * 3);
        // World-space planar UVs (triplanar-ready): project onto the face plane.
        const [u, w] = f.n[0] !== 0 ? [z, y] : f.n[1] !== 0 ? [x, z] : [x, y];
        uv.set([u * uvScale, w * uvScale], v * 2);
        if (col) col.set(b.color ?? [1, 1, 1], v * 3);
        v++;
      }
      idx.set([base, base + 1, base + 2, base, base + 2, base + 3], k);
      k += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(v < 65536 ? new Uint16Array(idx) : idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export type SurfaceFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => [number, number, number];

/**
 * Like boxesToGeometry, but large faces are subdivided (≤ maxSeg metres) and every vertex gets a
 * `surface` attribute from `fn` (baked AO, moss mask, wet mask). Faces smaller than ~0.5 m stay single quads.
 */
export function boxesToSurfaceGeometry(boxes: AABB[], fn: SurfaceFn, maxSeg = 1, uvScale = 0.5): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const surf: number[] = [];
  const idx: number[] = [];
  for (const b of boxes) {
    for (const f of FACES) {
      // Face corners c0..c3; edges along (c1-c0) and (c3-c0).
      const P = f.corners.map((c) => [c[0] ? b.max[0] : b.min[0], c[1] ? b.max[1] : b.min[1], c[2] ? b.max[2] : b.min[2]] as const);
      const p0 = P[0]!;
      const p1 = P[1]!;
      const p3 = P[3]!;
      const e1 = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!];
      const e2 = [p3[0]! - p0[0]!, p3[1]! - p0[1]!, p3[2]! - p0[2]!];
      const l1 = Math.hypot(e1[0]!, e1[1]!, e1[2]!);
      const l2 = Math.hypot(e2[0]!, e2[1]!, e2[2]!);
      if (l1 < 1e-5 || l2 < 1e-5) continue;
      const n1 = l1 > 0.5 ? Math.max(1, Math.ceil(l1 / maxSeg)) : 1;
      const n2 = l2 > 0.5 ? Math.max(1, Math.ceil(l2 / maxSeg)) : 1;
      const base = pos.length / 3;
      for (let j = 0; j <= n2; j++) {
        for (let i = 0; i <= n1; i++) {
          const s = i / n1;
          const t = j / n2;
          const x = p0[0]! + e1[0]! * s + e2[0]! * t;
          const y = p0[1]! + e1[1]! * s + e2[1]! * t;
          const z = p0[2]! + e1[2]! * s + e2[2]! * t;
          pos.push(x, y, z);
          nor.push(...f.n);
          const [u, w] = f.n[0] !== 0 ? [z, y] : f.n[1] !== 0 ? [x, z] : [x, y];
          uv.push(u * uvScale, w * uvScale);
          surf.push(...fn(x, y, z, f.n[0], f.n[1], f.n[2]));
        }
      }
      for (let j = 0; j < n2; j++) {
        for (let i = 0; i < n1; i++) {
          const a = base + j * (n1 + 1) + i;
          const b2 = a + 1;
          const c = a + n1 + 2;
          const d = a + n1 + 1;
          idx.push(a, b2, c, a, c, d);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('surface', new THREE.Float32BufferAttribute(surf, 3));
  g.setIndex(pos.length / 3 < 65536 ? new THREE.Uint16BufferAttribute(idx, 1) : new THREE.Uint32BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
