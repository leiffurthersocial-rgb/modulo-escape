import type { EdgeKind, LevelData, Side } from './types.ts';

export const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];
export const DIR: Record<Side, { dx: number; dz: number }> = {
  N: { dx: 0, dz: -1 },
  E: { dx: 1, dz: 0 },
  S: { dx: 0, dz: 1 },
  W: { dx: -1, dz: 0 },
};
export const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export interface GridDims {
  width: number;
  height: number;
}

/** Location of a cell side in the edge arrays. */
export function edgeRef(g: GridDims, x: number, z: number, side: Side): { axis: 'x' | 'z'; i: number } {
  switch (side) {
    case 'N':
      return { axis: 'z', i: z * g.width + x };
    case 'S':
      return { axis: 'z', i: (z + 1) * g.width + x };
    case 'W':
      return { axis: 'x', i: z * (g.width + 1) + x };
    case 'E':
      return { axis: 'x', i: z * (g.width + 1) + x + 1 };
  }
}

export interface EdgeArrays extends GridDims {
  edgesX: EdgeKind[];
  edgesZ: EdgeKind[];
}

export function getEdge(l: EdgeArrays, x: number, z: number, side: Side): EdgeKind {
  const r = edgeRef(l, x, z, side);
  return (r.axis === 'x' ? l.edgesX[r.i] : l.edgesZ[r.i]) ?? 'none';
}

export function setEdge(l: EdgeArrays, x: number, z: number, side: Side, kind: EdgeKind): void {
  const r = edgeRef(l, x, z, side);
  if (r.axis === 'x') l.edgesX[r.i] = kind;
  else l.edgesZ[r.i] = kind;
}

export function isPassable(e: EdgeKind): boolean {
  return e === 'door' || e === 'open' || e === 'broken';
}

export function inBounds(g: GridDims, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < g.width && z < g.height;
}

export const cellIndex = (g: GridDims, x: number, z: number) => z * g.width + x;

/** Cell centre in world metres. Level origin (0,0) is the north-west grid corner. */
export function cellCenter(l: Pick<LevelData, 'cellSize'>, x: number, z: number): { x: number; z: number } {
  return { x: (x + 0.5) * l.cellSize, z: (z + 0.5) * l.cellSize };
}

/** World position → cell coordinates (may be out of bounds). */
export function worldToCell(l: Pick<LevelData, 'cellSize'>, wx: number, wz: number): { x: number; z: number } {
  return { x: Math.floor(wx / l.cellSize), z: Math.floor(wz / l.cellSize) };
}

/** Rotation (radians about +Y) that turns a piece authored facing -Z (north) to face `side`. */
export const SIDE_YAW: Record<Side, number> = { N: 0, W: Math.PI / 2, S: Math.PI, E: -Math.PI / 2 };
