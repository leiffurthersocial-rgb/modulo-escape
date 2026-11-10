/// <reference lib="webworker" />
import { generateLevel } from './generate.ts';
import type { LevelSize } from './types.ts';

self.onmessage = (e: MessageEvent<{ seed: string; size: LevelSize }>) => {
  try {
    const level = generateLevel(e.data.seed, e.data.size);
    (self as unknown as Worker).postMessage({ ok: true, level });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
