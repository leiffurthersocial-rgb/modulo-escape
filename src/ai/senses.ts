/**
 * Senses for entities: line of sight through the physics world (walls block), and hearing via the
 * bus 'noise' events (footsteps etc.), kept for a few seconds so an AI can poll them.
 */
import * as THREE from 'three';
import { bus } from '../core/events.ts';
import { RAPIER, type PhysicsWorld } from '../physics/physicsWorld.ts';

export interface Noise {
  pos: THREE.Vector3;
  floor: number;
  radius: number;
  source: string;
  time: number;
}

export class Senses {
  readonly noises: Noise[] = [];
  private time = 0;
  private off: () => void;

  constructor(private physics: PhysicsWorld) {
    this.off = bus.on('noise', (n) => {
      this.noises.push({ pos: new THREE.Vector3(n.x, n.y, n.z), floor: n.floor, radius: n.radius, source: n.source, time: this.time });
      if (this.noises.length > 64) this.noises.shift();
    });
  }

  update(dt: number) {
    this.time += dt;
    while (this.noises.length && this.time - this.noises[0]!.time > 6) this.noises.shift();
  }

  /** Loudest recent noise audible from `at` (within its radius, same or adjacent floor). */
  hear(at: THREE.Vector3, floor: number, since = 2): Noise | null {
    let best: Noise | null = null;
    let bestScore = 0;
    for (const n of this.noises) {
      if (this.time - n.time > since || Math.abs(n.floor - floor) > 1) continue;
      const d = n.pos.distanceTo(at);
      const score = n.radius - d - Math.abs(n.floor - floor) * 4;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  /** True when no static geometry lies between the two points. */
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3, excludeCollider?: RAPIER.Collider): boolean {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-3) return true;
    dir.divideScalar(len);
    const ray = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    // Stop short of the target: the player's own capsule must not count as an obstacle.
    const reach = Math.max(0, len - 0.6);
    const hit = this.physics.world.castRay(ray, reach, true, undefined, undefined, excludeCollider);
    return !hit || hit.timeOfImpact >= reach - 0.01;
  }

  dispose() {
    this.off();
  }
}
