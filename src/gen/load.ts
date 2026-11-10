import type { LevelData, LevelSize } from './types.ts';

/** Generate off the main thread; falls back to inline generation if workers fail. */
export async function loadLevel(seed: string, size: LevelSize): Promise<LevelData> {
  try {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const level = await new Promise<LevelData>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ ok: boolean; level?: LevelData; error?: string }>) =>
        e.data.ok ? resolve(e.data.level!) : reject(new Error(e.data.error));
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ seed, size });
    });
    worker.terminate();
    return level;
  } catch {
    const { generateLevel } = await import('./generate.ts');
    return generateLevel(seed, size);
  }
}
