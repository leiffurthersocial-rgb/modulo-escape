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
  tmpP.set(p.x, 0, p.z);
  return tmpM.compose(tmpP, tmpQ, tmpS);
}
