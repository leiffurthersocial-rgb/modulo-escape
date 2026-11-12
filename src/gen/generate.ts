/**
 * Building generator. Pure: seed + size → Building (several floors joined by stair flights).
 * No three.js, no DOM.
 *
 * Steps
 *  1. place stair flights between adjacent floors (spread apart so each floor must be crossed)
 *  2. per floor: reserve stair / shaft / landing cells, place classrooms and pillared halls,
 *     link rooms + landings (MST + loops), carve corridors with A*, dead-end spurs, assign walls/doors
 *  3. global nav graph (floors + stairs); start on a random upper floor, exit gate on the ground floor
 *     on an outward wall far along the path (over open air above the ground floor);
 *     enforce a minimum path
 *  4. per floor: props, lights, spawn points, dressing (separate RNG sub-streams)
 * Any failed check retries with attempt+1, which keeps it deterministic.
 */
import { streamRng, type Rng } from '../core/rng.ts';
import { CELL_SIZE, FLOOR_STEP, MAX_ATTEMPTS, SIZE_CONFIG, STOREY_HEIGHT, type SizeConfig } from './config.ts';
import { DIR, OPPOSITE, SIDES, cellIndex, getEdge, inBounds, isPassable, isWalkable, setEdge } from './grid.ts';
import { buildNav, bfs } from './nav.ts';
import { placeProps, placeLights, pickSpawnPoints } from './props.ts';
import { dressLevel } from './dressing.ts';
import { assignKzu } from './kzu.ts';
import { stairCells, type Building, type Cell, type EdgeKind, type LevelData, type LevelSize, type Room, type Side, type Stair } from './types.ts';

export class GenerationError extends Error {}

export function generateBuilding(seed: string, size: LevelSize = 'medium'): Building {
  const cfg = SIZE_CONFIG[size];
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return tryBuilding(seed, size, cfg, attempt);
    } catch (e) {
      if (!(e instanceof GenerationError)) throw e;
      lastErr = e;
    }
  }
  throw new Error(`generateBuilding(${seed}, ${size}) failed after ${MAX_ATTEMPTS} attempts: ${String(lastErr)}`);
}

interface Work {
  width: number;
  height: number;
  cells: Cell[];
  edgesX: EdgeKind[];
  edgesZ: EdgeKind[];
  rooms: Room[];
  /** Edges a corridor path actually walked through, keyed "axis:i". */
  traversed: Set<string>;
}

interface Reservation {
  kind: 'stair' | 'shaft' | 'landing';
  x: number;
  z: number;
  w: number;
  h: number;
}

const edgeKey = (w: Work, x: number, z: number, side: Side) => {
  if (side === 'N') return `z:${z * w.width + x}`;
  if (side === 'S') return `z:${(z + 1) * w.width + x}`;
  if (side === 'W') return `x:${z * (w.width + 1) + x}`;
  return `x:${z * (w.width + 1) + x + 1}`;
};

/** Cells a U staircase occupies on its lower and upper floor (including landings). */
function stairFootprint(s: Stair): { lower: Reservation[]; upper: Reservation[] } {
  const c = stairCells(s);
  return {
    lower: [
      { kind: 'landing', x: c.lowerLanding.x, z: c.lowerLanding.z, w: 1, h: 1 },
      { kind: 'stair', x: c.x0, z: s.z, w: 2, h: 2 },
    ],
    upper: [
      { kind: 'shaft', x: c.x0, z: s.z, w: 2, h: 2 },
      { kind: 'landing', x: c.upperLanding.x, z: c.upperLanding.z, w: 1, h: 1 },
    ],
  };
}

