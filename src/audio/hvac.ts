/**
 * Procedural ambience: an air-conditioning plant that never switches off, only slightly wrong.
 * Everything is synthesised (no downloads):
 *  - air:     looping brown noise through a slowly breathing low-pass (duct rush)
 *  - hum:     50 Hz mains hum + harmonics, one detuned a little so it beats
 *  - rattle:  faint band-passed noise flutter, like a loose vent grille
 *  - dread:   low detuned saws (minor-second beating) under a low-pass; swells with tension
 *  - events:  every 10–35 s a knock in the ducts, a tick, or a distant metal groan, panned
 * `setTension(0..1)` is driven by the game (monster near / chasing).
 */
export class HvacAmbience {
  private nodes: AudioNode[] = [];
  private dreadGain: GainNode;
  private humGain: GainNode;
  private airFilter: BiquadFilterNode;
  private eventTimer = 0;
  private stopped = false;
  private tension = 0;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {
    const t = ctx.currentTime;
    const noise = brownNoiseBuffer(ctx, 6);

    // Air: brown noise → low-pass breathing between ~280 and ~520 Hz.
    const air = ctx.createBufferSource();
    air.buffer = noise;
    air.loop = true;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = 'lowpass';
    this.airFilter.frequency.value = 400;
    this.airFilter.Q.value = 0.6;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.55;
    const breath = lfo(ctx, 0.045, 120);
    breath.out.connect(this.airFilter.frequency);
    air.connect(this.airFilter).connect(airGain).connect(out);
    air.start(t);

    // Hum: 50 Hz + 100 Hz + slightly sharp 150 Hz (slow beating against the 3rd harmonic).
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.05;
    for (const [f, type, g] of [
      [50, 'sine', 1],
      [100, 'triangle', 0.35],
      [150.7, 'sine', 0.18],
      [49.6, 'sine', 0.5],
    ] as [number, OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.humGain);
      o.start(t);
      this.nodes.push(o);
    }
    this.humGain.connect(out);

    // Rattle: band-passed noise, amplitude fluttering slowly and irregularly.
    const rattleSrc = ctx.createBufferSource();
    rattleSrc.buffer = noise;
    rattleSrc.loop = true;
    rattleSrc.playbackRate.value = 1.7;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 9;
    const rattleGain = ctx.createGain();
    rattleGain.gain.value = 0.012;
    const flutter = lfo(ctx, 0.13, 0.01);
    flutter.out.connect(rattleGain.gain);
    rattleSrc.connect(bp).connect(rattleGain).connect(out);
    rattleSrc.start(t);

    // Dread: two low detuned saws (≈ minor second) under a low-pass; almost inaudible at rest.
    const dreadLp = ctx.createBiquadFilter();
    dreadLp.type = 'lowpass';
    dreadLp.frequency.value = 180;
    this.dreadGain = ctx.createGain();
    this.dreadGain.gain.value = 0.012;
    for (const f of [41.2, 43.65, 82.4 * 1.003]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(dreadLp);
      o.start(t);
      this.nodes.push(o);
    }
    dreadLp.connect(this.dreadGain).connect(out);

    this.nodes.push(air, rattleSrc, breath.osc, flutter.osc);
    this.scheduleEvent();
  }

  /** 0 = calm, 1 = being chased. Smoothly raises the dread drone and opens the air filter. */
  setTension(v: number) {
    const t = Math.max(0, Math.min(1, v));
    if (Math.abs(t - this.tension) < 0.01) return;
    this.tension = t;
    const now = this.ctx.currentTime;
    this.dreadGain.gain.setTargetAtTime(0.012 + t * 0.13, now, 0.6);
    this.airFilter.Q.setTargetAtTime(0.6 + t * 3, now, 0.8);
    this.humGain.gain.setTargetAtTime(0.05 + t * 0.03, now, 0.8);
  }

  private scheduleEvent() {
    if (this.stopped) return;
    const delay = 10 + Math.random() * 25 - this.tension * 6;
    this.eventTimer = window.setTimeout(() => {
      this.playEvent();
      this.scheduleEvent();
    }, delay * 1000);
  }

  /** A knock in the ducts, a tick of cooling metal, or a long distant groan. */
  private playEvent() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.out);
    const kind = Math.random();
    if (kind < 0.45) {
      // Knock(s): short low thumps.
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        const s = t + i * (0.18 + Math.random() * 0.2);
        o.frequency.setValueAtTime(110 + Math.random() * 40, s);
        o.frequency.exponentialRampToValueAtTime(45, s + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.22, s + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.25);
        o.connect(g).connect(pan);
        o.start(s);
        o.stop(s + 0.3);
      }
    } else if (kind < 0.75) {
      // Tick: cooling metal.
      const src = ctx.createBufferSource();
      src.buffer = brownNoiseBuffer(ctx, 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp).connect(g).connect(pan);
      src.start(t);
    } else {
      // Groan: a slow detuned glide through a resonant band-pass, like a duct flexing far away.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(95 + Math.random() * 30, t);
      o.frequency.linearRampToValueAtTime(58 + Math.random() * 10, t + 2.8);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 320;
      bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.8);
      g.gain.linearRampToValueAtTime(0.0001, t + 3);
      o.connect(bp).connect(g).connect(pan);
      o.start(t);
      o.stop(t + 3.1);
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.eventTimer);
    for (const n of this.nodes) {
      try {
        (n as AudioScheduledSourceNode).stop?.();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    }
  }
}

/** Jump-scare sting: sub thump + noise blast + a rising detuned screech. ~1.4 s. */
export function playSting(ctx: AudioContext, out: AudioNode) {
  const t = ctx.currentTime;
  const thump = ctx.createOscillator();
  thump.frequency.setValueAtTime(70, t);
  thump.frequency.exponentialRampToValueAtTime(30, t + 0.4);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.9, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  thump.connect(tg).connect(out);
  thump.start(t);
  thump.stop(t + 0.7);

  const blast = ctx.createBufferSource();
  blast.buffer = brownNoiseBuffer(ctx, 1.5, true);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.7, t);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  blast.connect(bg).connect(out);
  blast.start(t);

  for (const [f0, f1] of [[620, 1500], [655, 1580], [900, 2100]] as [number, number][]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.5);
  }
}

/** Low-frequency oscillator: returns the source (to stop) and its depth gain (to connect). */
function lfo(ctx: AudioContext, hz: number, depth: number): { osc: OscillatorNode; out: GainNode } {
  const osc = ctx.createOscillator();
  osc.frequency.value = hz;
  const out = ctx.createGain();
  out.gain.value = depth;
  osc.connect(out);
  osc.start();
  return { osc, out };
}

function brownNoiseBuffer(ctx: AudioContext, seconds: number, white = false): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (white) d[i] = w * 0.6;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  return buf;
}
