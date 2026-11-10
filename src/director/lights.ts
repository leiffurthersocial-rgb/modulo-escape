/**
 * Light registry: every generated light slot gets an id, a fixture mesh (instanced) and,
 * when near the player, one of a small pool of real PointLights. The director drives
 * intensity per slot (flicker, failure). Pool size comes from the quality preset.
 */
import * as THREE from 'three';
import type { LevelData, LightSlot } from '../gen/types.ts';
import { cellCenter } from '../gen/grid.ts';

export interface LightState {
  slot: LightSlot;
  /** 0..1 multiplier the director animates (1 = nominal). */
  level: number;
  /** Fixture is dead (never lights). */
  dead: boolean;
}

const BASE_INTENSITY = 6;

export class LightRegistry {
  readonly states: LightState[];
  readonly fixtures: THREE.InstancedMesh;
  private pool: THREE.PointLight[] = [];
  private assigned: number[] = [];
  private fixtureMat: THREE.MeshStandardMaterial;
  private color = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private level: LevelData,
    poolSize = 4,
  ) {
    this.states = level.lights
      .filter((l) => l.kind === 'ceiling')
      .map((slot) => ({ slot, level: 1, dead: slot.decay > 0.72 }));
    const geo = new THREE.BoxGeometry(1.2, 0.08, 0.25);
    this.fixtureMat = new THREE.MeshStandardMaterial({ color: 0x777770, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.6 });
    this.fixtures = new THREE.InstancedMesh(geo, this.fixtureMat, Math.max(1, this.states.length));
    const m = new THREE.Matrix4();
    this.states.forEach((s, i) => {
      const c = cellCenter(level, s.slot.cx, s.slot.cz);
      m.makeTranslation(c.x, level.storeyHeight - 0.05, c.z);
      this.fixtures.setMatrixAt(i, m);
      this.fixtures.setColorAt(i, this.color.setScalar(s.dead ? 0 : 0.9));
    });
    this.fixtures.count = this.states.length;
    this.fixtures.instanceColor!.needsUpdate = true;
    this.fixtures.computeBoundingSphere();
    scene.add(this.fixtures);
    this.setPoolSize(scene, poolSize);
  }

  setPoolSize(scene: THREE.Scene, n: number) {
    for (const l of this.pool) scene.remove(l);
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xe8f0ff, 0, 11, 1.8);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
    this.assigned = new Array<number>(n).fill(-1);
  }

  /** Reassign pool lights to the nearest working fixtures. */
  assignNear(px: number, pz: number) {
    const S = this.level.cellSize;
    const ranked = this.states
      .map((s, i) => ({ i, d: Math.hypot((s.slot.cx + 0.5) * S - px, (s.slot.cz + 0.5) * S - pz), dead: s.dead }))
      .filter((r) => !r.dead && r.d < 26)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.pool.length);
    this.pool.forEach((light, k) => {
      const r = ranked[k];
      this.assigned[k] = r ? r.i : -1;
      if (r) {
        const s = this.states[r.i]!;
        light.position.set((s.slot.cx + 0.5) * S, this.level.storeyHeight - 0.35, (s.slot.cz + 0.5) * S);
      } else light.intensity = 0;
    });
  }

  /** Push per-slot levels into pool lights and fixture emissive colours. */
  apply() {
    this.pool.forEach((light, k) => {
      const i = this.assigned[k]!;
      light.intensity = i >= 0 ? BASE_INTENSITY * this.states[i]!.level : 0;
    });
    let dirty = false;
    this.states.forEach((s, i) => {
      if (s.dead) return;
      this.fixtures.setColorAt(i, this.color.setScalar(0.15 + 0.85 * s.level));
      dirty = true;
    });
    if (dirty) this.fixtures.instanceColor!.needsUpdate = true;
  }
}