function placeStairs(cfg: SizeConfig, rng: Rng): Stair[] {
  const stairs: Stair[] = [];
  const reserved: Reservation[][] = Array.from({ length: cfg.floors }, () => []);
  const clash = (list: Reservation[], r: Reservation, margin: number) =>
    list.some((o) => r.x - margin < o.x + o.w && r.x + r.w + margin > o.x && r.z - margin < o.z + o.h && r.z + r.h + margin > o.z);
  for (let f = 0; f < cfg.floors - 1; f++) {
    const n = rng.int(cfg.stairsPerLevel[0], cfg.stairsPerLevel[1]);
    for (let k = 0; k < n; k++) {
      // Best of several candidates: far from every other stair touching these floors, so each
      // floor has to be crossed to reach the next flight.
      let best: Stair | null = null;
      let bestScore = -1;
      for (let t = 0; t < 40; t++) {
        const turn: 1 | -1 = rng.chance(0.5) ? 1 : -1;
        const s: Stair = { x: turn === 1 ? rng.int(1, cfg.width - 3) : rng.int(2, cfg.width - 2), z: rng.int(2, cfg.height - 3), lower: f, turn };
        const fp = stairFootprint(s);
        if (fp.lower.some((r) => clash(reserved[f]!, r, 2)) || fp.upper.some((r) => clash(reserved[f + 1]!, r, 2))) continue;
        const others = stairs.filter((o) => Math.abs(o.lower - f) <= 1);
        const score = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z))) : rng.next();
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (!best) throw new GenerationError('no room for stairs');
      stairs.push(best);
      const fp = stairFootprint(best);
      reserved[f]!.push(...fp.lower);
      reserved[f + 1]!.push(...fp.upper);
    }
  }
  return stairs;
}

