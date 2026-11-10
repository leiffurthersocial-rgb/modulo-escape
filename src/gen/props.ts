/**
 * Seeded prop, light and spawn-point placement.
 *
 * Passability rule: solid props only go into corner slots and stay outside the
 * "centre cross" of a cell (1.2 m bands through the centre on both axes), so every
 * passable side of a cell stays connected to every other one.
 */
import type { Rng } from '../core/rng.ts';
import { bfs } from './nav.ts';
import { cellIndex, getEdge, isWalkable } from './grid.ts';
import type { EdgeKind, LevelData, LightSlot, PropSlot, PropType, Side } from './types.ts';

/** Corner slot offsets (cell-local metres for a 4 m cell) and the two sides they touch. */
const CORNERS: { u: number; v: number; sides: [Side, Side] }[] = [
  { u: 0.85, v: 0.85, sides: ['N', 'W'] },
  { u: 3.15, v: 0.85, sides: ['N', 'E'] },
  { u: 0.85, v: 3.15, sides: ['S', 'W'] },
  { u: 3.15, v: 3.15, sides: ['S', 'E'] },
];
const MIDS: { u: number; v: number; side: Side }[] = [
  { u: 2, v: 0.75, side: 'N' },
  { u: 3.25, v: 2, side: 'E' },
  { u: 2, v: 3.25, side: 'S' },
  { u: 0.75, v: 2, side: 'W' },
];

export const PROP_RADIUS: Record<PropType, number> = {
  rubble: 0.45,
  debris: 0.35,
  barrel: 0.35,
  collapsed_slab: 0.5,
  vegetation: 0.45,
  chair: 0.35,
  desk: 0.5,
  classroom_desk: 0.5,
  pipe: 0.2,
};
export const SOLID_PROPS: ReadonlySet<PropType> = new Set(['barrel', 'collapsed_slab', 'chair', 'desk', 'classroom_desk']);

const isWallLike = (e: EdgeKind) => e === 'solid' || e === 'window';

export function placeProps(l: LevelData, rng: Rng): PropSlot[] {
  const out: PropSlot[] = [];
  const s = l.cellSize / 4; // slots are authored for 4 m cells
  const startI = l.start.x >= 0 ? cellIndex(l, l.start.x, l.start.z) : -1;
  const exitI = l.exit.x >= 0 ? cellIndex(l, l.exit.x, l.exit.z) : -1;
  const add = (type: PropType, cx: number, cz: number, u: number, v: number, rot?: number) => {
    out.push({
      type,
      cx,
      cz,
      x: cx * l.cellSize + u * s,
      z: cz * l.cellSize + v * s,
      r: PROP_RADIUS[type],
      rot: rot ?? rng.range(0, Math.PI * 2),
      scale: rot !== undefined ? 1 : rng.range(0.85, 1.15),
      variant: rng.int(0, 3),
      solid: SOLID_PROPS.has(type),
    });
  };
  // Classrooms: desks in rows, all facing the same wall (seeded per room).
  const roomFacing = new Map<number, number>();
  const classroom = new Map<number, boolean>();
  for (const r of l.rooms) {
    roomFacing.set(r.id, rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]));
    classroom.set(r.id, r.kind === 'room' && r.w * r.h >= 2 && rng.chance(0.75));
  }

  for (let cz = 0; cz < l.height; cz++) {
    for (let cx = 0; cx < l.width; cx++) {
      const i = cellIndex(l, cx, cz);
      const cell = l.cells[i]!;
      if (!isWalkable(cell.kind) || cell.kind === 'stair') continue;
      const roomKind = cell.room >= 0 ? l.rooms[cell.room]!.kind : null;
      const keepClear = i === startI || i === exitI || roomKind === 'landing';
      const edge = (side: Side) => getEdge(l, cx, cz, side);
      const isClass = cell.kind === 'room' && classroom.get(cell.room);

      for (const c of CORNERS) {
        const [a, b] = c.sides;
        const ea = edge(a);
        const eb = edge(b);
        const doorway = (e: EdgeKind) => e === 'door' || e === 'broken' || e === 'exit' || e === 'open';
        const walls = Number(isWallLike(ea)) + Number(isWallLike(eb));
        if (isClass && !keepClear && !(ea === 'door' || eb === 'door' || ea === 'broken' || eb === 'broken')) {
          // Desk + chair at every free corner of a classroom cell: reads as rows with aisles.
          if (rng.chance(0.85)) add('classroom_desk', cx, cz, c.u, c.v, roomFacing.get(cell.room)! + rng.range(-0.12, 0.12));
          continue;
        }
        if (doorway(ea) && ea !== 'open') continue;
        if (doorway(eb) && eb !== 'open') continue;
        const roll = rng.next();
        const pDebris = walls === 2 ? 0.28 : walls === 1 ? 0.1 : 0.02;
        if (roll < pDebris) {
          add(rng.chance(0.6) ? 'rubble' : 'debris', cx, cz, c.u, c.v);
          continue;
        }
        if (keepClear || walls === 0) continue;
        const r2 = rng.next();
        if (cell.kind === 'room' && r2 < 0.12) add(rng.chance(0.6) ? 'chair' : 'desk', cx, cz, c.u, c.v);
        else if (cell.kind === 'hall' && r2 < 0.12) add('collapsed_slab', cx, cz, c.u, c.v);
        else if (r2 < 0.025) add('barrel', cx, cz, c.u, c.v);
      }

      // Mid-wall slots: old pipes along corridor walls.
      for (const m of MIDS) {
        if (edge(m.side) === 'solid' && cell.kind === 'corridor' && rng.chance(0.1)) add('pipe', cx, cz, m.u, m.v);
      }
    }
  }
  return out;
}

/** Fluorescent tubes: corridors every other cell, rooms and halls per cell group, stairwells. */
export function placeLights(l: LevelData, rng: Rng): LightSlot[] {
  const out: LightSlot[] = [];
  l.cells.forEach((c, i) => {
    if (!isWalkable(c.kind)) return;
    const cx = i % l.width;
    const cz = Math.floor(i / l.width);
    const room = c.room >= 0 ? l.rooms[c.room]! : null;
    let want = false;
    if (c.kind === 'corridor') want = (cx + cz) % 2 === 0 && rng.chance(0.85);
    else if (c.kind === 'stair') want = cz === room!.z;
    else if (room && (room.kind === 'room' || room.kind === 'hall')) want = (cx - room.x) % 2 === 0 && (cz - room.z) % 2 === 0;
    // decay > 0.8 = dead, > 0.35 = flickering. Skewed so most of the building flickers.
    if (want) out.push({ id: out.length, cx, cz, kind: 'ceiling', decay: Math.pow(rng.next(), 0.7) });
  });
  return out;
}

/** Dark, out-of-the-way cells for future entities: dead ends and far rooms. */
export function pickSpawnPoints(l: LevelData, rng: Rng, from: number): { x: number; z: number }[] {
  const dist = bfs(l.nav.adj, Math.max(0, from));
  const cands: number[] = [];
  l.cells.forEach((c, i) => {
    if (!isWalkable(c.kind) || c.kind === 'stair' || dist[i]! < 4) return;
    if (l.nav.adj[i]!.length === 1 || (c.kind === 'room' && rng.chance(0.15)) || (c.kind === 'hall' && rng.chance(0.1))) cands.push(i);
  });
  return rng
    .shuffle(cands)
    .slice(0, 12)
    .sort((a, b) => a - b)
    .map((i) => ({ x: i % l.width, z: Math.floor(i / l.width) }));
}
