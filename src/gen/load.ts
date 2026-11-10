import type { Building, LevelSize } from './types.ts';

/** Generate off the main thread; falls back to inline generation if workers fail. */
export async function loadBuilding(seed: string, size: LevelSize): Promise<Building> {
  try {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const b = await new Promise<Building>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ ok: boolean; building?: Building; error?: string }>) =>
        e.data.ok ? resolve(e.data.building!) : reject(new Error(e.data.error));
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ seed, size });
    });
    worker.terminate();
    return b;
  } catch {
    const { generateBuilding } = await import('./generate.ts');
    return generateBuilding(seed, size);
  }
}
