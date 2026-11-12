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

/**
 * A scream: a few detuned sawtooth "voices" with fast vibrato, shaped by vowel formants (an open
 * "aah" sliding towards "eee"), plus breath noise. `intensity` 0..1 scales length and harshness.
 */
function screamVoice(ctx: AudioContext, dest: AudioNode, t: number, dur: number, f0: number, f1: number, gain: number) {
  const voices = [0, 7, -11, 15];
  const mix = ctx.createGain();
  mix.gain.value = gain;
  // Formants: F1 ~850→350, F2 ~1250→2300, F3 ~2800 (aah → eee).
  const formants: [number, number, number, number][] = [
    [850, 350, 7, 1],
    [1250, 2300, 9, 0.7],
    [2800, 3100, 10, 0.45],
  ];
  const sum = ctx.createGain();
  for (const [a, b, q, g] of formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(a, t);
    bp.frequency.linearRampToValueAtTime(b, t + dur * 0.8);
    const fg = ctx.createGain();
    fg.gain.value = g;
    sum.connect(bp).connect(fg).connect(mix);
  }
  for (const cents of voices) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = cents;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.35);
    o.frequency.exponentialRampToValueAtTime(f1 * 0.85, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 7 + Math.random() * 3;
    const vg = ctx.createGain();
    vg.gain.value = f1 * 0.03;
    vib.connect(vg).connect(o.frequency);
    o.connect(sum);
    o.start(t);
    o.stop(t + dur + 0.05);
    vib.start(t);
    vib.stop(t + dur + 0.05);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(1, t + 0.04);
  env.gain.setValueAtTime(1, t + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  mix.connect(env).connect(dest);
  noiseBurst(ctx, dest, t, dur * 0.9, 'bandpass', 3000, 1.2, gain * 0.5, 0.03);
}

/** Positional proximity scream (Robin is near). */
export function creatureScream(ctx: AudioContext, out: AudioNode, o: SpatialOpts) {
  const d = sink(ctx, out, o);
  const t = ctx.currentTime;
  const dur = 0.7 + Math.random() * 0.8;
  const base = 420 + Math.random() * 200;
  screamVoice(ctx, d, t, dur, base, base * (1.6 + Math.random() * 0.5), 0.5);
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
 * Jump-scare scream: several overlapping screams (one very high), overdriven, a sub hit and a
 * noise blast. ~2 s. Deliberately the loudest thing in the game.
 */
export function screamSting(ctx: AudioContext, out: AudioNode, at = ctx.currentTime) {
  const t = at;
  const drive = ctx.createWaveShaper();
  drive.curve = distortionCurve(18) as Float32Array<ArrayBuffer>;
  drive.oversample = '2x';
  const master = ctx.createGain();
  master.gain.value = 0.55;
  drive.connect(master).connect(out);
  screamVoice(ctx, drive, t, 1.9, 520, 1150, 0.8);
  screamVoice(ctx, drive, t + 0.04, 1.6, 700, 1600, 0.6);
  screamVoice(ctx, drive, t + 0.1, 1.2, 1100, 2400, 0.35);
  // Sub hit + blast (clean, so it thumps).
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(65, t);
  sub.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(1, t);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  sub.connect(sg).connect(out);
  sub.start(t);
  sub.stop(t + 0.75);
  noiseBurst(ctx, out, t, 0.9, 'highpass', 400, 0.7, 0.6, 0.005);
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
