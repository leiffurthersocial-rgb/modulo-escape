/**
 * U-shaped (switchback) staircases between floors (see `Stair`): visual steps (merged boxes,
 * floor material) and matching collision — a smooth ramp per flight plus the flat mid landing.
 *   flight A: cell (x,z), rises along +z from the floor to half height
 *   landing : cells (x,z+1) and (x+turn,z+1), flat at half height
 *   flight B: cell (x+turn,z), rises along −z from half height to the upper floor
 * A low wall runs between the two flights (the kit wall on their shared edge).
 */
import * as THREE from 'three';
import { stairCells, type Building, type Stair } from '../gen/types.ts';
import { WALL_THICKNESS } from '../gen/config.ts';
import { boxesToSurfaceGeometry, type AABB } from './boxMesh.ts';

/** Steps per flight. */
export const STEPS = 11;

export interface StairCollider {
  center: THREE.Vector3;
  rotation: { x: number; y: number; z: number; w: number };
  half: { x: number; y: number; z: number };
}

const UP = new THREE.Vector3(0, 1, 0);

/** A ramp box from bottom-edge centre `p0` to top-edge centre `p1`, `width` wide. */
function ramp(p0: THREE.Vector3, p1: THREE.Vector3, width: number): StairCollider {
  const d = p1.clone().sub(p0);
  const len = d.length();
  const z = d.normalize();
  const x = new THREE.Vector3().crossVectors(UP, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const center = p0.clone().add(p1).multiplyScalar(0.5).addScaledVector(y, -0.1);
  return { center, rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, half: { x: width / 2, y: 0.1, z: len / 2 } };
}

/** Collision for one staircase: ramp A, the landing block, ramp B. */
export function stairColliders(b: Building, s: Stair): StairCollider[] {
  const S = b.cellSize;
  const T = WALL_THICKNESS / 2;
  const y0 = s.lower * b.floorStep;
  const mid = y0 + b.floorStep / 2;
  const c = stairCells(s);
  const w = S - WALL_THICKNESS;
  const ax = (c.a.x + 0.5) * S;
  const bx = (c.b.x + 0.5) * S;
  const a = ramp(new THREE.Vector3(ax, y0, c.a.z * S), new THREE.Vector3(ax, mid, (c.a.z + 1) * S), w);
  const landing: StairCollider = {
    center: new THREE.Vector3((c.x0 + 1) * S, (y0 + mid) / 2, (c.mid.z + 0.5) * S - T / 2),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    half: { x: S - T, y: (mid - y0) / 2, z: (S - T) / 2 },
  };
  const bRamp = ramp(new THREE.Vector3(bx, mid, (c.b.z + 1) * S), new THREE.Vector3(bx, y0 + b.floorStep, c.b.z * S), w);
  return [a, landing, bRamp];
}

/** World-space step geometry for all staircases (with surface masks so they match the floors). */
export function buildStairsGeometry(b: Building): THREE.BufferGeometry | null {
  if (!b.stairs.length) return null;
  const S = b.cellSize;
  const T = WALL_THICKNESS / 2;
  const boxes: AABB[] = [];
  for (const s of b.stairs) {
    const c = stairCells(s);
    const y0 = s.lower * b.floorStep;
    const riser = b.floorStep / (2 * STEPS);
    const tread = S / STEPS;
    // Flight A: solid cast-concrete steps climbing +z.
    for (let i = 0; i < STEPS; i++) {
      const z0 = c.a.z * S + i * tread;
      boxes.push({ min: [c.a.x * S + T, y0, z0], max: [(c.a.x + 1) * S - T, y0 + riser * (i + 1), z0 + tread] });
    }
    // Mid landing across both columns, at half height.
    const mid = y0 + riser * STEPS;
    boxes.push({ min: [c.x0 * S + T, y0, c.mid.z * S], max: [(c.x0 + 2) * S - T, mid, (c.mid.z + 1) * S - T] });
    // Flight B: turns back and climbs −z to the upper floor.
    for (let i = 0; i < STEPS; i++) {
      const z1 = (c.b.z + 1) * S - i * tread;
      boxes.push({ min: [c.b.x * S + T, y0, z1 - tread], max: [(c.b.x + 1) * S - T, mid + riser * (i + 1), z1] });
    }
    // The slab edge around the stairwell: walls stop at the storey height but the next floor
    // starts a slab's thickness higher, which elsewhere the floor and ceiling slabs close. Around
    // the stairwell hole nothing did: a slit all round, looking straight outside. Close it.
    const yb = y0 + b.storeyHeight - 0.03;
    const yt = y0 + b.floorStep - 0.004;
    const xa = c.x0 * S;
    const xb = (c.x0 + 2) * S;
    const za = s.z * S;
    const zb = (s.z + 2) * S;
    boxes.push(
      { min: [xa - T, yb, za - T], max: [xb + T, yt, za + T] },
      { min: [xa - T, yb, zb - T], max: [xb + T, yt, zb + T] },
      { min: [xa - T, yb, za - T], max: [xa + T, yt, zb + T] },
      { min: [xb - T, yb, za - T], max: [xb + T, yt, zb + T] },
    );
  }
  // Concrete stairs: some wear at the edges, a bit damp, no puddles on steps.
  return boxesToSurfaceGeometry(boxes, (_x, _y, _z, _nx, ny) => [ny > 0.5 ? 0.35 : 0.25, 0.15, 0.3, 0], 2);
}
