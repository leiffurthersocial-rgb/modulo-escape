/// <reference lib="webworker" />
import { generateBuilding } from './generate.ts';
import type { LevelSize } from './types.ts';

self.onmessage = (e: MessageEvent<{ seed: string; size: LevelSize }>) => {
  try {
    const building = generateBuilding(e.data.seed, e.data.size);
    (self as unknown as Worker).postMessage({ ok: true, building });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