function tryBuilding(seed: string, size: LevelSize, cfg: SizeConfig, attempt: number): Building {
  const { width, height } = cfg;
  const N = width * height;
  const stairs = placeStairs(cfg, streamRng(seed, 'stairs', attempt));

  // ── per-floor layouts ──
  const works: Work[] = [];
  const stats = { loops: 0, deadEnds: 0 };
  for (let f = 0; f < cfg.floors; f++) {
    const res: Reservation[] = [];
    for (const s of stairs) {
      const fp = stairFootprint(s);
      if (s.lower === f) res.push(...fp.lower);
      if (s.lower + 1 === f) res.push(...fp.upper);
    }
    const r = generateFloor(seed, cfg, f, res, attempt, stairs);
    works.push(r.w);
    stats.loops += r.loops;
    stats.deadEnds += r.deadEnds;
  }

  // ── global nav: floors + stair links (top of a flight ↔ upper landing) ──
  const localNav = works.map((w) => buildNav(w));
  const adj: number[][] = [];
  works.forEach((_, f) => localNav[f]!.adj.forEach((list, i) => (adj[f * N + i] = list.map((j) => f * N + j))));
  for (const s of stairs) {
    const c = stairCells(s);
    const top = s.lower * N + cellIndex(cfg, c.b.x, c.b.z);
    const land = (s.lower + 1) * N + cellIndex(cfg, c.upperLanding.x, c.upperLanding.z);
    adj[top]!.push(land);
    adj[land]!.push(top);
  }

  // ── start on a random upper floor; the exit always on the ground floor, far along the path
  // (you have to find your way down) ──
  const pick = streamRng(seed, 'startexit', attempt);
  const startF = pick.int(1, cfg.floors - 1);
  const exitF = 0;
  const free = (f: number, i: number) => {
    const c = works[f]!.cells[i]!;
    return isWalkable(c.kind) && c.kind !== 'stair' && !isLanding(works[f]!, i);
  };
  const starts = [...Array(N).keys()].filter((i) => free(startF, i));
  if (!starts.length) throw new GenerationError('no start');
  const startNode = startF * N + pick.pick(starts);
  const dist = bfs(adj, startNode);
  for (let node = 0; node < adj.length; node++) {
    const f = Math.floor(node / N);
    if (isWalkable(works[f]!.cells[node % N]!.kind) && dist[node]! < 0) throw new GenerationError('building not connected');
  }

  // Exit: an outward wall (out of the building, or over open air on upper floors) on its floor.
  const wE = works[exitF]!;
  const outward = (i: number) => {
    const x = i % width;
    const z = Math.floor(i / width);
    return SIDES.filter((sd) => {
      const nx = x + DIR[sd].dx;
      const nz = z + DIR[sd].dz;
      const outside = !inBounds(wE, nx, nz) || wE.cells[cellIndex(wE, nx, nz)]!.kind === 'void';
      return outside && getEdge(wE, x, z, sd) === 'solid';
    });
  };
  const exitCands = [...Array(N).keys()].filter((i) => free(exitF, i) && outward(i).length > 0);
  exitCands.sort((p, q) => dist[exitF * N + q]! - dist[exitF * N + p]! || p - q);
  const exitRng = streamRng(seed, 'exit', attempt);
  const top = exitCands.slice(0, Math.max(3, Math.ceil(exitCands.length * 0.15)));
  if (!top.length) throw new GenerationError('no exit wall');
  const ei = exitRng.pick(top);
  const exit: Building['exit'] = { floor: exitF, x: ei % width, z: Math.floor(ei / width), side: exitRng.pick(outward(ei)) };
  const pathLength = dist[exitF * N + ei]!;
  if (pathLength < cfg.minPath) throw new GenerationError(`path too short (${pathLength})`);
  setEdge(wE, exit.x, exit.z, exit.side, 'exit');
  const distToExit = bfs(adj, exitF * N + ei);

  const sCell = startNode % N;
  const sx = sCell % width;
  const sz = Math.floor(sCell / width);
  const facing = SIDES.find((sd) => isPassable(getEdge(works[startF]!, sx, sz, sd))) ?? 'N';
  const start = { floor: startF, x: sx, z: sz, facing };

  // ── finish each floor ──
  const floors: LevelData[] = works.map((w, f) => {
    decorateCells(w, seed, f, attempt);
    const level: LevelData = {
      version: 2,
      floor: f,
      elevation: f * FLOOR_STEP,
      seed,
      size,
      width,
      height,
      cellSize: CELL_SIZE,
      storeyHeight: STOREY_HEIGHT,
      cells: w.cells,
      edgesX: w.edgesX,
      edgesZ: w.edgesZ,
      rooms: w.rooms,
      pillars: hallPillars(w),
      start: f === startF ? { x: sx, z: sz, facing } : { x: -1, z: -1, facing: 'N' },
      exit: f === exitF ? { x: exit.x, z: exit.z, side: exit.side } : { x: -1, z: -1, side: 'N' },
      props: [],
      lights: [],
      spawnPoints: [],
      nav: { adj: localNav[f]!.adj, distToExit: distToExit.slice(f * N, (f + 1) * N) },
      dressing: { damp: [], decals: [], vines: [], roots: [], trees: [], shrubs: [], roomLabels: [] },
      stats: {
        attempts: attempt + 1,
        walkable: w.cells.filter((c) => isWalkable(c.kind)).length,
        rooms: w.rooms.filter((r) => r.kind === 'room').length,
        halls: w.rooms.filter((r) => r.kind === 'hall').length,
        corridors: w.cells.filter((c) => c.kind === 'corridor').length,
        loops: 0,
        deadEnds: 0,
        pathLength,
      },
    };
    const sub = (name: string) => streamRng(seed, `${name}:${f}`, attempt);
    assignKzu(level);
    level.props = placeProps(level, sub('props'));
    level.lights = placeLights(level, sub('lights'));
    const anchor = f === startF ? cellIndex(level, sx, sz) : firstLanding(w);
    level.spawnPoints = pickSpawnPoints(level, sub('spawns'), anchor);
    level.dressing = dressLevel(level, attempt);
    return level;
  });

  return {
    version: 2,
    seed,
    size,
    width,
    height,
    cellSize: CELL_SIZE,
    storeyHeight: STOREY_HEIGHT,
    floorStep: FLOOR_STEP,
    floors,
    stairs,
    start,
    exit,
    nav: { adj, distToExit },
    stats: {
      attempts: attempt + 1,
      floors: cfg.floors,
      stairs: stairs.length,
      walkable: floors.reduce((s2, l) => s2 + l.stats.walkable, 0),
      rooms: floors.reduce((s2, l) => s2 + l.stats.rooms, 0),
      halls: floors.reduce((s2, l) => s2 + l.stats.halls, 0),
      loops: stats.loops,
      deadEnds: stats.deadEnds,
      pathLength,
    },
  };
}

