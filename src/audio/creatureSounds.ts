/**
 * Positional creature sounds, synthesised (no downloads). Each call builds a tiny one-shot graph
 * ending in an HRTF panner at the sound's position; sounds on another floor go through a muffling
 * low-pass and come out quieter.
 */
export interface SpatialOpts {
  x: number;
  y: number;
  z: number;
  /** Floors between source and listener (0 = same floor). */
  floorsApart: number;
  gain: number;
}

/** Positional input for one sound (HRTF panner, muffled through floors). */
export function sink(ctx: AudioContext, out: AudioNode, o: SpatialOpts): AudioNode {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = 1.6;
  p.rolloffFactor = 1.3;
  p.maxDistance = 45;
  if (p.positionX) {
    p.positionX.value = o.x;
    p.positionY.value = o.y;
    p.positionZ.value = o.z;
  } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(o.x, o.y, o.z);
  const g = ctx.createGain();
  g.gain.value = o.gain * (o.floorsApart ? 0.35 / o.floorsApart : 1);
  if (o.floorsApart) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    g.connect(lp).connect(p);
  } else g.connect(p);
  p.connect(out);
  return g;
}

let noiseCache: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) return noiseCache;
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache = b;
  return b;
}

function noiseBurst(ctx: AudioContext, dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.004) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

/** Heavy bare foot: low thud, a bony click, a short drag/scrape. */
export function creatureStep(ctx: AudioContext, out: AudioNode, o: SpatialOpts, loud: number) {
  const d = sink(ctx, out, o);
  const t = ctx.currentTime;
  const thump = ctx.createOscillator();
  thump.frequency.setValueAtTime(85 + Math.random() * 20, t);
  thump.frequency.exponentialRampToValueAtTime(38, t + 0.14);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, t);
  tg.gain.exponentialRampToValueAtTime(0.9 * loud, t + 0.006);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  thump.connect(tg).connect(d);
  thump.start(t);
  thump.stop(t + 0.25);
  noiseBurst(ctx, d, t + 0.005, 0.04, 'bandpass', 2600, 3, 0.35 * loud);
  noiseBurst(ctx, d, t + 0.03, 0.12 + Math.random() * 0.12, 'lowpass', 900, 0.7, 0.18 * loud, 0.03);
}

/** Wet, ragged breathing: inhale then a long rasping exhale with tremolo. */
export function creatureBreath(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, o);
  const t = ctx.currentTime;
  noiseBurst(ctx, d, t, 0.7, 'bandpass', 700, 2, 0.25, 0.35);
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(520, t + 0.8);
  bp.frequency.linearRampToValueAtTime(330, t + 2.1);
  bp.Q.value = 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t + 0.75);
  g.gain.linearRampToValueAtTime(0.42, t + 0.95);
  g.gain.linearRampToValueAtTime(0.0001, t + 2.1);
  const trem = ctx.createOscillator();
  trem.frequency.value = 23;
  const tg = ctx.createGain();
  tg.gain.value = 0.18;
  trem.connect(tg).connect(g.gain);
  src.connect(bp).connect(g).connect(d);
  src.start(t + 0.75);
  src.stop(t + 2.2);
  trem.start(t + 0.75);
  trem.stop(t + 2.2);
}

/** A run of dry clicks from the throat. */
export function creatureClicks(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, o);
  const t = ctx.currentTime;
  const n = 4 + Math.floor(Math.random() * 6);
  let at = t;
  for (let i = 0; i < n; i++) {
    noiseBurst(ctx, d, at, 0.025, 'bandpass', 2200 + Math.random() * 1600, 8, 0.5);
    at += 0.045 + Math.random() * 0.06;
  }
}

/** It has seen you: a short, rising, detuned shriek. */
export function creatureScreech(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, o);
  const t = ctx.currentTime;
  for (const [f0, f1] of [[480, 1250], [503, 1310], [960, 2400]] as [number, number][]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(g).connect(d);
    osc.start(t);
    osc.stop(t + 1);
  }
  noiseBurst(ctx, d, t, 0.6, 'highpass', 1800, 0.7, 0.3, 0.02);
}

