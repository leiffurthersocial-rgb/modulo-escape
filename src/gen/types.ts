/** Pure data describing a generated level. JSON-serialisable, no three.js types. */

export type LevelSize = 'small' | 'medium' | 'large';

/** What sits on a cell edge. Passable: door, open, broken, exit (once opened). */
export type EdgeKind = 'none' | 'solid' | 'window' | 'door' | 'open' | 'broken' | 'exit';

/** stair = ramp cells on the lower floor; shaft = the opening above them on the upper floor (not walkable). */
export type CellKind = 'void' | 'room' | 'hall' | 'corridor' | 'stair' | 'shaft';

export type Side = 'N' | 'E' | 'S' | 'W';

export interface Cell {
  kind: CellKind;
  /** Room id for room/hall cells, -1 otherwise. */
  room: number;
  floor: 'intact' | 'cracked' | 'puddle' | 'none';
  ceiling: 'intact' | 'hole' | 'none';
}

export interface Room {
  id: number;
  x: number;
  z: number;
  w: number;
  h: number;
  /** landing = a corridor portal on a block border; court = an open-air courtyard (void). */
  kind: 'room' | 'hall' | 'stair' | 'shaft' | 'landing' | 'court';
  /** What the room is used for (endless KZU). */
  use?: RoomUse;
  /** Room number like "E07" / "312" (rooms only). */
  label?: string;
}

/** Room functions in the KZU. Halls are landmarks; the rest are rooms off the corridors. */
export type RoomUse =
  | 'classroom'
  | 'chemie'
  | 'physik'
  | 'biologie'
  | 'informatik'
  | 'musik'
  | 'bg'
  | 'lehrerzimmer'
  | 'sekretariat'
  | 'wc_damen'
  | 'wc_herren'
  | 'hauswart'
  | 'lager'
  | 'mensa'
  | 'aula'
  | 'turnhalle'
  | 'pausenhalle'
  | 'mediothek';

export type PropType =
  | 'rubble'
  | 'debris'
  | 'barrel'
  | 'collapsed_slab'
  | 'vegetation'
  | 'chair'
  | 'desk'
  | 'classroom_desk'
  | 'blackboard'
  | 'pipe'
  /** A Poly Haven model by id (`PropSlot.model`), real-world scale. */
  | 'model'
  // Code-built KZU furniture (box footprints `w × d`, see world/props.ts).
  | 'lab_bench'
  | 'counter'
  | 'stage'
  | 'seat_row'
  | 'wall_bars'
  | 'hoop'
  | 'gym_mat'
  | 'wc_stall'
  | 'sink'
  | 'piano'
  | 'monitor'
  | 'shelf'
  | 'pinboard';

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
  /** Poly Haven model id for type 'model'. */
  model?: string;
  /** Box footprint (m) along the prop's local X (w) and Z (d), for wall-aligned furniture. */
  w?: number;
  d?: number;
  /** Height of the base above the floor (m): wall-mounted things. */
  y?: number;
  /** Stands on top of another prop (index into props): the renderer lifts it onto that surface. */
  on?: number;
  /** Mounted on / standing flush against this wall of its cell. */
  wall?: Side;
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

/** One storey of the building. */
export interface LevelData {
  version: 2;
  /** Floor index (0 = ground floor). */
  floor: number;
  /** World Y of this floor's walking surface (m). */
  elevation: number;
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
  /** Start / exit cell on this floor, or x = -1 when it is on another floor. */
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

/**
 * A U-shaped (switchback) staircase on floor `lower`, 2 × 2 cells:
 *   flight A in (x,z) rises +z to half height → a flat landing across (x,z+1) and (x+side,z+1) →
 *   turn 180° → flight B in (x+side,z) rises −z to the upper floor.
 * Lower landing (x,z−1) on `lower`; upper landing (x+side,z−1) on `lower + 1`, where the four
 * stair cells are a shaft (an open stairwell).
 */
export interface Stair {
  x: number;
  z: number;
  lower: number;
  /** Which side the second flight is on: +1 (east) or −1 (west). */
  turn: 1 | -1;
}

/** The cells of a U staircase: flight A, the two landing cells, flight B, and both floor landings. */
export function stairCells(s: Stair) {
  return {
    a: { x: s.x, z: s.z },
    mid: { x: s.x, z: s.z + 1 },
    mid2: { x: s.x + s.turn, z: s.z + 1 },
    b: { x: s.x + s.turn, z: s.z },
    lowerLanding: { x: s.x, z: s.z - 1 },
    upperLanding: { x: s.x + s.turn, z: s.z - 1 },
    /** North-west corner of the 2 × 2 block. */
    x0: Math.min(s.x, s.x + s.turn),
  };
}

export interface BuildingStats {
  attempts: number;
  floors: number;
  stairs: number;
  walkable: number;
  rooms: number;
  halls: number;
  loops: number;
  deadEnds: number;
  /** Shortest start → exit path in cells, across floors. */
  pathLength: number;
}

/** The whole generated building: floors connected by stairs. Global node id = floor * width * height + cell. */
export interface Building {
  version: 2;
  seed: string;
  size: LevelSize;
  width: number;
  height: number;
  cellSize: number;
  storeyHeight: number;
  /** Vertical distance between floors (m). */
  floorStep: number;
  floors: LevelData[];
  stairs: Stair[];
  start: { floor: number; x: number; z: number; facing: Side };
  exit: { floor: number; x: number; z: number; side: Side };
  nav: NavGraph;
  stats: BuildingStats;
}
