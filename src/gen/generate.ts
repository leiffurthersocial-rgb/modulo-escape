/**
 * Level generator. Pure: seed + size → LevelData. No three.js, no DOM.
 *
 * Steps
 *  1. place rooms and multi-cell halls (rejection sampling, 1-cell spacing)
 *  2. link rooms: MST over centre distances + extra edges for loops
 *  3. carve corridors per link with grid A* (reusing corridors is cheap → junctions)
 *  4. dead-end spurs
 *  5. assign edge kinds (wall / door / window / open / broken)
 *  6. start & exit by BFS diameter, exit gate on an outward wall; enforce min path
 *  7. props, lights, spawn points, nav graph (separate RNG sub-streams)
 * Any failed check retries with attempt+1, which keeps it deterministic.
 */
import { streamRng, type Rng } from '../core/rng.ts';
import { CELL_SIZE, MAX_ATTEMPTS, SIZE_CONFIG, STOREY_HEIGHT, type SizeConfig } from './config.ts';
import { DIR, OPPOSITE, SIDES, cellIndex, getEdge, inBounds, isPassable, setEdge } from './grid.ts';
import { buildNav, bfs } from './nav.ts';
import { placeProps, placeLights, pickSpawnPoints } from './props.ts';
import { dressLevel } from './dressing.ts';
import type { Cell, EdgeKind, LevelData, LevelSize, Room, Side } from './types.ts';

export class GenerationError extends Error {}

export function generateLevel(seed: string, size: LevelSize = 'medium'): LevelData {
  const cfg = SIZE_CONFIG[size];
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const level = tryGenerate(seed, size, cfg, attempt);
      if (level) return level;
    } catch (e) {
      if (!(e instanceof GenerationError)) throw e;
      lastErr = e;
    }
  }
  throw new Error(`generateLevel(${seed}, ${size}) failed after ${MAX_ATTEMPTS} attempts: ${String(lastErr)}`);
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

const edgeKey = (w: Work, x: number, z: number, side: Side) => {
  if (side === 'N') return `z:${z * w.width + x}`;
  if (side === 'S') return `z:${(z + 1) * w.width + x}`;
  if (side === 'W') return `x:${z * (w.width + 1) + x}`;
  return `x:${z * (w.width + 1) + x + 1}`;
};