/** Point the WebAudio listener along the camera. */
export function setListener(ctx: AudioContext, pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }) {
  const l = ctx.listener;
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setTargetAtTime(pos.x, t, 0.02);
    l.positionY.setTargetAtTime(pos.y, t, 0.02);
    l.positionZ.setTargetAtTime(pos.z, t, 0.02);
    l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
    l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
    l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  } else {
    const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
    legacy.setPosition(pos.x, pos.y, pos.z);
    legacy.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
  }
}

interface ScreamOpts {
  /** Start pitch → peak (fast slide up) → end pitch (collapse). Hz. */
  f0: number;
  peak: number;
  end: number;
  gain: number;
  /** Amplitude-modulation "roughness" rate (Hz, 30–150 is what makes screams alarming) and depth 0..1. */
  rough: number;
  roughDepth: number;
  /** Subharmonic (period-doubling growl) level 0..1. */
  sub: number;
  /** Formant scale: 1 = human vocal tract, < 1 = huge, inhuman throat. */
  tract: number;
  /** Soft-clip drive. */
  drive: number;
  /** Pitch break: jump up this factor at ~45 % (0 = none). */
  crack: number;
}

/**
 * One scream voice. Source: detuned saws + a subharmonic, with vibrato, random pitch jitter and a
 * register crack; shaped by vowel formants sliding "aah" → "eeh" → collapsing; rough amplitude
 * flutter at 50–110 Hz; breath rasp through the same flutter; soft-clipped.
 */
function screamVoice(ctx: AudioContext, dest: AudioNode, t: number, dur: number, o: ScreamOpts) {
  const nodes: AudioScheduledSourceNode[] = [];
  const end = t + dur + 0.05;
  const src = ctx.createGain();
  // Pitch contour shared by every oscillator (via a ConstantSource → frequency).
  const pitch = ctx.createConstantSource();
  pitch.offset.setValueAtTime(o.f0, t);
  pitch.offset.exponentialRampToValueAtTime(o.peak, t + 0.11);
  pitch.offset.exponentialRampToValueAtTime(o.peak * 0.93, t + dur * 0.42);
  if (o.crack) {
    pitch.offset.setValueAtTime(o.peak * o.crack, t + dur * 0.45);
    pitch.offset.exponentialRampToValueAtTime(o.peak * o.crack * 0.9, t + dur * 0.7);
  }
  pitch.offset.exponentialRampToValueAtTime(o.end, t + dur);
  nodes.push(pitch);
  // Vibrato (5–8 Hz) and jitter (filtered noise, a few %).
  const vib = ctx.createOscillator();
  vib.frequency.value = 5 + Math.random() * 3;
  const vibG = ctx.createGain();
  vibG.gain.value = o.peak * 0.035;
  vib.connect(vibG);
  nodes.push(vib);
  const jit = ctx.createBufferSource();
  jit.buffer = noise(ctx);
  jit.loop = true;
  const jitLp = ctx.createBiquadFilter();
  jitLp.type = 'lowpass';
  jitLp.frequency.value = 25;
  const jitG = ctx.createGain();
  jitG.gain.value = o.peak * 0.12;
  jit.connect(jitLp).connect(jitG);
  nodes.push(jit);
  const osc = (type: OscillatorType, mult: number, detune: number, level: number) => {
    const x = ctx.createOscillator();
    x.type = type;
    x.frequency.value = 0;
    x.detune.value = detune;
    const m = ctx.createGain();
    m.gain.value = mult;
    pitch.connect(m).connect(x.frequency);
    vibG.connect(m);
    jitG.connect(m);
    const g = ctx.createGain();
    g.gain.value = level;
    x.connect(g).connect(src);
    nodes.push(x);
  };
  osc('sawtooth', 1, -14, 0.5);
  osc('sawtooth', 1, 9, 0.5);
  osc('square', 1, 3, 0.18);
  if (o.sub) osc('sawtooth', 0.5, 0, 0.45 * o.sub); // period doubling: a growl inside the scream
  // Breath rasp.
  const rasp = ctx.createBufferSource();
  rasp.buffer = noise(ctx);
  rasp.loop = true;
  const raspF = ctx.createBiquadFilter();
  raspF.type = 'bandpass';
  raspF.frequency.value = 2600 * o.tract;
  raspF.Q.value = 0.7;
  const raspG = ctx.createGain();
  raspG.gain.value = 0.35;
  rasp.connect(raspF).connect(raspG).connect(src);
  nodes.push(rasp);
  // Roughness: fast amplitude flutter.
  const rough = ctx.createGain();
  rough.gain.value = 1 - o.roughDepth * 0.5;
  const am = ctx.createOscillator();
  am.type = 'triangle';
  am.frequency.setValueAtTime(o.rough * 0.7, t);
  am.frequency.linearRampToValueAtTime(o.rough * 1.3, t + dur * 0.6);
  am.frequency.linearRampToValueAtTime(o.rough * 0.5, t + dur);
  const amG = ctx.createGain();
  amG.gain.value = o.roughDepth * 0.5;
  am.connect(amG).connect(rough.gain);
  nodes.push(am);
  src.connect(rough);
  // Vowel formants: open "aah" → strained "eeh" → collapsing "uhh"; scaled by the tract size.
  const formants: [number, number, number, number, number][] = [
    [900, 600, 380, 6, 1],
    [1300, 2200, 1000, 8, 0.8],
    [2800, 3000, 2500, 9, 0.5],
    [3600, 3900, 3300, 10, 0.3],
  ];
  const mix = ctx.createGain();
  for (const [a, b, c, q, g] of formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(a * o.tract, t);
    bp.frequency.linearRampToValueAtTime(b * o.tract, t + dur * 0.55);
    bp.frequency.linearRampToValueAtTime(c * o.tract, t + dur);
    const fg = ctx.createGain();
    fg.gain.value = g * 2.2;
    rough.connect(bp).connect(fg).connect(mix);
  }
  const clip = ctx.createWaveShaper();
  clip.curve = distortionCurve(o.drive) as Float32Array<ArrayBuffer>;
  clip.oversample = '2x';
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(o.gain, t + 0.035);
  env.gain.linearRampToValueAtTime(o.gain * 0.85, t + dur * 0.4);
  env.gain.linearRampToValueAtTime(o.gain, t + dur * 0.62);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  mix.connect(clip).connect(env).connect(dest);
  for (const n of nodes) {
    n.start(t);
    n.stop(end);
  }
}

