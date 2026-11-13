/**
 * Audio manager. Creates the WebAudio graph lazily on the first user gesture (required on iOS),
 * with buses for ambience / sfx / music / stingers and a concrete-hall reverb on sfx. Recorded CC0
 * effects (footsteps, impacts, metal, creaks — src/audio/samples.ts) where they fit; procedural
 * HVAC drone, monster voice and the jump-scare scream.
 */
import { bus } from '../core/events.ts';
import { settings } from '../game/settings.ts';
import { HvacAmbience } from './hvac.ts';
import { ceilingScrape, creatureGiggle, gunshot, wallKnocks, creatureBreath, creatureClicks, creatureGrowl, creatureRoar, creatureScream, creatureScreech, creatureStep, earBreath, heartbeat, playerStep, screamSting, setListener, shriekSting, sink, wallThud } from './creatureSounds.ts';
import { createReverb, SampleBank } from './samples.ts';

export type AudioBus = 'ambience' | 'sfx' | 'music' | 'stingers';

export class AudioManager {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  readonly buses = new Map<AudioBus, GainNode>();
  private offs: (() => void)[] = [];
  private hvac: HvacAmbience | null = null;
  private wantAmbience = false;
  samples: SampleBank | null = null;

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
      bus.on('scare:start', (e) => this.sting(e.hitAt, e.darkAt, e.booAt)),
      // Your own footsteps (the same events the monster listens to): crouch soft, sprint loud.
      bus.on('noise', (n) => {
        if (n.source !== 'player' || !this.ctx || this.ctx.state !== 'running') return;
        this.stepSide = -this.stepSide;
        const strength = n.radius >= 15 ? 1 : n.radius >= 4 ? 0.45 : 0.08;
        if (this.samples?.ready) this.sampledStep(strength);
        else playerStep(this.ctx, this.buses.get('sfx')!, strength, this.stepSide);
        // Very rarely, a step answers yours from behind, a beat too late.
        if (strength > 0.2 && strength < 1 && this.samples?.ready && this.ctx.currentTime > this.nextEcho) {
          this.nextEcho = this.ctx.currentTime + 90 + Math.random() * 90;
          const L = this.listener;
          const d = sink(this.ctx, this.buses.get('sfx')!, { x: L.x - L.fx * 5, y: L.y - 1.4, z: L.z - L.fz * 5, floorsApart: 0, gain: 0.9 });
          this.samples.play('step_concrete', d, { gain: 0.6, rate: 0.88, at: this.ctx.currentTime + 0.38 });
        }
      }),
      // Your pistol.
      bus.on('gun:fired', () => {
        if (!this.ctx || this.ctx.state !== 'running') return;
        gunshot(this.ctx, this.buses.get('sfx')!);
        this.silence(0.5, 1.5);
      }),
      bus.on('gun:pickup', () => this.samples?.ready && this.samples.play('latch', this.buses.get('sfx')!, { gain: 0.6, rate: 1.7 })),
      bus.on('monster:step', (e) =>
        this.atMonster(e, 1, (ctx, out, o) => {
          const sm = this.samples;
          if (!sm?.ready) return creatureStep(ctx, out, o, e.loud);
          // Heavy bare foot: a slowed fleshy slap on concrete, plus the low body thump (Leo: a
          // much heavier, deeper stomp; Jovan: barely a whisper).
          const d = sink(ctx, out, o);
          const heavy = e.loud > 1.3;
          sm.play('flesh_heavy', d, { gain: Math.min(1.6, 0.9 * e.loud), rate: heavy ? 0.45 : 0.7 });
          sm.play(heavy ? 'punch_heavy' : 'step_concrete', d, { gain: Math.min(1.4, 0.7 * e.loud), rate: heavy ? 0.4 : 0.62, at: ctx.currentTime + 0.012 });
          creatureStep(ctx, out, { ...o, gain: o.gain * 0.45 }, e.loud);
        }),
      ),
      bus.on('audio:cue', (c) => (c.name === 'silence' ? this.silence() : this.cue(c.name))),
      bus.on('monster:vocal', (e) =>
        this.atMonster(e, e.kind === 'giggle' ? 2 : 1, (ctx, out, o) =>
          e.kind === 'breath'
            ? creatureBreath(ctx, out, o)
            : e.kind === 'click'
              ? creatureClicks(ctx, out, o)
              : e.kind === 'scream'
                ? creatureScream(ctx, out, { ...o, gain: o.gain * 1.6 })
                : e.kind === 'roar'
                  ? creatureRoar(ctx, out, o)
                  : e.kind === 'growl'
                    ? creatureGrowl(ctx, out, o)
                    : e.kind === 'scrape'
                      ? ceilingScrape(ctx, out, o)
                      : e.kind === 'thud'
                        ? wallThud(ctx, out, o)
                        : e.kind === 'giggle'
                          ? creatureGiggle(ctx, out, o)
                          : e.kind === 'knock'
                            ? wallKnocks(ctx, out, o)
                        : creatureScreech(ctx, out, { ...o, gain: o.gain * 1.4 }),
        ),
      ),
      bus.on('level:won', () => this.fadeAmbience(4)),
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
    // Concrete-hall reverb: footsteps and the monster ring down the corridors.
    const verb = createReverb(this.ctx);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.32;
    verb.connect(wet).connect(this.master);
    const send = (b: AudioBus, v: number) => {
      const g = this.ctx!.createGain();
      g.gain.value = v;
      this.buses.get(b)!.connect(g).connect(verb);
    };
    send('sfx', 0.6);
    send('ambience', 0.25);
    send('stingers', 0.35);
    this.samples = new SampleBank(this.ctx);
    void this.samples.load();
  }

  /** Start the HVAC drone (idempotent). Waits for the first gesture if audio is still locked. */
  startAmbience() {
    this.wantAmbience = true;
    this.ensure();
    if (!this.ctx || this.hvac) return;
    this.hvac = new HvacAmbience(this.ctx, this.buses.get('ambience')!, this.samples);
  }

  private listenerFloor = 0;
  private listener = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
  private nextEcho = 60;
  private stepSide = 1;

  /** Call every frame with the camera so positional sounds come from the right place. */
  updateListener(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }, floor: number) {
    this.listenerFloor = floor;
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    this.listener = { x: pos.x, y: pos.y, z: pos.z, fx: fwd.x / fl, fz: fwd.z / fl };
    if (this.ctx && this.ctx.state === 'running') setListener(this.ctx, pos, fwd);
  }

  private atMonster(
    e: { x: number; y: number; z: number; floor: number },
    maxApart: number,
    play: (ctx: AudioContext, out: AudioNode, o: { x: number; y: number; z: number; floorsApart: number; gain: number }) => void,
  ) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const apart = Math.abs(e.floor - this.listenerFloor);
    if (apart > maxApart) return;
    play(this.ctx, this.buses.get('sfx')!, { x: e.x, y: e.y, z: e.z, floorsApart: apart, gain: 1 });
  }

  setTension(v: number) {
    this.hvac?.setTension(v);
  }

  /** The scare: the building's hum cuts to silence, then the scream lands `hitAt` s later. */
  sting(hitAt = 0, darkAt = 0, booAt = 0) {
    this.ensure();
    if (!this.ctx) return;
    void this.ctx.resume();
    this.fadeAmbience(hitAt > 0 ? 0.12 : 1.5);
    const now = this.ctx.currentTime;
    const at = now + hitAt;
    const out = this.buses.get('stingers')!;
    // Wind-up: your heartbeat racing; in the dark, his breath at your ear; the last shriek.
    if (hitAt > 0.5) heartbeat(this.ctx, out, now + 0.1, now + (darkAt || hitAt) - 0.05);
    if (darkAt > 0) earBreath(this.ctx, out, now + darkAt + 0.03, hitAt - darkAt - 0.05);
    if (booAt > 0) {
      shriekSting(this.ctx, out, now + booAt);
      this.samples?.play('punch_heavy', out, { gain: 1, rate: 0.6, at: now + booAt });
    }
    screamSting(this.ctx, out, at);
    // The body hits you: a deep, slowed punch + flesh impact under the scream.
    if (this.samples?.ready) {
      this.samples.play('punch_heavy', out, { gain: 1.1, rate: 0.55, at });
      this.samples.play('flesh_heavy', out, { gain: 0.9, rate: 0.5, at: at + 0.02 });
    }
  }

  /** Your footstep: a real concrete step, quiet and slow when crouching (with cloth), hard when sprinting. */
  private sampledStep(strength: number) {
    const sm = this.samples!;
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.stepSide * 0.12;
    pan.connect(this.buses.get('sfx')!);
    sm.play('step_concrete', pan, { gain: 0.25 + strength * 0.75, rate: 0.92 + strength * 0.14, lowpass: strength < 0.2 ? 2200 : undefined });
    if (strength < 0.2 && Math.random() < 0.5) sm.play('cloth', pan, { gain: 0.18, rate: 1.1 });
  }

  /** Named one-shots (bus 'audio:cue'). */
  private cue(name: string) {
    const sm = this.samples;
    if (!this.ctx || !sm?.ready) return;
    const out = this.buses.get('sfx')!;
    if (name === 'gate') {
      // The heavy exit gate: latch, then a long low creak as it swings.
      sm.play('latch', out, { gain: 0.8, rate: 0.7 });
      sm.play('creak', out, { gain: 0.9, rate: 0.42, at: this.ctx.currentTime + 0.25 });
      sm.play('door_open', out, { gain: 0.6, rate: 0.55, at: this.ctx.currentTime + 0.2 });
    } else if (name === 'silence') this.silence();
    else if (name === 'barrel') sm.play('plate_heavy', out, { gain: 0.5, rate: 0.7 });
  }

  /** The ambience drops out (the building holds its breath), then creeps back. */
  silence(hold = 1.8, back = 2.5) {
    const g = this.buses.get('ambience');
    if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.25);
    g.gain.setValueAtTime(0.03, t + hold);
    g.gain.linearRampToValueAtTime(1, t + hold + back);
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
