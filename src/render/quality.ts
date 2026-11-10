/**
 * Quality settings applied at runtime. Phase 1 has a few knobs; Phase 2 grows this into
 * the full Ultra/High/Medium/Low/Battery Saver/Custom preset system (see PLAN.md §3).
 */
export interface Quality {
  name: string;
  pixelRatioCap: number;
  /** 0 = uncapped. */
  fpsCap: number;
  /** 0 = sun shadows off. */
  shadowMapSize: number;
  chunkRadius: number;
  lightPool: number;
  physicsHz: number;
}

export const PHASE1_PRESETS: Quality[] = [
  { name: 'high', pixelRatioCap: 1.5, fpsCap: 0, shadowMapSize: 2048, chunkRadius: 3, lightPool: 6, physicsHz: 60 },
  { name: 'medium', pixelRatioCap: 1.25, fpsCap: 60, shadowMapSize: 1024, chunkRadius: 2, lightPool: 4, physicsHz: 60 },
  { name: 'low', pixelRatioCap: 1, fpsCap: 60, shadowMapSize: 512, chunkRadius: 2, lightPool: 3, physicsHz: 60 },
  { name: 'battery', pixelRatioCap: 0.75, fpsCap: 30, shadowMapSize: 0, chunkRadius: 1, lightPool: 2, physicsHz: 30 },
];

export const DEFAULT_QUALITY: Quality = PHASE1_PRESETS[1]!;