/** A sharp, wet inhale (the breath before the scream). */
function gasp(ctx: AudioContext, dest: AudioNode, t: number, dur: number, gain: number) {
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
  // A wet catch in the throat: a short burst of flutter.
  const am = ctx.createOscillator();
  am.frequency.value = 38;
  const amG = ctx.createGain();
  amG.gain.value = 0.4;
  const flutter = ctx.createGain();
  flutter.gain.value = 0.6;
  am.connect(amG).connect(flutter.gain);
  n.connect(bp).connect(flutter).connect(g).connect(dest);
  n.start(t, Math.random());
  n.stop(t + dur + 0.05);
  am.start(t);
  am.stop(t + dur + 0.05);
}

/** Choking, gurgling rattle (vocal fry) — the end of a scream. */
function rattle(ctx: AudioContext, dest: AudioNode, t: number, dur: number, gain: number) {
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'bandpass';
  lp.frequency.value = 520;
  lp.Q.value = 1.4;
  const fry = ctx.createGain();
  fry.gain.value = 0;
  const pulse = ctx.createOscillator();
  pulse.type = 'square';
  pulse.frequency.setValueAtTime(34, t);
  pulse.frequency.linearRampToValueAtTime(19, t + dur);
  const pg = ctx.createGain();
  pg.gain.value = 0.5;
  pulse.connect(pg).connect(fry.gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.linearRampToValueAtTime(gain * 0.7, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(lp).connect(fry).connect(g).connect(dest);
  n.start(t, Math.random());
  n.stop(t + dur + 0.05);
  pulse.start(t);
  pulse.stop(t + dur + 0.05);
}

/** Positional proximity scream (Robin is near): often a gasp first, then a rough, cracking scream. */
export function creatureScream(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, o);
  let t = ctx.currentTime;
  if (Math.random() < 0.55) {
    gasp(ctx, d, t, 0.28, 0.5);
    t += 0.3;
  }
  const dur = 0.8 + Math.random() * 0.9;
  const base = 380 + Math.random() * 180;
  screamVoice(ctx, d, t, dur, {
    f0: base * 0.7,
    peak: base * (1.7 + Math.random() * 0.5),
    end: base * 0.55,
    gain: 0.55,
    rough: 60 + Math.random() * 40,
    roughDepth: 0.75,
    sub: 0.6,
    tract: 0.9,
    drive: 6,
    crack: Math.random() < 0.5 ? 1.22 : 0,
  });
  // A low, inhuman second throat under it.
  screamVoice(ctx, d, t + 0.02, dur * 0.95, { f0: base * 0.25, peak: base * 0.45, end: base * 0.2, gain: 0.18, rough: 42, roughDepth: 0.9, sub: 1, tract: 0.6, drive: 10, crack: 0 });
  if (Math.random() < 0.4) rattle(ctx, d, t + dur * 0.92, 0.45, 0.3);
}

function distortionCurve(amount: number): Float32Array {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return c;
}

/**
 * Jump-scare scream, timed so its attack lands at `at`: a sharp inhale right before, then three
 * throats at once — a human scream that cracks upwards, a piercing shriek, and a huge low
 * growl-scream — panned wide, rough and overdriven, over a sub hit and a noise blast; it ends in a
 * choking rattle. Deliberately the loudest thing in the game.
 */
export function screamSting(ctx: AudioContext, out: AudioNode, at = ctx.currentTime) {
  const t = at;
  // Brick-wall-ish limiter: loud and saturated, never digitally clipped.
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -8;
  lim.knee.value = 4;
  lim.ratio.value = 14;
  lim.attack.value = 0.002;
  lim.release.value = 0.12;
  lim.connect(out);
  // Presence: push the 2–4 kHz band where screams pierce.
  const pres = ctx.createBiquadFilter();
  pres.type = 'peaking';
  pres.frequency.value = 2800;
  pres.Q.value = 0.8;
  pres.gain.value = 9;
  pres.connect(lim);
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(pres);
  const pan = (p: number) => {
    const sp = ctx.createStereoPanner();
    sp.pan.value = p;
    sp.connect(master);
    return sp;
  };
  if (t - ctx.currentTime > 0.3) gasp(ctx, master, t - 0.3, 0.28, 0.7);
  const dur = 1.75;
  screamVoice(ctx, pan(-0.35), t, dur, { f0: 420, peak: 1150, end: 300, gain: 1, rough: 75, roughDepth: 0.8, sub: 0.7, tract: 1, drive: 20, crack: 1.3 });
  screamVoice(ctx, pan(0.4), t + 0.05, dur * 0.8, { f0: 900, peak: 2500, end: 700, gain: 0.8, rough: 110, roughDepth: 0.6, sub: 0.2, tract: 1.15, drive: 14, crack: 1.15 });
  screamVoice(ctx, pan(0), t, dur * 1.05, { f0: 110, peak: 240, end: 70, gain: 0.3, rough: 45, roughDepth: 0.95, sub: 1, tract: 0.55, drive: 26, crack: 0 });
  rattle(ctx, master, t + dur * 0.9, 0.6, 0.45);
  // Sub hit + blast (clean, so it thumps).
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(70, t);
  sub.frequency.exponentialRampToValueAtTime(26, t + 0.6);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.7, t);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  sub.connect(sg).connect(lim);
  sub.start(t);
  sub.stop(t + 0.85);
  noiseBurst(ctx, lim, t, 0.7, 'highpass', 500, 0.7, 0.55, 0.004);
}

