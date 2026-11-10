/**
 * Quality presets (PLAN.md §3). Every knob the renderer reads lives here; "custom" is any
 * mix the player sets in Settings → Graphics. Persisted with the other settings.
 */
import type { TexTierName } from './assetManifest.ts';

export type PresetName = 'ultra' | 'high' | 'medium' | 'low' | 'battery' | 'custom';

export interface Quality {
  name: PresetName;
  pixelRatioCap: number;
  /** 0 = uncapped. */
  fpsCap: number;
  /** 0 = sun shadows off. */
  shadowMapSize: number;
  /** Half-extent of the sun shadow frustum (m). */
  shadowDistance: number;
  flashlightShadows: boolean;
  ao: 'off' | 'half' | 'full';
  bloom: boolean;
  lightShafts: 'off' | 'cards' | 'full';
  antialias: 'none' | 'fxaa' | 'smaa';
  /** Depth of field: off by default everywhere, opt-in. */
  dof: boolean;
  /** Post-processing at all (off = direct render with tone mapping only). */
  post: boolean;
  textureTier: TexTierName;
  anisotropy: number;
  hdriRes: '1k' | '2k';
  chunkRadius: number;
  /** Chunks / outdoor tiles beyond this distance (m) are not drawn. */
  viewDistance: number;
  vegetation: number;
  decals: number;
  particles: number;
  lightPool: number;
  physicsHz: number;
}

const base: Omit<Quality, 'name'> = {
  pixelRatioCap: 1.5,
  fpsCap: 60,
  shadowMapSize: 2048,
  shadowDistance: 20,
  flashlightShadows: true,
  ao: 'half',
  bloom: true,
  lightShafts: 'full',
  antialias: 'smaa',
  dof: false,
  post: true,
  textureTier: '2k',
  anisotropy: 8,
  hdriRes: '2k',
  chunkRadius: 2,
  viewDistance: 56,
  vegetation: 1,
  decals: 1,
  particles: 0.7,
  lightPool: 6,
  physicsHz: 60,
};

export const PRESETS: Record<Exclude<PresetName, 'custom'>, Quality> = {
  ultra: { ...base, name: 'ultra', viewDistance: 72, pixelRatioCap: 2, fpsCap: 0, shadowMapSize: 4096, shadowDistance: 34, ao: 'full', anisotropy: 16, particles: 1, lightPool: 8 },
  high: { ...base, name: 'high' },
  medium: {
    ...base,
    name: 'medium',
    pixelRatioCap: 1.25,
    shadowMapSize: 1024,
    shadowDistance: 20,
    flashlightShadows: false,
    lightShafts: 'cards',
    textureTier: '1k',
    anisotropy: 4,
    chunkRadius: 2,
    viewDistance: 40,
    vegetation: 0.7,
    decals: 0.85,
    particles: 0.5,
    lightPool: 4,
  },
  low: {
    ...base,
    name: 'low',
    pixelRatioCap: 1,
    shadowMapSize: 512,
    shadowDistance: 15,
    flashlightShadows: false,
    ao: 'off',
    bloom: false,
    lightShafts: 'cards',
    antialias: 'fxaa',
    textureTier: '1k',
    anisotropy: 2,
    hdriRes: '1k',
    chunkRadius: 1,
    viewDistance: 30,
    vegetation: 0.5,
    decals: 0.5,
    particles: 0.25,
    lightPool: 3,
  },
  battery: {
    ...base,
    name: 'battery',
    pixelRatioCap: 0.75,
    fpsCap: 30,
    shadowMapSize: 0,
    shadowDistance: 0,
    flashlightShadows: false,
    ao: 'off',
    bloom: false,
    lightShafts: 'off',
    antialias: 'none',
    post: false,
    textureTier: '512',
    anisotropy: 1,
    hdriRes: '1k',
    chunkRadius: 1,
    viewDistance: 20,
    vegetation: 0.3,
    decals: 0.5,
    particles: 0,
    lightPool: 2,
    physicsHz: 30,
  },
};

export const PRESET_ORDER: Exclude<PresetName, 'custom'>[] = ['ultra', 'high', 'medium', 'low', 'battery'];

/** Sensible default: touch devices / small screens start on Medium, desktops on High. */
export function defaultPreset(): Exclude<PresetName, 'custom'> {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const ipadLike = /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return coarse || ipadLike ? 'medium' : 'high';
}

/** One notch down (for the watchdog). Returns null at the bottom. */
export function lowerPreset(name: PresetName): Exclude<PresetName, 'custom'> | null {
  const i = PRESET_ORDER.indexOf(name === 'custom' ? 'medium' : name);
  return i >= 0 && i < PRESET_ORDER.length - 1 ? PRESET_ORDER[i + 1]! : null;
}

// Back-compat for the Phase 1 bench presets.
export const PHASE1_PRESETS: Quality[] = PRESET_ORDER.map((n) => PRESETS[n]);
export const DEFAULT_QUALITY: Quality = PRESETS.high;
