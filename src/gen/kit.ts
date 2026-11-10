/**
 * The building "kit": a flat list of modular pieces derived from LevelData.
 * Phase 1 renders each id as greybox geometry; Phase 2 swaps in textured models by id.
 * Every piece occupies exactly one slot (cell floor, cell ceiling, edge, vertex);
 * unique slots ⇒ no overlapping geometry (asserted by tests).
 */
import { cellIndex, isWalkable } from './grid.ts';
import type { EdgeKind, LevelData, Side } from './types.ts';

export type KitId =
  | 'floor'
  | 'floor_cracked'
  | 'floor_puddle'
  | 'ceiling'
  | 'ceiling_hole'
  | 'wall'
  | 'wall_window'
  | 'wall_door'
  | 'wall_broken'
  | 'exit_gate'
  | 'pillar'
  | 'corner_post';

export const KIT_IDS: readonly KitId[] = [
  'floor',
  'floor_cracked',
  'floor_puddle',
  'ceiling',
  'ceiling_hole',
  'wall',
  'wall_window',
  'wall_door',
  'wall_broken',
  'exit_gate',
  'pillar',
  'corner_post',
];

export interface KitPiece {
  id: KitId;
  /** Unique occupancy key. */
  slot: string;
  /** World position (metres) of the piece origin at floor level. */
  x: number;
  z: number;
  /** Rotation about +Y. Wall pieces are authored along the X axis. */
  yaw: number;
  /** Owning cell (for chunking). For edges/vertices, the cell to the S/E of it, clamped. */
  cx: number;
  cz: number;
  /** For walls: which side of the wall is the walkable interior ('both' for interior walls). */
  inside?: Side | 'both';
}

const WALL_ID: Partial<Record<EdgeKind, KitId>> = {
  solid: 'wall',
  window: 'wall_window',
  door: 'wall_door',
  broken: 'wall_broken',
  exit: 'exit_gate',
};

export function kitPieces(l: LevelData): KitPiece[] {
  const out: KitPiece[] = [];
  const S = l.cellSize;
  const walk = (x: number, z: number) => x >= 0 && z >= 0 && x < l.width && z < l.height && isWalkable(l.cells[cellIndex(l, x, z)]!.kind);
  const clampX = (x: number) => Math.min(Math.max(x, 0), l.width - 1);
  const clampZ = (z: number) => Math.min(Math.max(z, 0), l.height - 1);

  // Floors and ceilings.
  l.cells.forEach((c, i) => {
    if (c.kind === 'void') return;
    const cx = i % l.width;
    const cz = Math.floor(i / l.width);
    const x = (cx + 0.5) * S;
    const z = (cz + 0.5) * S;
    // Shafts have no floor (the stair below rises through); stair cells have no ceiling.
    if (c.floor !== 'none') {
      const floorId: KitId = c.floor === 'cracked' ? 'floor_cracked' : c.floor === 'puddle' ? 'floor_puddle' : 'floor';
      out.push({ id: floorId, slot: `f:${i}`, x, z, yaw: 0, cx, cz });
    }
    if (c.ceiling !== 'none') out.push({ id: c.ceiling === 'hole' ? 'ceiling_hole' : 'ceiling', slot: `c:${i}`, x, z, yaw: 0, cx, cz });
  });

  // Walls on horizontal edges (edgesZ): run along X, between (x,z-1) and (x,z).
  for (let z = 0; z <= l.height; z++) {
    for (let x = 0; x < l.width; x++) {
      const e = l.edgesZ[z * l.width + x]!;
      const id = WALL_ID[e];
      if (!id) continue;
      const n = walk(x, z - 1);
      const s = walk(x, z);
      const inside: Side | 'both' = n && s ? 'both' : s ? 'S' : 'N';
      out.push({ id, slot: `ez:${z * l.width + x}`, x: (x + 0.5) * S, z: z * S, yaw: 0, cx: x, cz: clampZ(z), inside });
    }
  }
  // Walls on vertical edges (edgesX): run along Z.
  for (let z = 0; z < l.height; z++) {
    for (let x = 0; x <= l.width; x++) {
      const e = l.edgesX[z * (l.width + 1) + x]!;
      const id = WALL_ID[e];
      if (!id) continue;
      const w = walk(x - 1, z);
      const ea = walk(x, z);
      const inside: Side | 'both' = w && ea ? 'both' : ea ? 'E' : 'W';
      out.push({ id, slot: `ex:${z * (l.width + 1) + x}`, x: x * S, z: (z + 0.5) * S, yaw: Math.PI / 2, cx: clampX(x), cz: z, inside });
    }
  }

  // Vertices: hall pillars, and corner posts wherever walls meet at an angle or end.
  const hall = new Set(l.pillars.map((p) => `${p.x},${p.z}`));
  const wallish = (e: EdgeKind | undefined) => !!e && e !== 'none' && e !== 'open';
  for (let vz = 0; vz <= l.height; vz++) {
    for (let vx = 0; vx <= l.width; vx++) {
      if (hall.has(`${vx},${vz}`)) {
        out.push({ id: 'pillar', slot: `v:${vx},${vz}`, x: vx * S, z: vz * S, yaw: 0, cx: clampX(vx), cz: clampZ(vz) });
        continue;
      }
      // Four edges meeting at this vertex.
      const north = vz > 0 ? l.edgesX[(vz - 1) * (l.width + 1) + vx] : undefined;
      const south = vz < l.height ? l.edgesX[vz * (l.width + 1) + vx] : undefined;
      const west = vx > 0 ? l.edgesZ[vz * l.width + vx - 1] : undefined;
      const east = vx < l.width ? l.edgesZ[vz * l.width + vx] : undefined;
      const ns = Number(wallish(north)) + Number(wallish(south));
      const we = Number(wallish(west)) + Number(wallish(east));
      if (ns + we === 0) continue;
      const straight = (ns === 2 && we === 0) || (we === 2 && ns === 0);
      if (straight) continue;
      out.push({ id: 'corner_post', slot: `v:${vx},${vz}`, x: vx * S, z: vz * S, yaw: 0, cx: clampX(vx), cz: clampZ(vz) });
    }
  }
  return out;
}