/** Leo's roar: a huge low throat, rough and long, with a sub rumble you feel. Positional. */
export function creatureRoar(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, { ...o, gain: o.gain * 1.8 });
  const t = ctx.currentTime;
  screamVoice(ctx, d, t, 1.25, { f0: 70, peak: 150, end: 55, gain: 0.9, rough: 38, roughDepth: 0.95, sub: 1, tract: 0.5, drive: 22, crack: 0 });
  screamVoice(ctx, d, t + 0.05, 1.1, { f0: 160, peak: 320, end: 120, gain: 0.35, rough: 60, roughDepth: 0.8, sub: 0.6, tract: 0.7, drive: 14, crack: 0 });
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(48, t);
  sub.frequency.linearRampToValueAtTime(34, t + 1.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
  sub.connect(g).connect(d);
  sub.start(t);
  sub.stop(t + 1.35);
}

/** Leo's growl when he's close: a short, low, rattling throat. */
export function creatureGrowl(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, o);
  const t = ctx.currentTime;
  screamVoice(ctx, d, t, 0.7 + Math.random() * 0.5, { f0: 62, peak: 95, end: 55, gain: 0.7, rough: 28 + Math.random() * 10, roughDepth: 0.95, sub: 1, tract: 0.5, drive: 12, crack: 0 });
}

