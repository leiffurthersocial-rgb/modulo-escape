/**
 * Audio manager. Creates the WebAudio graph lazily on the first user gesture (required on iOS),
 * with buses for ambience / sfx / music / stingers. Runs the procedural HVAC ambience while
 * playing and the jump-scare sting. `audio:cue` is the hook for future sampled sounds.
 */
import { bus } from '../core/events.ts';
import { settings } from '../game/settings.ts';
import { HvacAmbience, playSting } from './hvac.ts';
import { creatureBreath, creatureClicks, creatureScreech, creatureStep, setListener } from './creatureSounds.ts';

export type AudioBus = 'ambience' | 'sfx' | 'music' | 'stingers';

export class AudioManager {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  readonly buses = new Map<AudioBus, GainNode>();
  private offs: (() => void)[] = [];
  private hvac: HvacAmbience | null = null;
  private wantAmbience = false;

  constructor() {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
      if (this.wantAmbience) this.startAmbience();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.offs.push(
      bus.on('settings:changed', () => this.master && (this.master.gain.value = settings.masterVolume)),
      bus.on('game:paused', ({ paused }) => {
        if (paused) void this.ctx?.suspend();
        else {
          void this.ctx?.resume();
          this.startAmbience();
        }
      }),
      bus.on('scare:start', () => this.sting()),
      bus.on('monster:step', (e) => this.atMonster(e, (ctx, out, o) => creatureStep(ctx, out, o, e.loud))),
      bus.on('monster:vocal', (e) =>
        this.atMonster(e, (ctx, out, o) =>
          e.kind === 'breath' ? creatureBreath(ctx, out, o) : e.kind === 'click' ? creatureClicks(ctx, out, o) : creatureScreech(ctx, out, { ...o, gain: o.gain * 1.4 }),
        ),
      ),
      bus.on('level:won', () => this.fadeAmbience(4)),
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

  /** Start the HVAC drone (idempotent). Waits for the first gesture if audio is still locked. */
  startAmbience() {
    this.wantAmbience = true;
    this.ensure();
    if (!this.ctx || this.hvac) return;
    this.hvac = new HvacAmbience(this.ctx, this.buses.get('ambience')!);
  }

  private listenerFloor = 0;

  /** Call every frame with the camera so positional sounds come from the right place. */
  updateListener(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }, floor: number) {
    this.listenerFloor = floor;
    if (this.ctx && this.ctx.state === 'running') setListener(this.ctx, pos, fwd);
  }

  private atMonster(
    e: { x: number; y: number; z: number; floor: number },
    play: (ctx: AudioContext, out: AudioNode, o: { x: number; y: number; z: number; floorsApart: number; gain: number }) => void,
  ) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const apart = Math.abs(e.floor - this.listenerFloor);
    if (apart > 1) return;
    play(this.ctx, this.buses.get('sfx')!, { x: e.x, y: e.y, z: e.z, floorsApart: apart, gain: 1 });
  }

  setTension(v: number) {
    this.hvac?.setTension(v);
  }

  sting() {
    this.ensure();
    if (!this.ctx) return;
    void this.ctx.resume();
    playSting(this.ctx, this.buses.get('stingers')!);
    // The building goes quiet after the scare.
    this.fadeAmbience(1.5);
  }

  private fadeAmbience(seconds: number) {
    const g = this.buses.get('ambience');
    if (!g || !this.ctx) return;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, seconds / 3);
  }

  dispose() {
    this.hvac?.stop();
    for (const off of this.offs) off();
    void this.ctx?.close();
  }
}
