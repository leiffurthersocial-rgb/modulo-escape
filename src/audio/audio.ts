/**
 * Audio manager (stub). Creates the WebAudio graph lazily on the first user gesture
 * (required on iOS), with buses for ambience / sfx / music / stingers. No sounds ship
 * in Phase 1; `audio:cue` events are accepted and ignored until assets exist.
 */
import { bus } from '../core/events.ts';
import { settings } from '../game/settings.ts';

export type AudioBus = 'ambience' | 'sfx' | 'music' | 'stingers';

export class AudioManager {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  readonly buses = new Map<AudioBus, GainNode>();
  private offs: (() => void)[] = [];

  constructor() {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.offs.push(
      bus.on('settings:changed', () => this.master && (this.master.gain.value = settings.masterVolume)),
      bus.on('game:paused', ({ paused }) => void (paused ? this.ctx?.suspend() : this.ctx?.resume())),
      bus.on('audio:cue', () => {
        /* Phase 2+: look up a buffer by name and play it positionally. */
      }),
    );
  }

  private ensure() {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.masterVolume;
    this.master.connect(this.ctx.destination);
    for (const b of ['ambience', 'sfx', 'music', 'stingers'] as AudioBus[]) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.buses.set(b, g);
    }
  }

  dispose() {
    for (const off of this.offs) off();
    void this.ctx?.close();
  }
}