function firstWalkable(w: Work): number {
  return w.cells.findIndex((c) => isWalkable(c.kind));
}

function isLanding(w: Work, i: number): boolean {
  const c = w.cells[i]!;
  return c.room >= 0 && w.rooms[c.room]?.kind === 'landing';
}

function firstLanding(w: Work): number {
  const r = w.rooms.find((x) => x.kind === 'landing');
  return r ? cellIndex(w, r.x, r.z) : firstWalkable(w);
}

/** One storey: reservations first, then rooms, corridors, dead ends and edges. */
function generateFloor(seed: string, cfg: SizeConfig, f: number, res: Reservation[], attempt: number, stairs: Stair[]): { w: Work; loops: number; deadEnds: number } {
  const rng = streamRng(seed, `layout:${f}`, attempt);
  const { width, height } = cfg;
  const w: Work = {
    width,
    height,
    cells: Array.from({ length: width * height }, () => ({ kind: 'void', room: -1, floor: 'intact', ceiling: 'intact' }) as Cell),
    edgesX: new Array<EdgeKind>((width + 1) * height).fill('none'),
    edgesZ: new Array<EdgeKind>(width * (height + 1)).fill('none'),
    rooms: [],
    traversed: new Set(),
  };
  for (const r of res) {
    const room: Room = { id: w.rooms.length, x: r.x, z: r.z, w: r.w, h: r.h, kind: r.kind };
    w.rooms.push(room);
    for (let zz = r.z; zz < r.z + r.h; zz++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        const c = w.cells[cellIndex(w, xx, zz)]!;
        c.kind = r.kind === 'landing' ? 'corridor' : r.kind;
        c.room = room.id;
      }
    }
  }
  placeRooms(w, cfg, rng);
  const linkable = w.rooms.filter((r) => r.kind === 'room' || r.kind === 'hall' || r.kind === 'landing');
  if (linkable.filter((r) => r.kind !== 'landing').length < 3) throw new GenerationError('too few rooms');
  const links = linkRooms(linkable, cfg, rng);
  let loops = 0;
  for (const link of links) {
    const ok = carveCorridor(w, linkable[link.a]!, linkable[link.b]!, rng);
    if (!ok && link.mst) throw new GenerationError('mst corridor failed');
    if (ok && !link.mst) loops++;
  }
  const deadEnds = addDeadEnds(w, cfg, rng);
  assignEdges(w, rng);
  // Gameplay: prune corridor stubs that lead nowhere (keeping the few deliberate spurs), then give
  // bigger rooms a second door so they become shortcuts rather than traps.
  pruneStubs(w, deadEnds > 0 ? deadEnds : 0, rng);
  assignEdges(w, rng);
  secondDoors(w, rng);
  applyStairEdges(w, stairs, f);
  const nav = buildNav(w);
  const first = firstWalkable(w);
  const d0 = bfs(nav.adj, first);
  if (w.cells.some((c, i) => isWalkable(c.kind) && d0[i]! < 0)) throw new GenerationError(`floor ${f} not connected`);
  return { w, loops, deadEnds };
}

