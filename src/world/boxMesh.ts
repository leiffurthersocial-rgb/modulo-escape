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
