/**
 * Building generator. Pure: seed + size → Building (several floors joined by stair flights).
 * No three.js, no DOM.
 *
 * Steps
 *  1. place stair flights between adjacent floors (spread apart so each floor must be crossed)
 *  2. per floor: reserve stair / shaft / landing cells, place classrooms and pillared halls,
 *     link rooms + landings (MST + loops), carve corridors with A*, dead-end spurs, assign walls/doors
 *  3. global nav graph (floors + stairs); start on the top floor far from the stairs down,
 *     exit gate on an outward ground-floor wall far along the path; enforce a minimum path
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
import { furnish } from './furnish.ts';
import type { Building, Cell, EdgeKind, LevelData, LevelSize, Room, Side, Stair } from './types.ts';

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

/** Cells a stair occupies on its lower and upper floor (including landings). */
function stairFootprint(s: Stair): { lower: Reservation[]; upper: Reservation[] } {
  return {
    lower: [
      { kind: 'landing', x: s.x, z: s.z - 1, w: 1, h: 1 },
      { kind: 'stair', x: s.x, z: s.z, w: 1, h: 2 },
    ],
    upper: [
      { kind: 'shaft', x: s.x, z: s.z, w: 1, h: 2 },
      { kind: 'landing', x: s.x, z: s.z + 2, w: 1, h: 1 },
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
        const s: Stair = { x: rng.int(1, cfg.width - 2), z: rng.int(2, cfg.height - 4), lower: f };
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
    const r = generateFloor(seed, cfg, f, res, attempt);
    works.push(r.w);
    stats.loops += r.loops;
    stats.deadEnds += r.deadEnds;
  }

  // ── global nav: floors + stair links (top of a flight ↔ upper landing) ──
  const localNav = works.map((w) => buildNav(w));
  const adj: number[][] = [];
  works.forEach((_, f) => localNav[f]!.adj.forEach((list, i) => (adj[f * N + i] = list.map((j) => f * N + j))));
  for (const s of stairs) {
    const top = s.lower * N + cellIndex(cfg, s.x, s.z + 1);
    const land = (s.lower + 1) * N + cellIndex(cfg, s.x, s.z + 2);
    adj[top]!.push(land);
    adj[land]!.push(top);
  }

  // ── start: top floor, far from where the stairs arrive ──
  const topF = cfg.floors - 1;
  const arrivals = stairs.filter((s) => s.lower + 1 === topF).map((s) => topF * N + cellIndex(cfg, s.x, s.z + 2));
  const fromArrival = arrivals.length ? bfsMulti(adj, arrivals) : bfs(adj, topF * N + firstWalkable(works[topF]!));
  let startNode = -1;
  for (let i = 0; i < N; i++) {
    const node = topF * N + i;
    const c = works[topF]!.cells[i]!;
    if (!isWalkable(c.kind) || c.kind === 'stair' || isLanding(works[topF]!, i)) continue;
    if (startNode < 0 || fromArrival[node]! > fromArrival[startNode]!) startNode = node;
  }
  if (startNode < 0) throw new GenerationError('no start');
  const dist = bfs(adj, startNode);
  for (let node = 0; node < adj.length; node++) {
    const f = Math.floor(node / N);
    if (isWalkable(works[f]!.cells[node % N]!.kind) && dist[node]! < 0) throw new GenerationError('building not connected');
  }

  // ── exit: ground floor, far along the path, on an outward wall ──
  const w0 = works[0]!;
  const ground = [...Array(N).keys()].filter((i) => w0.cells[i]!.kind !== 'void' && isWalkable(w0.cells[i]!.kind) && w0.cells[i]!.kind !== 'stair' && !isLanding(w0, i));
  ground.sort((p, q) => dist[q]! - dist[p]! || p - q);
  const exitRng = streamRng(seed, 'exit', attempt);
  let exit: Building['exit'] | null = null;
  for (const ci of ground.slice(0, Math.max(3, Math.ceil(ground.length * 0.12)))) {
    const x = ci % width;
    const z = Math.floor(ci / width);
    const outward = SIDES.filter((sd) => {
      const nx = x + DIR[sd].dx;
      const nz = z + DIR[sd].dz;
      const outside = !inBounds(w0, nx, nz) || w0.cells[cellIndex(w0, nx, nz)]!.kind === 'void';
      return outside && getEdge(w0, x, z, sd) === 'solid';
    });
    if (outward.length) {
      exit = { floor: 0, x, z, side: exitRng.pick(outward) };
      break;
    }
  }
  if (!exit) throw new GenerationError('no exit wall');
  const pathLength = dist[cellIndex(w0, exit.x, exit.z)]!;
  if (pathLength < cfg.minPath) throw new GenerationError(`path too short (${pathLength})`);
  setEdge(w0, exit.x, exit.z, exit.side, 'exit');
  const distToExit = bfs(adj, cellIndex(w0, exit.x, exit.z));

  const sCell = startNode % N;
  const sx = sCell % width;
  const sz = Math.floor(sCell / width);
  const facing = SIDES.find((sd) => isPassable(getEdge(works[topF]!, sx, sz, sd))) ?? 'N';
  const start = { floor: topF, x: sx, z: sz, facing };

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
      start: f === topF ? { x: sx, z: sz, facing } : { x: -1, z: -1, facing: 'N' },
      exit: f === 0 ? { x: exit.x, z: exit.z, side: exit.side } : { x: -1, z: -1, side: 'N' },
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
    level.wings = assignKzu(level, sub('kzu'));
    level.props = placeProps(level, sub('props'));
    furnish(level, level.props, sub('furnish'));
    level.lights = placeLights(level, sub('lights'));
    const anchor = f === topF ? cellIndex(level, sx, sz) : firstLanding(w);
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

function bfsMulti(adj: number[][], sources: number[]): number[] {
  const dist = new Array<number>(adj.length).fill(-1);
  const q = [...sources];
  for (const s of sources) dist[s] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!;
    for (const n of adj[c] ?? []) {
      if (dist[n] === -1) {
        dist[n] = dist[c]! + 1;
        q.push(n);
      }
    }
  }
  return dist;
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
function generateFloor(seed: string, cfg: SizeConfig, f: number, res: Reservation[], attempt: number): { w: Work; loops: number; deadEnds: number } {
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
  applyStairEdges(w);
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

/** Stairs are walled in except their entrance; shafts open only towards the upper landing. */
function applyStairEdges(w: Work) {
  for (const r of w.rooms) {
    if (r.kind === 'stair') {
      for (const zz of [r.z, r.z + 1]) {
        setEdge(w, r.x, zz, 'W', 'solid');
        setEdge(w, r.x, zz, 'E', 'solid');
      }
      setEdge(w, r.x, r.z, 'N', 'open');
      setEdge(w, r.x, r.z, 'S', 'open');
      setEdge(w, r.x, r.z + 1, 'S', 'solid');
    } else if (r.kind === 'shaft') {
      for (const zz of [r.z, r.z + 1]) {
        setEdge(w, r.x, zz, 'W', 'solid');
        setEdge(w, r.x, zz, 'E', 'solid');
      }
      setEdge(w, r.x, r.z, 'N', 'solid');
      setEdge(w, r.x, r.z, 'S', 'none');
      setEdge(w, r.x, r.z + 1, 'S', 'open');
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