/** Remove corridor cells that lead nowhere (degree ≤ 1), repeatedly, except `keep` random spurs. */
function pruneStubs(w: Work, keep: number, rng: Rng) {
  const protectedCells = new Set<number>();
  for (;;) {
    const nav = buildNav(w);
    const stubs = w.cells
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.kind === 'corridor' && (c.room < 0 || w.rooms[c.room]?.kind !== 'landing') && nav.adj[i]!.length <= 1 && !protectedCells.has(i));
    if (!stubs.length) return;
    if (keep > 0 && protectedCells.size === 0) {
      // Keep a couple of tips as deliberate dead ends (hiding spots), protect the whole spur.
      for (const s of rng.shuffle(stubs.slice()).slice(0, keep)) {
        let cur = s.i;
        for (let k = 0; k < 6; k++) {
          protectedCells.add(cur);
          const next = nav.adj[cur]!.find((n) => !protectedCells.has(n) && w.cells[n]!.kind === 'corridor' && nav.adj[n]!.length <= 2);
          if (next === undefined) break;
          cur = next;
        }
      }
      continue;
    }
    for (const { c } of stubs) {
      c.kind = 'void';
      c.room = -1;
    }
    // Re-derive the edges of the shrunken corridor network.
    for (let i = 0; i < w.edgesX.length; i++) w.edgesX[i] = 'none';
    for (let i = 0; i < w.edgesZ.length; i++) w.edgesZ[i] = 'none';
    assignEdges(w, rng);
  }
}

/** Rooms of 2+ cells with a single door get a second one on another wall cell facing a corridor. */
function secondDoors(w: Work, rng: Rng) {
  for (const r of w.rooms) {
    if ((r.kind !== 'room' && r.kind !== 'hall') || r.w * r.h < 2) continue;
    const doors: { x: number; z: number; s: Side }[] = [];
    const cands: { x: number; z: number; s: Side }[] = [];
    for (let z = r.z; z < r.z + r.h; z++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        for (const s of SIDES) {
          const nx = x + DIR[s].dx;
          const nz = z + DIR[s].dz;
          if (!inBounds(w, nx, nz)) continue;
          const n = w.cells[cellIndex(w, nx, nz)]!;
          if (n.room === r.id || n.kind !== 'corridor' || (n.room >= 0 && w.rooms[n.room]?.kind === 'landing')) continue;
          const e = getEdge(w, x, z, s);
          if (e === 'door' || e === 'broken') doors.push({ x, z, s });
          else if (e === 'solid') cands.push({ x, z, s });
        }
      }
    }
    if (doors.length !== 1) continue;
    // Prefer the candidate farthest from the existing door (front + back door).
    const d0 = doors[0]!;
    const best = cands.sort((a, b) => Math.hypot(b.x - d0.x, b.z - d0.z) - Math.hypot(a.x - d0.x, a.z - d0.z))[0];
    if (best && Math.hypot(best.x - d0.x, best.z - d0.z) >= 1 && rng.chance(0.9)) setEdge(w, best.x, best.z, best.s, 'door');
  }
}

/**
 * U staircases are walled in. Lower floor: in from the lower landing to flight A, across the mid
 * landing and back down the other side into flight B (a wall between the two flights; flight B's
 * top end is a wall: you leave it upstairs). Upper floor: the 2 × 2 cells are one open stairwell,
 * open only towards the upper landing.
 */
function applyStairEdges(w: Work, stairs: Stair[], f: number) {
  const towards = (from: { x: number; z: number }, to: { x: number; z: number }): Side =>
    to.x > from.x ? 'E' : to.x < from.x ? 'W' : to.z > from.z ? 'S' : 'N';
  for (const s of stairs) {
    const c = stairCells(s);
    const cells = [c.a, c.mid, c.mid2, c.b];
    if (s.lower !== f && s.lower + 1 !== f) continue;
    for (const q of cells) for (const sd of SIDES) setEdge(w, q.x, q.z, sd, 'solid');
    const link = (p: { x: number; z: number }, q: { x: number; z: number }, kind: EdgeKind) => setEdge(w, p.x, p.z, towards(p, q), kind);
    if (s.lower === f) {
      link(c.a, c.lowerLanding, 'open');
      link(c.a, c.mid, 'open');
      link(c.mid, c.mid2, 'open');
      link(c.mid2, c.b, 'open');
    } else {
      link(c.a, c.mid, 'none');
      link(c.mid, c.mid2, 'none');
      link(c.mid2, c.b, 'none');
      link(c.a, c.b, 'none');
      link(c.b, c.upperLanding, 'open');
    }
  }
}