function tryGenerate(seed: string, size: LevelSize, cfg: SizeConfig, attempt: number): LevelData | null {
  const rng = streamRng(seed, 'layout', attempt);
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

  placeRooms(w, cfg, rng);
  if (w.rooms.length < 3) throw new GenerationError('too few rooms');

  const links = linkRooms(w.rooms, cfg, rng);
  let loops = 0;
  for (const link of links) {
    const ok = carveCorridor(w, w.rooms[link.a]!, w.rooms[link.b]!, rng);
    if (!ok && link.mst) throw new GenerationError('mst corridor failed');
    if (ok && !link.mst) loops++;
  }
  const deadEnds = addDeadEnds(w, cfg, rng);
  assignEdges(w, rng);

  // Connectivity: every walkable cell reachable from the first walkable cell.
  const walkable: number[] = [];
  w.cells.forEach((c, i) => c.kind !== 'void' && walkable.push(i));
  const navTmp = buildNav(w);
  const d0 = bfs(navTmp.adj, walkable[0]!);
  if (walkable.some((i) => d0[i]! < 0)) throw new GenerationError('not connected');

  // Start = one end of the BFS diameter, exit = the far end with an outward-facing wall.
  const a = argmax(d0);
  const dA = bfs(navTmp.adj, a);
  const sortedFar = walkable.slice().sort((p, q) => dA[q]! - dA[p]! || p - q);
  let exit: { x: number; z: number; side: Side } | null = null;
  const topN = Math.max(3, Math.ceil(sortedFar.length * 0.1));
  for (const ci of sortedFar.slice(0, topN)) {
    const x = ci % width;
    const z = Math.floor(ci / width);
    const outward = SIDES.filter((s) => {
      const nx = x + DIR[s].dx;
      const nz = z + DIR[s].dz;
      const outside = !inBounds(w, nx, nz) || w.cells[cellIndex(w, nx, nz)]!.kind === 'void';
      return outside && getEdge(w, x, z, s) === 'solid';
    });
    if (outward.length) {
      exit = { x, z, side: rng.pick(outward) };
      break;
    }
  }
  if (!exit) throw new GenerationError('no exit wall');
  const pathLength = dA[cellIndex(w, exit.x, exit.z)]!;
  if (pathLength < cfg.minPath) throw new GenerationError(`path too short (${pathLength})`);
  setEdge(w, exit.x, exit.z, exit.side, 'exit');

  const sx = a % width;
  const sz = Math.floor(a / width);
  const facing = SIDES.find((s) => isPassable(getEdge(w, sx, sz, s))) ?? 'N';

  decorateCells(w, seed, attempt);

  const level: LevelData = {
    version: 1,
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
    start: { x: sx, z: sz, facing },
    exit,
    props: [],
    lights: [],
    spawnPoints: [],
    nav: { adj: [], distToExit: [] },
    dressing: { damp: [], decals: [], vines: [], roots: [], trees: [], shrubs: [], roomLabels: [] },
    stats: {
      attempts: attempt + 1,
      walkable: walkable.length,
      rooms: w.rooms.filter((r) => r.kind === 'room').length,
      halls: w.rooms.filter((r) => r.kind === 'hall').length,
      corridors: w.cells.filter((c) => c.kind === 'corridor').length,
      loops,
      deadEnds,
      pathLength,
    },
  };
  level.nav = buildNav(level, cellIndex(level, exit.x, exit.z));
  level.props = placeProps(level, streamRng(seed, 'props', attempt));
  level.lights = placeLights(level, streamRng(seed, 'lights', attempt));
  level.spawnPoints = pickSpawnPoints(level, streamRng(seed, 'spawns', attempt));
  level.dressing = dressLevel(level, attempt);
  return level;
}

function argmax(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i]! > arr[best]!) best = i;
  return best;
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
        rw = rng.int(3, Math.min(6, Math.floor(w.width / 3)));
        rh = rng.int(3, Math.min(5, Math.floor(w.height / 3)));
      } else {
        // Mostly small classrooms/offices, occasionally long rooms.
        rw = rng.pick([1, 2, 2, 2, 3, 3, 4]);
        rh = rng.pick([1, 2, 2, 3, 3]);
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
    const near = [...Array(n).keys()].filter((j) => j !== i).sort((p, q) => dist(i, p) - dist(i, q) || p - q).slice(0, 3);
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
    if (c.kind === 'room' || c.kind === 'hall') return Infinity;
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
        const aWalk = c.kind !== 'void';
        const bWalk = !!n && n.kind !== 'void';
        let kind: EdgeKind;
        if (!aWalk && !bWalk) kind = 'none';
        else if (aWalk !== bWalk) {
          const inner = aWalk ? c : n!;
          // Mostly enclosed: the game happens inside; windows are rare glimpses out.
          const p = inner.kind === 'corridor' ? 0.04 : inner.kind === 'hall' ? 0.16 : 0.12;
          kind = rng.chance(p) ? 'window' : 'solid';
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

function decorateCells(w: Work, seed: string, attempt: number) {
  const rng = streamRng(seed, 'cells', attempt);
  for (const c of w.cells) {
    if (c.kind === 'void') continue;
    const r = rng.next();
    c.floor = r < 0.12 ? 'puddle' : r < 0.3 ? 'cracked' : 'intact';
    c.ceiling = rng.chance(c.kind === 'hall' ? 0.15 : c.kind === 'room' ? 0.08 : 0.04) ? 'hole' : 'intact';
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
