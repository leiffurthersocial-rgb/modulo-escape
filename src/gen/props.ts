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
  blackboard: 0,
  pipe: 0.2,
  model: 0.2,
  lab_bench: 0,
  counter: 0,
  stage: 0,
  seat_row: 0,
  wall_bars: 0,
  hoop: 0,
  gym_mat: 0,
  wc_stall: 0,
  sink: 0,
  piano: 0,
  monitor: 0,
  shelf: 0,
  pinboard: 0,
};
export const SOLID_PROPS: ReadonlySet<PropType> = new Set(['barrel', 'collapsed_slab', 'chair', 'desk', 'classroom_desk']);
/** Uses that get the classroom layout (board, teacher's desk, rows of desks). */
const DESK_ROOMS = new Set(['classroom', 'informatik', 'musik', 'bg', 'chemie', 'physik', 'biologie']);

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
  // Classrooms: a front wall without doors carries the blackboard; the teacher's desk stands in
  // front of it and the student desks (with chairs) face it in rows, with aisles between the cells.
  const classroom = new Map<number, { front: Side; facing: number; teacher: string | null }>();
  const doorish = (e: EdgeKind) => e === 'door' || e === 'broken' || e === 'exit' || e === 'open';
  const FACING: Record<Side, number> = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };
  for (const r of l.rooms) {
    if (r.kind !== 'room' || r.w * r.h < 4 || !DESK_ROOMS.has(r.use ?? 'classroom') || !rng.chance(0.85)) continue;
    // Score each side: no doors first, then the longer wall (so rows run across the room).
    let best: { side: Side; score: number } | null = null;
    for (const side of ['N', 'E', 'S', 'W'] as Side[]) {
      const cells: [number, number][] = [];
      if (side === 'N' || side === 'S') for (let x = r.x; x < r.x + r.w; x++) cells.push([x, side === 'N' ? r.z : r.z + r.h - 1]);
      else for (let z = r.z; z < r.z + r.h; z++) cells.push([side === 'W' ? r.x : r.x + r.w - 1, z]);
      if (cells.some(([x, z]) => doorish(getEdge(l, x, z, side)))) continue;
      const score = cells.length * 10 + rng.next();
      if (!best || score > best.score) best = { side, score };
    }
    if (!best) continue;
    const front = best.side;
    classroom.set(r.id, { front, facing: FACING[front], teacher: null });
    // Blackboard centred on the front wall, just proud of its face.
    const cx = r.x + r.w / 2;
    const cz = r.z + r.h / 2;
    const S = l.cellSize;
    let bx: number;
    let bz: number;
    if (front === 'N' || front === 'S') {
      bx = cx * S;
      bz = (front === 'N' ? r.z : r.z + r.h) * S + (front === 'N' ? 0.17 : -0.17);
    } else {
      bz = cz * S;
      bx = (front === 'W' ? r.x : r.x + r.w) * S + (front === 'W' ? 0.17 : -0.17);
    }
    const bcx = Math.min(r.x + r.w - 1, Math.floor(bx / S - (front === 'E' ? 0.01 : 0)));
    const bcz = Math.min(r.z + r.h - 1, Math.floor(bz / S - (front === 'S' ? 0.01 : 0)));
    out.push({ type: 'blackboard', cx: bcx, cz: bcz, x: bx, z: bz, r: 0, rot: FACING[front], scale: 1, variant: 0, solid: false });
  }

  for (let cz = 0; cz < l.height; cz++) {
    for (let cx = 0; cx < l.width; cx++) {
      const i = cellIndex(l, cx, cz);
      const cell = l.cells[i]!;
      if (!isWalkable(cell.kind) || cell.kind === 'stair') continue;
      const roomKind = cell.room >= 0 ? l.rooms[cell.room]!.kind : null;
      const keepClear = i === startI || i === exitI || roomKind === 'landing';
      const edge = (side: Side) => getEdge(l, cx, cz, side);
      const cls = cell.kind === 'room' ? classroom.get(cell.room) : undefined;
      const room = cell.room >= 0 ? l.rooms[cell.room]! : null;
      const frontRow =
        cls && room
          ? (cls.front === 'N' && cz === room.z) || (cls.front === 'S' && cz === room.z + room.h - 1) || (cls.front === 'W' && cx === room.x) || (cls.front === 'E' && cx === room.x + room.w - 1)
          : false;

      for (const c of CORNERS) {
        const [a, b] = c.sides;
        const ea = edge(a);
        const eb = edge(b);
        const doorway = (e: EdgeKind) => e === 'door' || e === 'broken' || e === 'exit' || e === 'open';
        const walls = Number(isWallLike(ea)) + Number(isWallLike(eb));
        if (cls && !keepClear) {
          if (doorish(ea) && ea !== 'open') continue; // keep door swings clear
          if (doorish(eb) && eb !== 'open') continue;
          if (frontRow && (a === cls.front || b === cls.front)) {
            // Space in front of the board; one corner gets the teacher's desk, facing the class.
            const sideWall = a === cls.front ? isWallLike(eb) : isWallLike(ea);
            if (!cls.teacher && sideWall) {
              cls.teacher = `${cx},${cz}`;
              add('desk', cx, cz, c.u, c.v, cls.facing + Math.PI + rng.range(-0.05, 0.05));
            }
            continue;
          }
          // Student desk + chair, facing the board, slightly askew after years of neglect.
          if (rng.chance(0.9)) add('classroom_desk', cx, cz, c.u, c.v, cls.facing + rng.range(-0.1, 0.1));
          continue;
        }
        if (doorway(ea) && ea !== 'open') continue;
        if (doorway(eb) && eb !== 'open') continue;
        // Clean, empty spaces: corridors and halls stay bare.
        const roll = rng.next();
        const r2 = rng.next();
        if (keepClear || walls === 0) continue;
        void roll; // (was: rubble) — no loose clutter, only school furniture
        // Small rooms are offices / store rooms: a desk or stacked chairs against the walls.
        if (cell.kind === 'room' && room && room.w * room.h < 4 && r2 < 0.3) add(rng.chance(0.5) ? 'chair' : rng.chance(0.5) ? 'desk' : 'barrel', cx, cz, c.u, c.v);
        else if (cell.kind === 'room' && r2 < 0.08) add('chair', cx, cz, c.u, c.v);
      }

      // Mid-wall slots: old pipes along corridor walls.
      for (const m of MIDS) {
        if (edge(m.side) === 'solid' && cell.kind === 'corridor' && rng.chance(0.06)) add('pipe', cx, cz, m.u, m.v);
      }
    }
  }
  return out;
}

