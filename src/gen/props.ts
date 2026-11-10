/**
 * Seeded prop, light and spawn-point placement.
 *
 * Passability rule: solid props only go into corner slots and stay outside the
 * "centre cross" of a cell (1.2 m bands through the centre on both axes), so every
 * passable side of a cell stays connected to every other one.
 */
import type { Rng } from '../core/rng.ts';
import { bfs } from './nav.ts';
import { cellIndex, getEdge } from './grid.ts';
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
  pipe: 0.2,
};
export const SOLID_PROPS: ReadonlySet<PropType> = new Set(['barrel', 'collapsed_slab', 'chair', 'desk']);

const isWallLike = (e: EdgeKind) => e === 'solid' || e === 'window';

export function placeProps(l: LevelData, rng: Rng): PropSlot[] {
  const out: PropSlot[] = [];
  const s = l.cellSize / 4; // slots are authored for 4 m cells
  const startI = cellIndex(l, l.start.x, l.start.z);
  const exitI = cellIndex(l, l.exit.x, l.exit.z);
  const add = (type: PropType, cx: number, cz: number, u: number, v: number) => {
    out.push({
      type,
      cx,
      cz,
      x: cx * l.cellSize + u * s,
      z: cz * l.cellSize + v * s,
      r: PROP_RADIUS[type],
      rot: rng.range(0, Math.PI * 2),
      scale: rng.range(0.85, 1.15),
      variant: rng.int(0, 3),
      solid: SOLID_PROPS.has(type),
    });
  };

  for (let cz = 0; cz < l.height; cz++) {
    for (let cx = 0; cx < l.width; cx++) {
      const i = cellIndex(l, cx, cz);
      const cell = l.cells[i]!;
      if (cell.kind === 'void') continue;
      const keepClear = i === startI || i === exitI;
      const edge = (side: Side) => getEdge(l, cx, cz, side);

      // Corners: debris loves corners; furniture in rooms; barrels anywhere.
      for (const c of CORNERS) {
        const [a, b] = c.sides;
        const ea = edge(a);
        const eb = edge(b);
        const doorway = (e: EdgeKind) => e === 'door' || e === 'broken' || e === 'exit';
        if (doorway(ea) || doorway(eb)) continue; // never crowd a doorway
        const walls = Number(isWallLike(ea)) + Number(isWallLike(eb));
        const roll = rng.next();
        const pDebris = walls === 2 ? 0.4 : walls === 1 ? 0.18 : 0.05;
        if (roll < pDebris) {
          add(rng.chance(0.5) ? 'rubble' : 'debris', cx, cz, c.u, c.v);
          continue;
        }
        if (keepClear || walls === 0) continue;
        const r2 = rng.next();
        if (cell.ceiling === 'hole' && r2 < 0.35) add('collapsed_slab', cx, cz, c.u, c.v);
        else if (cell.kind === 'room' && r2 < 0.25) add(rng.chance(0.6) ? 'chair' : 'desk', cx, cz, c.u, c.v);
        else if (r2 < 0.06) add('barrel', cx, cz, c.u, c.v);
      }

      // Mid-wall slots: vegetation at windows, pipes along corridor walls.
      for (const m of MIDS) {
        const e = edge(m.side);
        if (e === 'window' && rng.chance(0.55)) add('vegetation', cx, cz, m.u, m.v);
        else if (e === 'solid' && cell.kind === 'corridor' && rng.chance(0.12)) add('pipe', cx, cz, m.u, m.v);
      }

      // Centre: plants growing in the light under ceiling holes.
      if (cell.ceiling === 'hole' && rng.chance(0.7)) add('vegetation', cx, cz, 2, 2);
    }
  }
  return out;
}

export function placeLights(l: LevelData, rng: Rng): LightSlot[] {
  const out: LightSlot[] = [];
  for (const r of l.rooms) {
    out.push({ id: out.length, cx: r.x + Math.floor(r.w / 2), cz: r.z + Math.floor(r.h / 2), kind: 'ceiling', decay: rng.next() });
  }
  l.cells.forEach((c, i) => {
    const cx = i % l.width;
    const cz = Math.floor(i / l.width);
    if (c.kind === 'corridor' && (cx + cz) % 4 === 0 && rng.chance(0.5)) {
      out.push({ id: out.length, cx, cz, kind: 'ceiling', decay: rng.next() });
    }
    if (c.kind !== 'void' && c.ceiling === 'hole') out.push({ id: out.length, cx, cz, kind: 'sun_shaft', decay: 0 });
  });
  return out;
}

/** Dark, out-of-the-way cells for future entities: dead ends and far rooms. */
export function pickSpawnPoints(l: LevelData, rng: Rng): { x: number; z: number }[] {
  const fromStart = bfs(l.nav.adj, cellIndex(l, l.start.x, l.start.z));
  const cands: number[] = [];
  l.cells.forEach((c, i) => {
    if (c.kind === 'void' || fromStart[i]! < 6) return;
    if (l.nav.adj[i]!.length === 1 || (c.kind === 'room' && rng.chance(0.15))) cands.push(i);
  });
  return rng
    .shuffle(cands)
    .slice(0, 12)
    .sort((a, b) => a - b)
    .map((i) => ({ x: i % l.width, z: Math.floor(i / l.width) }));
}
