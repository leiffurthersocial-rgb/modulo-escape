import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropSlot, PropType } from '../gen/types.ts';
import { STOREY_HEIGHT } from '../gen/config.ts';

/** Greybox prop geometry, authored with the base at y = 0. Phase 2 swaps these for glTF by type. */
export function makePropGeometries(): Map<PropType, THREE.BufferGeometry> {
  const m = new Map<PropType, THREE.BufferGeometry>();
  const rubble = new THREE.DodecahedronGeometry(0.42, 0);
  rubble.scale(1, 0.45, 1);
  rubble.translate(0, 0.15, 0);
  m.set('rubble', rubble);
  const debris = new THREE.BoxGeometry(0.6, 0.12, 0.4);
  debris.rotateZ(0.12);
  debris.translate(0, 0.08, 0);
  m.set('debris', debris);
  m.set('barrel', new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12).translate(0, 0.45, 0));
  const slab = new THREE.BoxGeometry(1.1, 0.2, 0.8);
  slab.rotateX(0.4);
  slab.rotateZ(0.2);
  slab.translate(0, 0.3, 0);
  m.set('collapsed_slab', slab);
  m.set('vegetation', new THREE.ConeGeometry(0.45, 0.9, 6).translate(0, 0.45, 0));
  m.set('chair', new THREE.BoxGeometry(0.45, 0.85, 0.45).translate(0, 0.425, 0));
  m.set('desk', new THREE.BoxGeometry(1.0, 0.75, 0.6).translate(0, 0.375, 0));
  m.set('classroom_desk', new THREE.BoxGeometry(0.7, 0.75, 0.5).translate(0, 0.375, 0));
  // Blackboard: 3 m slate with a frame and chalk ledge, its back on local -z (against the front wall).
  m.set(
    'blackboard',
    mergeGeometries([
      new THREE.BoxGeometry(3.1, 1.3, 0.04).translate(0, 1.55, 0.02),
      new THREE.BoxGeometry(3.2, 0.06, 0.06).translate(0, 0.88, 0.05),
      new THREE.BoxGeometry(3.2, 0.06, 0.03).translate(0, 2.23, 0.03),
    ])!,
  );
  // Pipe: horizontal along X near the ceiling.
  m.set('pipe', new THREE.CylinderGeometry(0.08, 0.08, 4, 8).rotateZ(Math.PI / 2).translate(0, STOREY_HEIGHT - 0.45, 0));
  // ── Code-built KZU furniture: authored along X (w), depth along Z (d), front facing +Z, base y=0. ──
  const B = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
  const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => g.toNonIndexed()))!;
  // Lab bench: carcass, dark worktop, a sink and a gas tap.
  m.set('lab_bench', merge([B(2.6, 0.86, 0.74, 0, 0, -0.03), B(2.64, 0.05, 0.8, 0, 0.86), B(0.5, 0.06, 0.4, 0.7, 0.91, -0.05), B(0.04, 0.3, 0.04, 0.7, 0.91, -0.3), B(0.04, 0.04, 0.18, 0.7, 1.18, -0.22)]));
  // Mensa counter with a tray rail and a sneeze guard.
  m.set('counter', merge([B(3.0, 0.92, 0.7), B(3.04, 0.05, 0.8, 0, 0.92), B(3.0, 0.04, 0.22, 0, 0.82, 0.48), B(3.0, 0.02, 0.35, 0, 1.38, -0.05), B(0.03, 0.42, 0.03, -1.4, 0.95, 0.1), B(0.03, 0.42, 0.03, 1.4, 0.95, 0.1)]));
  m.set('stage', merge([B(3.4, 0.6, 1.05), B(3.42, 0.03, 1.07, 0, 0.6)]));
  // A short row of folding seats: backs, seats, armrests.
  const seats: THREE.BufferGeometry[] = [B(1.1, 0.04, 0.5, 0, 0.42, 0.02), B(1.1, 0.5, 0.05, 0, 0.45, -0.22)];
  for (const x of [-0.55, -0.18, 0.18, 0.55]) seats.push(B(0.04, 0.62, 0.45, x, 0, 0));
  m.set('seat_row', merge(seats));
  const bars: THREE.BufferGeometry[] = [];
  for (const x of [-1.38, -0.46, 0.46, 1.38]) bars.push(B(0.07, 2.5, 0.07, x, 0, 0));
  for (let y = 0.2; y < 2.5; y += 0.16) bars.push(new THREE.CylinderGeometry(0.018, 0.018, 2.76, 6).rotateZ(Math.PI / 2).translate(0, y, 0.0));
  m.set('wall_bars', merge(bars));
  // Basketball hoop (mounted high): backboard, ring, net-ish cone.
  m.set('hoop', merge([B(1.2, 0.8, 0.04, 0, 0.2, -0.22), new THREE.TorusGeometry(0.23, 0.015, 6, 16).rotateX(Math.PI / 2).translate(0, 0.3, 0.05), new THREE.CylinderGeometry(0.23, 0.15, 0.35, 10, 1, true).translate(0, 0.12, 0.05), B(0.06, 0.06, 0.3, 0, 0.27, -0.1)]));
  m.set('gym_mat', B(2.0, 0.08, 1.0));
  // Two WC cubicles: panels and doors left ajar.
  m.set('wc_stall', merge([B(2.6, 2.0, 0.04, 0, 0.05, -0.55), B(0.04, 2.0, 1.15, -1.28, 0.05, 0), B(0.04, 2.0, 1.15, 0, 0.05, 0), B(0.04, 2.0, 1.15, 1.28, 0.05, 0), B(0.62, 1.9, 0.04, -0.62, 0.1, 0.58), B(0.62, 1.9, 0.04, 0.45, 0.1, 0.7).rotateY(0.5), B(0.38, 0.42, 0.55, -0.64, 0, -0.25), B(0.38, 0.42, 0.55, 0.64, 0, -0.25)]));
  m.set('sink', merge([B(0.6, 0.18, 0.45, 0, 0.7), B(0.08, 0.7, 0.08, 0, 0, -0.12), B(0.04, 0.2, 0.04, 0, 0.88, -0.17), B(0.45, 0.6, 0.02, 0, 1.0, -0.21)]));
  // Upright piano: body, keyboard shelf, keys strip.
  m.set('piano', merge([B(1.5, 1.25, 0.45, 0, 0, -0.08), B(1.46, 0.08, 0.3, 0, 0.7, 0.2), B(1.3, 0.03, 0.14, 0, 0.78, 0.22), B(0.08, 0.7, 0.3, -0.7, 0, 0.2), B(0.08, 0.7, 0.3, 0.7, 0, 0.2)]));
  // Old CRT-ish monitor on a foot (stands on a desk).
  m.set('monitor', merge([B(0.2, 0.03, 0.16), B(0.05, 0.1, 0.05, 0, 0.03, 0), B(0.48, 0.34, 0.2, 0, 0.12, -0.02)]));
  const shelf: THREE.BufferGeometry[] = [B(0.04, 2.0, 0.45, -0.88, 0, 0), B(0.04, 2.0, 0.45, 0.88, 0, 0)];
  for (const y of [0.1, 0.55, 1.0, 1.45, 1.9]) shelf.push(B(1.8, 0.03, 0.45, 0, y, 0));
  m.set('shelf', merge(shelf));
  m.set('pinboard', B(1.2, 0.9, 0.03));
  m.set('model', B(0.3, 0.3, 0.3));
  return m;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

/** Instance transform for a prop slot. Pipes align with the wall they hug. */
export function propMatrix(p: PropSlot, cellSize: number): THREE.Matrix4 {
  let yaw = p.rot;
  let scale = p.scale;
  if (p.type === 'pipe') {
    const u = p.x - p.cx * cellSize;
    const nearXEdge = Math.abs(u - cellSize / 2) > 0.5; // slot on E/W wall → pipe runs along Z
    yaw = nearXEdge ? Math.PI / 2 : 0;
    scale = 1;
  }
  tmpQ.setFromAxisAngle(Y, yaw);
  tmpS.setScalar(scale);
  tmpP.set(p.x, p.y ?? 0, p.z);
  return tmpM.compose(tmpP, tmpQ, tmpS);
}