/** Fluorescent tubes: corridors every other cell, rooms and halls per cell group, stairwells. */
export function placeLights(l: LevelData, rng: Rng): LightSlot[] {
  const out: LightSlot[] = [];
  l.cells.forEach((c, i) => {
    const cx = i % l.width;
    const cz = Math.floor(i / l.width);
    const room = c.room >= 0 ? l.rooms[c.room]! : null;
    // Stairwells: one tube on the upper floor's ceiling above the mid landing (the stair cells
    // themselves have no ceiling — a tube there would float in mid-air).
    if (c.kind === 'shaft' && room && cz === room.z + 1 && cx === room.x) {
      out.push({ id: out.length, cx, cz, kind: 'ceiling', decay: rng.next() * 0.8 });
      return;
    }
    if (!isWalkable(c.kind) || c.kind === 'stair') return;
    let want = false;
    if (c.kind === 'corridor') want = (cx + cz) % 2 === 0 && rng.chance(0.85);
    else if (room && (room.kind === 'room' || room.kind === 'hall')) want = (cx - room.x) % 2 === 0 && (cz - room.z) % 2 === 0;
    // decay > 0.9 = dead (~10%), > 0.75 = flickering (~15%); the rest burn steadily.
    if (want) out.push({ id: out.length, cx, cz, kind: 'ceiling', decay: rng.next() });
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
