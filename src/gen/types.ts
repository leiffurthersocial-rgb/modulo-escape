/** Pure data describing a generated level. JSON-serialisable, no three.js types. */

export type LevelSize = 'small' | 'medium' | 'large';

/** What sits on a cell edge. Passable: door, open, broken, exit (once opened). */
export type EdgeKind = 'none' | 'solid' | 'window' | 'door' | 'open' | 'broken' | 'exit';

export type CellKind = 'void' | 'room' | 'hall' | 'corridor';

export type Side = 'N' | 'E' | 'S' | 'W';

export interface Cell {
  kind: CellKind;
  /** Room id for room/hall cells, -1 otherwise. */
  room: number;
  floor: 'intact' | 'cracked' | 'puddle';
  ceiling: 'intact' | 'hole';
}

export interface Room {
  id: number;
  x: number;
  z: number;
  w: number;
  h: number;
  kind: 'room' | 'hall';
}

export type PropType =
  | 'rubble'
  | 'debris'
  | 'barrel'
  | 'collapsed_slab'
  | 'vegetation'
  | 'chair'
  | 'desk'
  | 'pipe';

export interface PropSlot {
  type: PropType;
  /** Cell coordinates. */
  cx: number;
  cz: number;
  /** Position in world metres (x, z); y is floor level. */
  x: number;
  z: number;
  /** Footprint radius in metres (for overlap checks and colliders). */
  r: number;
  rot: number;
  scale: number;
  /** Small integer for model/material variant selection. */
  variant: number;
  /** Whether the player collides with it. */
  solid: boolean;
}

export interface LightSlot {
  id: number;
  cx: number;
  cz: number;
  kind: 'ceiling' | 'sun_shaft';
  /** 0..1, how broken: director uses it for flicker later. */
  decay: number;
}

export interface NavGraph {
  /** For each cell index, the indices of passable neighbours. Empty for void. */
  adj: number[][];
  /** BFS distance (in cells) to the exit cell, -1 when unreachable/void. */
  distToExit: number[];
}

export interface LevelStats {
  attempts: number;
  walkable: number;
  rooms: number;
  halls: number;
  corridors: number;
  loops: number;
  deadEnds: number;
  pathLength: number;
}

import type { Dressing } from './dressing.ts';

export interface LevelData {
  version: 1;
  seed: string;
  size: LevelSize;
  width: number;
  height: number;
  /** Metres per cell side. */
  cellSize: number;
  storeyHeight: number;
  cells: Cell[];
  /** West edge of cell (x,z) at index z*(width+1)+x. x = width is the far east boundary. */
  edgesX: EdgeKind[];
  /** North edge of cell (x,z) at index z*width+x. z = height is the far south boundary. */
  edgesZ: EdgeKind[];
  rooms: Room[];
  /** Interior pillars at grid vertices (vertex coordinates). */
  pillars: { x: number; z: number }[];
  start: { x: number; z: number; facing: Side };
  exit: { x: number; z: number; side: Side };
  props: PropSlot[];
  lights: LightSlot[];
  /** Candidate spawn points for future entities (cell coords). */
  spawnPoints: { x: number; z: number }[];
  nav: NavGraph;
  stats: LevelStats;
  /** Decals, damp map, vines, roots, trees, shrubs (separate RNG streams). */
  dressing: Dressing;
}
