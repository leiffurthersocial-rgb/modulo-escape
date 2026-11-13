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
  /** Nearest monster to you on your floor (set by the game each frame); Infinity = none. */
  threat = { dist: Infinity, x: 0, z: 0, floor: 0 };
  private reds = new Map<number, number>();
  /** Your position (for the red flicker). */
  readonly playerPos = { x: 0, z: 0 };

  constructor(scene: THREE.Scene, b: Building, poolSize = 4) {
    this.lights = new LightRegistry(scene, b, poolSize);
    this.spawnPoints = b.floors.flatMap((f) => f.spawnPoints.map((p) => ({ floor: f.floor, ...p })));
    this.rng = streamRng(b.seed, 'director');
    this.offs.push(
      bus.on('player:enteredCell', (e) => {
        const S = b.cellSize;
        this.lights.assignNear(e.floor * b.width * b.height + e.z * b.width + e.x, (e.x + 0.5) * S, e.floor * b.floorStep + 1.6, (e.z + 0.5) * S);
      }),
      bus.on('light:flicker', (e) => this.flickers.set(e.id, { until: this.time + e.ms / 1000, phase: this.rng.next() * 10 })),
      // Leo's floor slam: every light around him stutters (some go out for a moment).
      bus.on('monster:pound', (e) => {
        this.lights.states.forEach((s, i) => {
          if (s.dead || s.floor !== e.floor || Math.hypot(s.pos.x - e.x, s.pos.z - e.z) > 14) return;
          this.flickers.set(i, { until: this.time + 0.4 + this.rng.next() * 1.2, phase: this.rng.next() * 10 });
        });
      }),
      // Lights stutter around Jovan.
      bus.on('monster:presence', (e) => {
        if (e.species !== 'jovan') return;
        this.lights.states.forEach((s, i) => {
          if (s.dead || Math.abs(s.pos.x - e.x) > 8 || Math.abs(s.pos.z - e.z) > 8 || Math.abs(s.floor - e.floor) > 0) return;
          if (this.rng.next() < 0.35) this.flickers.set(i, { until: this.time + 0.2 + this.rng.next() * 0.5, phase: this.rng.next() * 10 });
        });
      }),
    );
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    for (const [i, s] of this.lights.states.entries()) {
      if (s.dead) continue;
      const decay = s.slot.decay;
      let lv = 1;
      if (decay > 0.75) {
        // Failing tubes: now and then a short buzz dip or a stutter burst; the worst ones drop out.
        const w = (decay - 0.75) / 0.15; // 0..1
        const buzz = Math.sin(t * 37 + i * 7.1) * Math.sin(t * 11.3 + i) * Math.sin(t * 1.3 + i * 3.3);
        if (buzz > 0.9 - w * 0.12) lv = 0.2 + 0.2 * Math.abs(Math.sin(t * 90 + i));
        const burst = Math.sin(t * 0.37 + i * 1.9) > 0.985 - w * 0.01;
        if (burst) lv *= Math.sin(t * 55 + i) > 0 ? 1 : 0.05;
        if (w > 0.7 && Math.sin(t * 0.11 + i * 5.1) > 0.93) lv = 0.03;
      }
      const red = this.reds.get(i);
      if (red !== undefined) {
        if (t > red) {
          this.reds.delete(i);
          s.red = 0;
        } else {
          // A red stutter: the tube buzzes red and blinks.
          s.red = 1;
          lv *= Math.sin(t * 47 + i) > -0.3 ? 0.85 : 0.1;
        }
      }
      const f = this.flickers.get(i);
      if (f) {
        if (t > f.until) this.flickers.delete(i);
        else lv *= Math.sin((t + f.phase) * 60) > 0 ? 1 : 0.05;
      }
      s.level = lv;
    }
    // A monster near (within ~14 m): now and then a light close to you flickers red.
    const th = this.threat;
    // Now and then a false alarm: a tube near you goes red with nothing there (~every 2–3 min).
    const falseAlarm = th.dist > 14 && this.rng.next() < dt / 150;
    if (falseAlarm) {
      for (const [i, s] of this.lights.states.entries()) {
        if (s.dead || s.floor !== th.floor || Math.hypot(s.pos.x - this.playerPos.x, s.pos.z - this.playerPos.z) > 9) continue;
        this.reds.set(i, t + 0.6 + this.rng.next() * 0.9);
        break;
      }
    }
    if (th.dist < 14 && this.rng.next() < dt * 0.9 * (1 - th.dist / 14)) {
      let best = -1;
      let bd = Infinity;
      for (const [i, s] of this.lights.states.entries()) {
        if (s.dead || s.floor !== th.floor || this.reds.has(i)) continue;
        // Between you and it, roughly: near either.
        const d = Math.min(Math.hypot(s.pos.x - th.x, s.pos.z - th.z), Math.hypot(s.pos.x - this.playerPos.x, s.pos.z - this.playerPos.z)) + this.rng.next() * 3;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0 && bd < 9) this.reds.set(best, t + 0.5 + this.rng.next() * 1.3);
    }
    // Occasional random flicker event (ambience now; the horror layer will drive these).
    if (this.rng.next() < dt * 0.015 && this.lights.states.length) {
      const id = Math.floor(this.rng.next() * this.lights.states.length);
      bus.emit('light:flicker', { id, intensity: 0, ms: 300 + this.rng.next() * 900 });
    }
    this.lights.apply(dt);
  }

  dispose() {
    for (const off of this.offs) off();
  }
}