// ───────────────────────── 1. rooms ─────────────────────────

function placeRooms(w: Work, cfg: SizeConfig, rng: Rng) {
  const halls = rng.int(cfg.halls[0], cfg.halls[1]);
  const rooms = rng.int(cfg.rooms[0], cfg.rooms[1]);
  const want: ('hall' | 'room')[] = [...Array<'hall'>(halls).fill('hall'), ...Array<'room'>(rooms).fill('room')];
  for (const kind of want) {
    for (let tries = 0; tries < 60; tries++) {
      let rw: number;
      let rh: number;
      if (kind === 'hall') {
        // Landmark halls: Mensa, Aula, Turnhalle… 16–32 m across.
        rw = rng.int(4, Math.min(8, Math.floor(w.width / 3)));
        rh = rng.int(4, Math.min(6, Math.floor(w.height / 3)));
      } else {
        // Classrooms are 8×8 m to 12×12 m (2–3 cells); some small store rooms / offices.
        const small = rng.chance(0.25);
        rw = small ? rng.pick([1, 1, 2]) : rng.pick([2, 2, 3]);
        rh = small ? rng.pick([1, 2]) : rng.pick([2, 3, 3]);
      }
      if (rng.chance(0.5)) [rw, rh] = [rh, rw];
      const x = rng.int(0, w.width - rw);
      const z = rng.int(0, w.height - rh);
      // Keep at least one void cell between rooms so corridors can always reach them.
      const clash = w.rooms.some((r) => x - 1 < r.x + r.w && x + rw + 1 > r.x && z - 1 < r.z + r.h && z + rh + 1 > r.z);
      if (clash) continue;
      const room: Room = { id: w.rooms.length, x, z, w: rw, h: rh, kind };
      w.rooms.push(room);
      for (let zz = z; zz < z + rh; zz++) {
        for (let xx = x; xx < x + rw; xx++) {
          const c = w.cells[cellIndex(w, xx, zz)]!;
          c.kind = kind;
          c.room = room.id;
        }
      }
      break;
    }
  }
}

// ───────────────────────── 2. links ─────────────────────────

interface Link {
  a: number;
  b: number;
  mst: boolean;
}

function linkRooms(rooms: Room[], cfg: SizeConfig, rng: Rng): Link[] {
  const n = rooms.length;
  const cx = (r: Room) => r.x + r.w / 2;
  const cz = (r: Room) => r.z + r.h / 2;
  const dist = (i: number, j: number) => {
    const p = rooms[i]!;
    const q = rooms[j]!;
    return Math.abs(cx(p) - cx(q)) + Math.abs(cz(p) - cz(q));
  };
  // Prim's MST.
  const inTree = new Array<boolean>(n).fill(false);
  inTree[0] = true;
  const links: Link[] = [];
  const has = new Set<string>();
  for (let k = 1; k < n; k++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        const d = dist(i, j);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    if (!best) break;
    inTree[best[1]] = true;
    links.push({ a: best[0], b: best[1], mst: true });
    has.add(`${Math.min(...best)}-${Math.max(...best)}`);
  }
  // Loops: for each room, consider its 3 nearest neighbours.
  for (let i = 0; i < n; i++) {
    const near = [...Array(n).keys()].filter((j) => j !== i).sort((p, q) => dist(i, p) - dist(i, q) || p - q).slice(0, 4);
    for (const j of near) {
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      if (has.has(key)) continue;
      if (rng.chance(cfg.loopChance)) {
        has.add(key);
        links.push({ a: i, b: j, mst: false });
      }
    }
  }
  return links;
}

