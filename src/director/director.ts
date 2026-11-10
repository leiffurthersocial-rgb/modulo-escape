/**
 * Ambience director (stub). Owns "mood over time": light flicker now; later the horror
 * layer plugs in here (light failures, sound cues, using spawn points and the nav graph).
 * It only reacts to bus events and drives registries; nothing calls into it directly.
 */
import type * as THREE from 'three';
import { bus } from '../core/events.ts';
import { streamRng, type Rng } from '../core/rng.ts';
import type { Building } from '../gen/types.ts';
import { LightRegistry } from './lights.ts';

export class AmbienceDirector {
  readonly lights: LightRegistry;
  /** Candidate spawn cells for future entities, with their floor. */
  readonly spawnPoints: { floor: number; x: number; z: number }[];
  /** Seeded so a seed's ambience is reproducible too. */
  private rng: Rng;
  private time = 0;
  private flickers = new Map<number, { until: number; phase: number }>();
  private offs: (() => void)[] = [];
  /** Global tension 0..1; the horror layer will raise it. Unused in Phase 1. */
  tension = 0;

  constructor(scene: THREE.Scene, b: Building, poolSize = 4) {
    this.lights = new LightRegistry(scene, b, poolSize);
    this.spawnPoints = b.floors.flatMap((f) => f.spawnPoints.map((p) => ({ floor: f.floor, ...p })));
    this.rng = streamRng(b.seed, 'director');
    this.offs.push(
      bus.on('player:enteredCell', (e) => {
        const S = b.cellSize;
        this.lights.assignNear((e.x + 0.5) * S, e.floor * b.floorStep, (e.z + 0.5) * S);
      }),
      bus.on('light:flicker', (e) => this.flickers.set(e.id, { until: this.time + e.ms / 1000, phase: this.rng.next() * 10 })),
    );
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    for (const [i, s] of this.lights.states.entries()) {
      if (s.dead) continue;
      const decay = s.slot.decay;
      let lv = 1;
      if (decay > 0.35) {
        // Failing tubes: buzzy dips, stutter bursts, and long drop-outs on the worst ones.
        const w = decay - 0.35;
        const buzz = Math.sin(t * 37 + i * 7.1) * Math.sin(t * 11.3 + i) * Math.sin(t * 2.7 + i * 3.3);
        if (buzz > 0.62 - w) lv = 0.15 + 0.2 * Math.abs(Math.sin(t * 90 + i));
        const burst = Math.sin(t * 0.7 + i * 1.9) > 0.93 - w * 0.3;
        if (burst) lv *= Math.sin(t * 55 + i) > 0 ? 1 : 0.05;
        if (decay > 0.68 && Math.sin(t * 0.23 + i * 5.1) > 0.75) lv = 0.02;
      }
      const f = this.flickers.get(i);
      if (f) {
        if (t > f.until) this.flickers.delete(i);
        else lv *= Math.sin((t + f.phase) * 60) > 0 ? 1 : 0.05;
      }
      s.level = lv;
    }
    // Occasional random flicker event (ambience now; the horror layer will drive these).
    if (this.rng.next() < dt * 0.08 && this.lights.states.length) {
      const id = Math.floor(this.rng.next() * this.lights.states.length);
      bus.emit('light:flicker', { id, intensity: 0, ms: 300 + this.rng.next() * 900 });
    }
    this.lights.apply();
  }

  dispose() {
    for (const off of this.offs) off();
  }
}