/** Jovan's head dragging along the ceiling: a slow concrete scrape. */
export function ceilingScrape(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, o);
  const t = ctx.currentTime;
  const dur = 0.9 + Math.random() * 0.8;
  noiseBurst(ctx, d, t, dur, 'bandpass', 900 + Math.random() * 500, 2.2, 0.35, dur * 0.4);
  noiseBurst(ctx, d, t + 0.1, dur * 0.8, 'bandpass', 2600, 4, 0.12, dur * 0.3);
}

/** Leo slamming into a wall. */
export function wallThud(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, { ...o, gain: o.gain * 2 });
  const t = ctx.currentTime;
  const th = ctx.createOscillator();
  th.frequency.setValueAtTime(70, t);
  th.frequency.exponentialRampToValueAtTime(28, t + 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(1.2, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  th.connect(g).connect(d);
  th.start(t);
  th.stop(t + 0.6);
  noiseBurst(ctx, d, t, 0.4, 'lowpass', 600, 0.7, 0.8, 0.003);
}

/**
 * Robin's giggle, echoing from somewhere else: a quick run of breathy "hee-hee-hah"s, too high
 * and slightly off, the last one dragging.
 */
export function creatureGiggle(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, { ...o, gain: o.gain * 1.3 });
  let t = ctx.currentTime;
  const n = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const dur = last ? 0.32 : 0.075 + Math.random() * 0.03;
    const f0 = 430 - i * 14 + (Math.random() - 0.5) * 30;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 1.06, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * (last ? 0.72 : 0.92), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // Vowel formants: "ee" for the giggles, "ah" for the last one.
    for (const [f, q, g] of last ? ([[800, 6, 1], [1250, 8, 0.7]] as const) : ([[330, 6, 0.6], [2300, 9, 1]] as const)) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g;
      osc.connect(bp).connect(gg).connect(env);
    }
    env.connect(d);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    noiseBurst(ctx, d, t, dur * 0.8, 'bandpass', 3000, 1.2, 0.05, 0.006); // breath in it
    t += dur + 0.05 + Math.random() * 0.05;
  }
}

/** Leo knocking on a wall, searching: three heavy, slow knocks on concrete. */
export function wallKnocks(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, { ...o, gain: o.gain * 1.4 });
  const t0 = ctx.currentTime;
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * (0.42 + Math.random() * 0.12);
    const th = ctx.createOscillator();
    th.frequency.setValueAtTime(110, t);
    th.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    th.connect(g).connect(d);
    th.start(t);
    th.stop(t + 0.3);
    noiseBurst(ctx, d, t, 0.12, 'bandpass', 420, 1.4, 0.7, 0.002);
  }
}

/** Your pistol: a hard crack, a low punch, and a ringing in your ears that fades. */
export function gunshot(ctx: AudioContext, out: AudioNode) {
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.value = 1.4;
  g.connect(out);
  noiseBurst(ctx, g, t, 0.09, 'highpass', 1400, 0.7, 1.6, 0.001);
  noiseBurst(ctx, g, t, 0.5, 'lowpass', 900, 0.8, 1.0, 0.002);
  const th = ctx.createOscillator();
  th.frequency.setValueAtTime(140, t);
  th.frequency.exponentialRampToValueAtTime(38, t + 0.25);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(1.3, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  th.connect(tg).connect(g);
  th.start(t);
  th.stop(t + 0.4);
  // Tinnitus.
  const ring = ctx.createOscillator();
  ring.frequency.value = 3900 + Math.random() * 300;
  const rg = ctx.createGain();
  rg.gain.setValueAtTime(0.0001, t);
  rg.gain.linearRampToValueAtTime(0.03, t + 0.25);
  rg.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
  ring.connect(rg).connect(out);
  ring.start(t);
  ring.stop(t + 3.3);
}

/** Your heartbeat, speeding up: `beats` lub-dubs between `at` and `until`. */
export function heartbeat(ctx: AudioContext, out: AudioNode, at: number, until: number) {
  let t = at;
  let gap = 0.42;
  while (t < until) {
    for (const [dt, f, g] of [
      [0, 62, 0.9],
      [0.13, 52, 0.6],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f, t + dt);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t + dt + 0.12);
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t + dt);
      gg.gain.exponentialRampToValueAtTime(g, t + dt + 0.012);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.16);
      o.connect(gg).connect(out);
      o.start(t + dt);
      o.stop(t + dt + 0.2);
    }
    t += gap;
    gap = Math.max(0.24, gap * 0.82);
  }
}

