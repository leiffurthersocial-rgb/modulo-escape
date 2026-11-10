import type { LevelSize } from './types.ts';

export interface SizeConfig {
  width: number;
  height: number;
  rooms: [number, number];
  halls: [number, number];
  /** Fraction of non-MST room links added back to form loops. */
  loopChance: number;
  deadEnds: [number, number];
  /** Minimum start → exit path (cells, all floors). */
  minPath: number;
  floors: number;
  /** Stair flights between each pair of adjacent floors. */
  stairsPerLevel: [number, number];
}

export const SIZE_CONFIG: Record<LevelSize, SizeConfig> = {
  small: { width: 12, height: 12, rooms: [5, 7], halls: [0, 1], loopChance: 0.18, deadEnds: [1, 3], minPath: 18, floors: 2, stairsPerLevel: [1, 1] },
  medium: { width: 18, height: 18, rooms: [8, 11], halls: [1, 1], loopChance: 0.22, deadEnds: [2, 4], minPath: 34, floors: 3, stairsPerLevel: [1, 2] },
  large: { width: 24, height: 24, rooms: [13, 17], halls: [1, 2], loopChance: 0.24, deadEnds: [3, 6], minPath: 50, floors: 4, stairsPerLevel: [1, 2] },
};

export const CELL_SIZE = 4;
export const STOREY_HEIGHT = 3.6;
/** Floor slab (0.13) + ceiling slab (0.12) between storeys. */
export const FLOOR_STEP = STOREY_HEIGHT + 0.25;
export const WALL_THICKNESS = 0.3;
/** Width of a doorway opening in metres. */
export const DOOR_WIDTH = 1.8;
export const DOOR_HEIGHT = 2.6;
export const MAX_ATTEMPTS = 40;

export function isLevelSize(s: string | null | undefined): s is LevelSize {
  return s === 'small' || s === 'medium' || s === 'large';
}