// ───────────────────────── 3. corridors (A*) ─────────────────────────

function carveCorridor(w: Work, from: Room, to: Room, rng: Rng): boolean {
  const N = w.width * w.height;
  const inRoom = (ci: number, r: Room) => w.cells[ci]!.room === r.id;
  const cost = (ci: number): number => {
    const c = w.cells[ci]!;
    if (c.room === from.id || c.room === to.id) return 0.2;
    if (c.kind === 'room' || c.kind === 'hall' || c.kind === 'stair' || c.kind === 'shaft') return Infinity;
    if (c.kind === 'corridor') return 0.6; // reuse → junctions
    return 1 + rng.next() * 0.3; // jitter gives less robotic corridors
  };
  const tx = to.x + to.w / 2;
  const tz = to.z + to.h / 2;
  const hfn = (ci: number) => Math.abs((ci % w.width) + 0.5 - tx) * 0.2 + Math.abs(Math.floor(ci / w.width) + 0.5 - tz) * 0.2;

  const g = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new MinHeap();
  // Seed with every cell of the source room.
  const cellCost = new Float64Array(N);
  for (let i = 0; i < N; i++) cellCost[i] = cost(i);
  for (let zz = from.z; zz < from.z + from.h; zz++) {
    for (let xx = from.x; xx < from.x + from.w; xx++) {
      const ci = cellIndex(w, xx, zz);
      g[ci] = 0;
      heap.push(ci, hfn(ci));
    }
  }
  let goal = -1;
  const closed = new Uint8Array(N);
  while (heap.size) {
    const ci = heap.pop();
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (inRoom(ci, to)) {
      goal = ci;
      break;
    }
    const x = ci % w.width;
    const z = Math.floor(ci / w.width);
    for (const s of SIDES) {
      const nx = x + DIR[s].dx;
      const nz = z + DIR[s].dz;
      if (!inBounds(w, nx, nz)) continue;
      const ni = cellIndex(w, nx, nz);
      const c = cellCost[ni]!;
      if (c === Infinity) continue;
      // Turning penalty keeps corridors straight-ish.
      const p = prev[ci]!;
      const turned = p >= 0 && (p % w.width !== x) !== (x !== nx);
      const ng = g[ci]! + c + (turned ? 0.35 : 0);
      if (ng < g[ni]!) {
        g[ni] = ng;
        prev[ni] = ci;
        heap.push(ni, ng + hfn(ni));
      }
    }
  }
  if (goal < 0) return false;
  // Walk back, carving corridor cells and recording traversed edges.
  let ci = goal;
  while (prev[ci]! >= 0) {
    const p = prev[ci]!;
    const c = w.cells[ci]!;
    if (c.kind === 'void') c.kind = 'corridor';
    const pc = w.cells[p]!;
    if (pc.kind === 'void') pc.kind = 'corridor';
    const px = p % w.width;
    const pz = Math.floor(p / w.width);
    const x = ci % w.width;
    const z = Math.floor(ci / w.width);
    const side = SIDES.find((s) => px + DIR[s].dx === x && pz + DIR[s].dz === z)!;
    w.traversed.add(edgeKey(w, px, pz, side));
    ci = p;
  }
  return true;
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastI;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}

// ───────────────────────── 4. dead ends ─────────────────────────