/** Wet, slow breathing right at your left ear (in total darkness). */
export function earBreath(ctx: AudioContext, out: AudioNode, at: number, dur: number) {
  const pan = ctx.createStereoPanner();
  pan.pan.value = -0.85;
  pan.connect(out);
  // Exhale: low rasp with a wet flutter, then a short click of the tongue.
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1300, at);
  bp.frequency.linearRampToValueAtTime(650, at + dur);
  bp.Q.value = 1.2;
  const flutter = ctx.createGain();
  flutter.gain.value = 0.6;
  const am = ctx.createOscillator();
  am.frequency.value = 31;
  const amG = ctx.createGain();
  amG.gain.value = 0.4;
  am.connect(amG).connect(flutter.gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.75, at + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  n.connect(bp).connect(flutter).connect(g).connect(pan);
  n.start(at, Math.random());
  n.stop(at + dur + 0.05);
  am.start(at);
  am.stop(at + dur + 0.05);
  noiseBurst(ctx, pan, at + dur * 0.15, 0.02, 'bandpass', 3200, 4, 0.5);
}

/** The last shriek: short, piercing, with a hit — the "it's not over" scare. */
export function shriekSting(ctx: AudioContext, out: AudioNode, at: number) {
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -8;
  lim.ratio.value = 14;
  lim.attack.value = 0.002;
  lim.connect(out);
  screamVoice(ctx, lim, at, 0.45, { f0: 1200, peak: 2900, end: 1500, gain: 1, rough: 120, roughDepth: 0.7, sub: 0.4, tract: 1.2, drive: 24, crack: 0 });
  screamVoice(ctx, lim, at, 0.45, { f0: 160, peak: 300, end: 120, gain: 0.35, rough: 50, roughDepth: 0.9, sub: 1, tract: 0.55, drive: 26, crack: 0 });
  noiseBurst(ctx, lim, at, 0.3, 'highpass', 600, 0.7, 0.6, 0.002);
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(75, at);
  sub.frequency.exponentialRampToValueAtTime(30, at + 0.35);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.8, at);
  sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
  sub.connect(sg).connect(lim);
  sub.start(at);
  sub.stop(at + 0.5);
}

/** Your own footstep on concrete: soft scuff (crouch), step (walk), hard slap (sprint). */
export function playerStep(ctx: AudioContext, out: AudioNode, strength: number, side: number) {
  const t = ctx.currentTime;
  const pan = ctx.createStereoPanner();
  pan.pan.value = side * 0.15;
  const g = ctx.createGain();
  g.gain.value = 0.18 + strength * 0.5;
  g.connect(pan).connect(out);
  const thud = ctx.createOscillator();
  thud.frequency.setValueAtTime(110 + Math.random() * 20, t);
  thud.frequency.exponentialRampToValueAtTime(55, t + 0.07);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, t);
  tg.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  thud.connect(tg).connect(g);
  thud.start(t);
  thud.stop(t + 0.12);
  // Grit under the sole: sharper for a sprint.
  noiseBurst(ctx, g, t, 0.05 + strength * 0.05, 'bandpass', 1800 + strength * 1800 + Math.random() * 400, 1.5, 0.35 + strength * 0.4);
  if (strength < 0.2) noiseBurst(ctx, g, t + 0.02, 0.12, 'lowpass', 1200, 0.7, 0.15, 0.03); // scuff
}
