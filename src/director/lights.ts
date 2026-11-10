/**
 * Light registry: every generated light slot on every floor gets an id, a fixture (instanced) and,
 * when near the player, one of a small pool of real PointLights. The director drives intensity per
 * slot (flicker, failure). Pool size comes from the quality preset.
 */
import * as THREE from 'three';
import type { Building, LightSlot } from '../gen/types.ts';

export interface LightState {
  slot: LightSlot;
  floor: number;
  /** World position of the tube. */
  pos: THREE.Vector3;
  /** 0..1 multiplier the director animates (1 = nominal). */
  level: number;
  /** Fixture is dead (never lights). */
  dead: boolean;
}

const BASE_INTENSITY = 7.5;
const COLOR = 0xe4ecff;

export class LightRegistry {
  readonly states: LightState[] = [];
  readonly fixtures: THREE.InstancedMesh;
  private pool: THREE.PointLight[] = [];
  private assigned: number[] = [];
  private fixtureMat: THREE.MeshStandardMaterial;
  private color = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private b: Building,
    poolSize = 4,
  ) {
    const S = b.cellSize;
    for (const level of b.floors) {
      for (const slot of level.lights) {
        if (slot.kind !== 'ceiling') continue;
        this.states.push({
          slot,
          floor: level.floor,
          pos: new THREE.Vector3((slot.cx + 0.5) * S, level.elevation + b.storeyHeight - 0.05, (slot.cz + 0.5) * S),
          level: 1,
          dead: slot.decay > 0.9,
        });
      }
    }
    const geo = new THREE.BoxGeometry(1.3, 0.07, 0.22);
    this.fixtureMat = new THREE.MeshStandardMaterial({ color: 0x6c6c66, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.6 });
    this.fixtures = new THREE.InstancedMesh(geo, this.fixtureMat, Math.max(1, this.states.length));
    const m = new THREE.Matrix4();
    this.states.forEach((s, i) => {
      m.makeTranslation(s.pos.x, s.pos.y, s.pos.z);
      this.fixtures.setMatrixAt(i, m);
      this.fixtures.setColorAt(i, this.color.setScalar(s.dead ? 0 : 0.9));
    });
    this.fixtures.count = this.states.length;
    if (this.fixtures.instanceColor) this.fixtures.instanceColor.needsUpdate = true;
    this.fixtures.computeBoundingSphere();
    scene.add(this.fixtures);
    this.setPoolSize(scene, poolSize);
  }

  setPoolSize(scene: THREE.Scene, n: number) {
    for (const l of this.pool) scene.remove(l);
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(COLOR, 0, 12, 1.7);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
    this.assigned = new Array<number>(n).fill(-1);
  }

  /** Reassign pool lights to the nearest working fixtures on the player's floor (± stairwells). */
  assignNear(x: number, y: number, z: number) {
    const ranked = this.states
      .map((s, i) => ({ i, d: Math.hypot(s.pos.x - x, (s.pos.y - y - 1.6) * 2.5, s.pos.z - z), dead: s.dead }))
      .filter((r) => !r.dead && r.d < 26)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.pool.length);
    this.pool.forEach((light, k) => {
      const r = ranked[k];
      this.assigned[k] = r ? r.i : -1;
      if (r) light.position.copy(this.states[r.i]!.pos).y -= 0.3;
      else light.intensity = 0;
    });
  }

  /** Push per-slot levels into pool lights and fixture emissive colours. */
  apply() {
    this.pool.forEach((light, k) => {
      const i = this.assigned[k]!;
      light.intensity = i >= 0 ? BASE_INTENSITY * this.states[i]!.level : 0;
    });
    this.states.forEach((s, i) => {
      if (!s.dead) this.fixtures.setColorAt(i, this.color.setScalar(0.08 + 0.92 * s.level));
    });
    if (this.fixtures.instanceColor) this.fixtures.instanceColor.needsUpdate = true;
  }
}
