import type { LevelSize } from './types.ts';

export interface SizeConfig {
  width: number;
  height: number;
  rooms: [number, number];
  halls: [number, number];
  /** Fraction of non-MST room links added back to form loops. */
  loopChance: number;
  deadEnds: [number, number];
  minPath: number;
}

export const SIZE_CONFIG: Record<LevelSize, SizeConfig> = {
  small: { width: 12, height: 12, rooms: [5, 7], halls: [0, 1], loopChance: 0.18, deadEnds: [1, 3], minPath: 14 },
  medium: { width: 20, height: 20, rooms: [10, 14], halls: [1, 2], loopChance: 0.2, deadEnds: [3, 5], minPath: 26 },
  large: { width: 30, height: 30, rooms: [20, 26], halls: [2, 3], loopChance: 0.22, deadEnds: [5, 8], minPath: 40 },
};

export const CELL_SIZE = 4;
export const STOREY_HEIGHT = 3.6;
export const WALL_THICKNESS = 0.3;
/** Width of a doorway opening in metres. */
export const DOOR_WIDTH = 1.8;
export const DOOR_HEIGHT = 2.6;
export const MAX_ATTEMPTS = 40;

export function isLevelSize(s: string | null | undefined): s is LevelSize {
  return s === 'small' || s === 'medium' || s === 'large';
}
