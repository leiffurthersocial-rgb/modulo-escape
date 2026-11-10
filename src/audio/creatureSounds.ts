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

function sink(ctx: AudioContext, out: AudioNode, o: SpatialOpts): AudioNode {
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
