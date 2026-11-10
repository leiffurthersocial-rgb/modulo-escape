/**
 * Stair flights between floors: visual steps (merged boxes, floor material) and the matching
 * smooth ramp used for collision. A flight rises along +Z over two cells, from the lower floor
 * (at the north edge of cell (x,z)) to the upper floor (at the south edge of (x,z+1)).
 */
import * as THREE from 'three';
import type { Building, Stair } from '../gen/types.ts';
import { WALL_THICKNESS } from '../gen/config.ts';
import { boxesToSurfaceGeometry, type AABB } from './boxMesh.ts';

export const STEPS = 22;

export function stairRamp(b: Building, s: Stair) {
  const S = b.cellSize;
  const y0 = s.lower * b.floorStep;
  const run = 2 * S;
  const rise = b.floorStep;
  const angle = Math.atan2(rise, run);
  const len = Math.hypot(run, rise);
  // Centre of the ramp's top surface, then pushed down by its half thickness along the normal.
  const cx = (s.x + 0.5) * S;
  const cz = s.z * S + run / 2;
  const cy = y0 + rise / 2;
  const n = new THREE.Vector3(0, Math.cos(angle), -Math.sin(angle));
  const center = new THREE.Vector3(cx, cy, cz).addScaledVector(n, -0.1);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -angle);
  return {
    center,
    rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
    halfLength: len / 2,
    halfWidth: S / 2 - WALL_THICKNESS / 2,
  };
}

/** World-space step geometry for all flights (with surface masks so they match the floors). */
export function buildStairsGeometry(b: Building): THREE.BufferGeometry | null {
  if (!b.stairs.length) return null;
  const S = b.cellSize;
  const boxes: AABB[] = [];
  for (const s of b.stairs) {
    const y0 = s.lower * b.floorStep;
    const tread = (2 * S) / STEPS;
    const riser = b.floorStep / STEPS;
    const x0 = s.x * S + WALL_THICKNESS / 2;
    const x1 = (s.x + 1) * S - WALL_THICKNESS / 2;
    for (let i = 0; i < STEPS; i++) {
      const z0 = s.z * S + i * tread;
      // Solid block from the floor up to this step's top (reads as a cast-concrete flight).
      boxes.push({ min: [x0, y0, z0], max: [x1, y0 + riser * (i + 1), z0 + tread] });
    }
  }
  // Concrete stairs: some wear at the edges, a bit damp, no puddles on steps.
  return boxesToSurfaceGeometry(boxes, (_x, _y, _z, _nx, ny) => [ny > 0.5 ? 0.35 : 0.25, 0.15, 0.3, 0], 2);
}
