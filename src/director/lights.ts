/**
 * Light registry: every generated light slot on every floor gets an id, a fixture (instanced) and,
 * when near the player, one of a small pool of real PointLights. The director drives intensity per
 * slot (flicker, failure). Pool size comes from the quality preset.
 *
 * Pool lights have no shadows, so a light only goes to tubes you can actually reach on foot
 * within a few cells (same floor through doors and openings, or up/down the stairwell): a tube
 * behind a wall or on another floor would otherwise shine through it. Lights fade in and out
 * when the pool is reassigned instead of popping.
 */
import * as THREE from 'three';
import type { Building, LightSlot } from '../gen/types.ts';

export interface LightState {
  slot: LightSlot;
  floor: number;
  /** Nav node the tube hangs over (stairwell tubes: the mid landing on the floor below). */
  node: number;
  /** World position of the tube. */
  pos: THREE.Vector3;
  /** 0..1 multiplier the director animates (1 = nominal). */
  level: number;
  /** Fixture is dead (never lights). */
  dead: boolean;
  /** 0..1: glowing red (a monster is close). */
  red: number;
}

const BASE_INTENSITY = 6.2;
/** How far (in walkable cells) a tube can be from you and still get a real light. */
const REACH = 5;
const COLOR = 0xe4ecff;
const RED = new THREE.Color(0xff1a0a);

export class LightRegistry {
  readonly states: LightState[] = [];
  readonly fixtures: THREE.InstancedMesh;
  private pool: THREE.PointLight[] = [];
  private assigned: number[] = [];
  /** Per pool light: 0..1 fade (ramps up after a reassignment). */
  private fade: number[] = [];
  private byNode = new Map<number, number[]>();
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
        const N = b.width * b.height;
        const cell = slot.cz * b.width + slot.cx;
        const shaft = level.cells[cell]?.kind === 'shaft';
        this.states.push({
          slot,
          floor: level.floor,
          node: (shaft ? level.floor - 1 : level.floor) * N + cell,
          pos: new THREE.Vector3((slot.cx + 0.5) * S, level.elevation + b.storeyHeight - 0.05, (slot.cz + 0.5) * S),
          level: 1,
          dead: slot.decay > 0.9,
          red: 0,
        });
      }
    }
    this.states.forEach((st, i) => {
      const list = this.byNode.get(st.node) ?? [];
      list.push(i);
      this.byNode.set(st.node, list);
    });
    const geo = new THREE.BoxGeometry(1.3, 0.07, 0.22);
    // Dark housing (its own light right under it would otherwise blow it out to white), the glow
    // carries the colour.
    this.fixtureMat = new THREE.MeshStandardMaterial({ color: 0x141414, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.6 });
    // The glow follows the per-tube colour too (dimming, flicker, red), not just the diffuse.
    this.fixtureMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n totalEmissiveRadiance *= vColor.rgb;\n#endif',
      );
    };
    this.fixtureMat.customProgramCacheKey = () => 'tube-glow-2';
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
      const l = new THREE.PointLight(COLOR, 0, 10, 1.7);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
    this.assigned = new Array<number>(n).fill(-1);
    this.fade = new Array<number>(n).fill(0);
  }

  /**
   * Reassign pool lights to the working tubes nearest by walking distance from `node` (your cell),
   * then by straight-line distance. Lights that keep their tube keep their slot (no flicker).
   */
  assignNear(node: number, x: number, y: number, z: number) {
    const adj = this.b.nav.adj;
    // High on a staircase you count as the upper floor, but the stair cell belongs to the one below.
    const N = this.b.width * this.b.height;
    if (node >= N && !(adj[node]?.length ?? 0)) node -= N;
    const depth = new Map<number, number>();
    if (node >= 0) {
      depth.set(node, 0);
      const q = [node];
      for (let h = 0; h < q.length; h++) {
        const c = q[h]!;
        const d = depth.get(c)!;
        if (d >= REACH) continue;
        for (const n of adj[c] ?? []) {
          if (depth.has(n)) continue;
          depth.set(n, d + 1);
          q.push(n);
        }
      }
    }
    const ranked: { i: number; d: number; e: number }[] = [];
    for (const [n, d] of depth) {
      for (const i of this.byNode.get(n) ?? []) {
        const s = this.states[i]!;
        if (s.dead) continue;
        ranked.push({ i, d, e: Math.hypot(s.pos.x - x, s.pos.y - y, s.pos.z - z) });
      }
    }
    ranked.sort((a, b) => a.d - b.d || a.e - b.e);
    const want = new Set(ranked.slice(0, this.pool.length).map((r) => r.i));
    // Keep lights that already sit on a wanted tube; give the freed ones to the rest.
    const free: number[] = [];
    this.pool.forEach((_, k) => {
      const cur = this.assigned[k]!;
      if (cur >= 0 && want.has(cur)) want.delete(cur);
      else free.push(k);
    });
    const rest = [...want];
    for (const k of free) {
      const i = rest.shift();
      this.assigned[k] = i ?? -1;
      this.fade[k] = 0;
      if (i !== undefined) this.pool[k]!.position.copy(this.states[i]!.pos).y -= 0.3;
    }
  }

  /** Push per-slot levels into pool lights and fixture emissive colours. */
  apply(dt = 1 / 60) {
    this.pool.forEach((light, k) => {
      const i = this.assigned[k]!;
      this.fade[k] = Math.min(1, this.fade[k]! + dt * 3.5);
      const s = i >= 0 ? this.states[i]! : null;
      light.intensity = s ? BASE_INTENSITY * s.level * this.fade[k]! : 0;
      light.color.setHex(COLOR);
      if (s && s.red > 0) light.color.lerp(RED, s.red);
    });
    this.states.forEach((s, i) => {
      if (s.dead) return;
      const v = 0.08 + 0.92 * s.level;
      // Red: a deep red, dimmer than white (bright red tone-maps back to white).
      this.fixtures.setColorAt(i, this.color.setRGB(v * (1 - 0.5 * s.red), v * (1 - 0.98 * s.red), v * (1 - 0.98 * s.red)));
    });
    if (this.fixtures.instanceColor) this.fixtures.instanceColor.needsUpdate = true;
  }
}
