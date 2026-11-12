/**
 * Recorded CC0 sound effects (Kenney, see scripts/fetch-sounds.ts) and the concrete-hall reverb.
 * Buffers load once after the AudioContext exists; until then (or if loading fails) callers fall
 * back to the procedural sounds.
 */
export type SampleId = 'step_concrete' | 'flesh_heavy' | 'punch_heavy' | 'metal_heavy' | 'metal_light' | 'plate_heavy' | 'cloth' | 'creak' | 'door_open' | 'latch';

export interface PlayOpts {
  gain?: number;
  /** Playback rate (pitch + speed); a little random variation is always added. */
  rate?: number;
  /** Random ± rate variation. */
  vary?: number;
  /** AudioContext time to start at (default now). */
  at?: number;
  /** Optional low-pass cutoff (Hz): distant / through walls. */
  lowpass?: number;
}

export class SampleBank {
  private buffers = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();
  ready = false;

  constructor(private ctx: AudioContext) {}

  async load(url = '/assets/audio/sounds.json'): Promise<void> {
    try {
      const manifest = (await (await fetch(url)).json()) as Record<string, string[]>;
      await Promise.all(
        Object.entries(manifest).map(async ([id, urls]) => {
          const bufs = await Promise.all(urls.map(async (u) => this.ctx.decodeAudioData(await (await fetch(u)).arrayBuffer())));
          this.buffers.set(id, bufs);
        }),
      );
      this.ready = true;
    } catch (e) {
      console.warn('Sound effects failed to load; using procedural sounds', e);
    }
  }

  has(id: SampleId): boolean {
    return (this.buffers.get(id)?.length ?? 0) > 0;
  }

  /** Play a random variant (never the same one twice in a row). */
  play(id: SampleId, dest: AudioNode, o: PlayOpts = {}): AudioBufferSourceNode | null {
    const list = this.buffers.get(id);
    if (!list?.length) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.last.get(id)) i = (i + 1) % list.length;
    this.last.set(id, i);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = list[i]!;
    const vary = o.vary ?? 0.06;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    let node: AudioNode = src;
    if (o.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      node.connect(lp);
      node = lp;
    }
    node.connect(g).connect(dest);
    src.start(o.at ?? ctx.currentTime);
    return src;
  }
}

/**
 * Concrete-corridor reverb: a generated stereo impulse response — a few hard early reflections,
 * then a dense, darkening ~1.8 s tail.
 */
export function createReverb(ctx: AudioContext, seconds = 1.8): ConvolverNode {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      // Darker as it decays (concrete absorbs highs): one-pole low-pass with a falling coefficient.
      const a = 0.25 + 0.7 * Math.min(1, t / seconds);
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = lp * Math.exp(-t * (6.9 / seconds)) * 1.8;
    }
    // Early reflections off the corridor walls.
    for (const [ms, amp] of [
      [11, 0.55],
      [19, 0.4],
      [31, 0.32],
      [47, 0.22],
      [68, 0.16],
    ] as const) {
      const k = Math.floor(((ms + (ch ? 3 : 0)) / 1000) * rate);
      if (k < len) d[k] = d[k]! + amp * (ch ? -1 : 1);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  return conv;
}
