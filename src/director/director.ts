/**
 * Ambience director (stub). Owns "mood over time": light flicker now; later the horror
 * layer plugs in here (light failures, sound cues, using spawn points and the nav graph).
 * It only reacts to bus events and drives registries; nothing calls into it directly.
 */
import type * as THREE from 'three';
import { bus } from '../core/events.ts';
import { streamRng, type Rng } from '../core/rng.ts';
import type { LevelData } from '../gen/types.ts';
import { LightRegistry } from './lights.ts';

export class AmbienceDirector {
  readonly lights: LightRegistry;
  /** Candidate spawn cells for future entities. */
  readonly spawnPoints: LevelData['spawnPoints'];
  /** Seeded so a seed's ambience is reproducible too. */
  private rng: Rng;
  private time = 0;
  private flickers = new Map<number, { until: number; phase: number }>();
  private offs: (() => void)[] = [];
  /** Global tension 0..1; the horror layer will raise it. Unused in Phase 1. */
  tension = 0;

  constructor(scene: THREE.Scene, level: LevelData, poolSize = 4) {
    this.lights = new LightRegistry(scene, level, poolSize);
    this.spawnPoints = level.spawnPoints;
    this.rng = streamRng(level.seed, 'director');
    this.offs.push(
      bus.on('player:enteredCell', (e) => {
        const S = level.cellSize;
        this.lights.assignNear((e.x + 0.5) * S, (e.z + 0.5) * S);
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
      // Worn tubes buzz and dip; the more decayed, the worse.
      let lv = 1;
      if (decay > 0.45) {
        const n = Math.sin(t * 31 + i * 7.1) * Math.sin(t * 7.3 + i) * Math.sin(t * 2.1 + i * 3);
        if (n > 0.55 - (decay - 0.45)) lv = 0.08;
      }
      const f = this.flickers.get(i);
      if (f) {
        if (t > f.until) this.flickers.delete(i);
        else lv *= Math.sin((t + f.phase) * 60) > 0 ? 1 : 0.05;
      }
      s.level = lv;
    }
    // Occasional random flicker event (cheap ambience, also exercises the hook).
    if (this.rng.next() < dt * 0.05 && this.lights.states.length) {
      const id = Math.floor(this.rng.next() * this.lights.states.length);
      bus.emit('light:flicker', { id, intensity: 0, ms: 300 + this.rng.next() * 900 });
    }
    this.lights.apply();
  }

  dispose() {
    for (const off of this.offs) off();
  }
}
