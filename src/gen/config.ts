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
  // One big floor of the KZU (no stairs). Lots of loops (circuits to shake off the monster), few
  // dead ends, several landmark halls (Mensa, Aula, Turnhalle, Mediothek, Pausenhalle).
  small: { width: 22, height: 22, rooms: [14, 18], halls: [2, 2], loopChance: 0.4, deadEnds: [0, 2], minPath: 26, floors: 1, stairsPerLevel: [0, 0] },
  medium: { width: 30, height: 30, rooms: [26, 32], halls: [3, 4], loopChance: 0.42, deadEnds: [1, 3], minPath: 40, floors: 1, stairsPerLevel: [0, 0] },
  large: { width: 38, height: 38, rooms: [42, 50], halls: [4, 5], loopChance: 0.45, deadEnds: [2, 4], minPath: 56, floors: 1, stairsPerLevel: [0, 0] },
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