function addDeadEnds(w: Work, cfg: SizeConfig, rng: Rng): number {
  const want = rng.int(cfg.deadEnds[0], cfg.deadEnds[1]);
  let made = 0;
  for (let tries = 0; tries < want * 12 && made < want; tries++) {
    const corridors: number[] = [];
    w.cells.forEach((c, i) => c.kind === 'corridor' && corridors.push(i));
    if (!corridors.length) return made;
    const start = rng.pick(corridors);
    let x = start % w.width;
    let z = Math.floor(start / w.width);
    const side = rng.pick(SIDES);
    const len = rng.int(2, 4);
    const path: [number, number][] = [];
    let ok = true;
    for (let k = 0; k < len; k++) {
      const nx = x + DIR[side].dx;
      const nz = z + DIR[side].dz;
      if (!inBounds(w, nx, nz) || w.cells[cellIndex(w, nx, nz)]!.kind !== 'void') {
        ok = k >= 2;
        break;
      }
      // Don't run alongside other walkable cells (would just make a wide corridor).
      const touches = SIDES.some((s) => {
        if (s === OPPOSITE[side]) return false;
        const ax = nx + DIR[s].dx;
        const az = nz + DIR[s].dz;
        return inBounds(w, ax, az) && w.cells[cellIndex(w, ax, az)]!.kind !== 'void';
      });
      if (touches) {
        ok = k >= 2;
        break;
      }
      path.push([nx, nz]);
      x = nx;
      z = nz;
    }
    if (!ok || path.length < 2) continue;
    let px = start % w.width;
    let pz = Math.floor(start / w.width);
    for (const [cx, cz] of path) {
      w.cells[cellIndex(w, cx, cz)]!.kind = 'corridor';
      w.traversed.add(edgeKey(w, px, pz, side));
      px = cx;
      pz = cz;
    }
    made++;
  }
  return made;
}

// ───────────────────────── 5. edges ─────────────────────────

function assignEdges(w: Work, rng: Rng) {
  for (let z = 0; z < w.height; z++) {
    for (let x = 0; x < w.width; x++) {
      const c = w.cells[cellIndex(w, x, z)]!;
      // Each cell owns its N and W edges, plus E/S on the grid boundary.
      const sides: Side[] = ['N', 'W'];
      if (x === w.width - 1) sides.push('E');
      if (z === w.height - 1) sides.push('S');
      for (const s of sides) {
        const nx = x + DIR[s].dx;
        const nz = z + DIR[s].dz;
        const n = inBounds(w, nx, nz) ? w.cells[cellIndex(w, nx, nz)]! : null;
        const aWalk = isWalkable(c.kind);
        const bWalk = !!n && isWalkable(n.kind);
        let kind: EdgeKind;
        if (!aWalk && !bWalk) kind = 'none';
        else if (aWalk !== bWalk) {
          // Fully enclosed: no windows (the only way out is the exit gate).
          kind = 'solid';
        } else {
          const nn = n!;
          const walked = w.traversed.has(edgeKey(w, x, z, s));
          const sameRoom = c.room >= 0 && c.room === nn.room;
          if (sameRoom) kind = 'open';
          else if (c.kind === 'corridor' && nn.kind === 'corridor') kind = walked || rng.chance(0.55) ? 'open' : 'solid';
          else if (walked) kind = 'door';
          else kind = rng.chance(0.08) ? 'broken' : 'solid';
        }
        setEdge(w, x, z, s, kind);
      }
    }
  }
}

// ───────────────────────── decoration ─────────────────────────

function decorateCells(w: Work, seed: string, f: number, attempt: number) {
  const rng = streamRng(seed, `cells:${f}`, attempt);
  for (const c of w.cells) {
    if (c.kind === 'void') continue;
    if (c.kind === 'shaft') {
      c.floor = 'none';
      continue;
    }
    if (c.kind === 'stair') {
      c.ceiling = 'none';
      continue;
    }
    const r = rng.next();
    c.floor = r < 0.1 ? 'puddle' : r < 0.28 ? 'cracked' : 'intact';
    c.ceiling = 'intact';
  }
}

function hallPillars(w: Work): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const r of w.rooms) {
    if (r.kind !== 'hall') continue;
    // Interior grid vertices at every second line: halls read as pillar grids.
    for (let vz = r.z + 2; vz < r.z + r.h; vz += 2) {
      for (let vx = r.x + 2; vx < r.x + r.w; vx += 2) out.push({ x: vx, z: vz });
    }
  }
  return out;
}

export { getEdge, isPassable };
