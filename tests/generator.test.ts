import { describe, expect, it } from 'vitest';
import { fnv1a, Rng, streamRng } from '../src/core/rng.ts';
import {
  bfs,
  buildNav,
  cellIndex,
  DIR,
  generateBuilding,
  getEdge,
  inBounds,
  isPassable,
  isWalkable,
  kitPieces,
  SIDES,
  SIZE_CONFIG,
  stairCells,
  type Building,
  type LevelData,
  type LevelSize,
} from '../src/gen/index.ts';

/** World-space footprint of a prop (box furniture: w × d turned by rot; others: r). */
function propBox(p: { x: number; z: number; r: number; rot: number; w?: number; d?: number }) {
  if (p.w !== undefined && p.d !== undefined) {
    const along = Math.abs(Math.cos(p.rot)) > 0.5;
    const hw = (along ? p.w : p.d) / 2;
    const hd = (along ? p.d : p.w) / 2;
    return { x0: p.x - hw, z0: p.z - hd, x1: p.x + hw, z1: p.z + hd };
  }
  return { x0: p.x - p.r, z0: p.z - p.r, x1: p.x + p.r, z1: p.z + p.r };
}

const SEEDS = Number(process.env.GEN_SEEDS ?? 1000);
const SIZES: LevelSize[] = ['small', 'medium', 'large'];
const seedList = (n: number, salt: string) => Array.from({ length: n }, (_, i) => `${salt}-${i}`);

/** Structural invariants of one floor. Returns a list of problems (empty = OK). */
function checkFloor(l: LevelData): string[] {
  const errs: string[] = [];
  const N = l.width * l.height;
  if (l.cells.length !== N) errs.push('cell count');
  if (l.edgesX.length !== (l.width + 1) * l.height) errs.push('edgesX length');
  if (l.edgesZ.length !== l.width * (l.height + 1)) errs.push('edgesZ length');

  // Rooms don't overlap and match cell ownership.
  const owner = new Array<number>(N).fill(-1);
  for (const r of l.rooms) {
    for (let z = r.z; z < r.z + r.h; z++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = cellIndex(l, x, z);
        if (owner[i] !== -1) errs.push(`rooms ${owner[i]} and ${r.id} overlap at ${x},${z}`);
        owner[i] = r.id;
        if (l.cells[i]!.room !== r.id) errs.push(`cell ${x},${z} not owned by room ${r.id}`);
      }
    }
  }

  // Edges are consistent with cells: walls only next to walkable cells; boundary never passable.
  for (let z = 0; z < l.height; z++) {
    for (let x = 0; x < l.width; x++) {
      const c = l.cells[cellIndex(l, x, z)]!;
      for (const s of SIDES) {
        const e = getEdge(l, x, z, s);
        const nx = x + DIR[s].dx;
        const nz = z + DIR[s].dz;
        const nCell = inBounds(l, nx, nz) ? l.cells[cellIndex(l, nx, nz)]! : null;
        const nWalk = !!nCell && isWalkable(nCell.kind);
        const walk = isWalkable(c.kind);
        if (e === 'window') errs.push(`window at ${x},${z},${s}`);
        if (c.kind === 'void' && !nWalk && e !== 'none' && nCell?.kind !== 'shaft') errs.push(`edge between voids at ${x},${z},${s}`);
        if (walk && e === 'none') errs.push(`missing edge at ${x},${z},${s}`);
        // Only exception: the shaft opening towards the upper landing.
        const shaftOpening = c.kind === 'shaft' || nCell?.kind === 'shaft';
        if (isPassable(e) && (!walk || !nWalk) && !shaftOpening) errs.push(`passable edge to outside at ${x},${z},${s}`);
      }
    }
  }

  // Every walkable cell of the floor is connected within the floor.
  const first = l.cells.findIndex((c) => isWalkable(c.kind));
  const d = bfs(l.nav.adj, first);
  l.cells.forEach((c, i) => {
    if (isWalkable(c.kind) && d[i]! < 0) errs.push(`cell ${i} unreachable on floor ${l.floor}`);
    if (isWalkable(c.kind) && c.ceiling === 'hole') errs.push('ceiling hole');
  });

  // Kit pieces occupy unique slots (no overlapping geometry).
  const slots = new Set<string>();
  for (const p of kitPieces(l)) {
    if (slots.has(p.slot)) errs.push(`slot ${p.slot} used twice`);
    slots.add(p.slot);
  }

  // Props: inside their cell, no overlaps, solid ones keep the cell centre and every open side's
  // entrance free. Wall-mounted things (y > 0), things standing on other props and the blackboard
  // have no floor footprint.
  const S = l.cellSize;
  const floorProps = l.props.map((p, i) => ({ p, i })).filter(({ p }) => p.type !== 'blackboard' && !(p.y && p.y > 0) && p.on === undefined);
  for (const { p, i } of floorProps) {
    const b = propBox(p);
    const ox = p.cx * S;
    const oz = p.cz * S;
    if (b.x0 < ox + 0.14 || b.z0 < oz + 0.14 || b.x1 > ox + S - 0.14 || b.z1 > oz + S - 0.14) errs.push(`prop ${i} (${p.model ?? p.type}) intersects wall`);
    if (!isWalkable(l.cells[cellIndex(l, p.cx, p.cz)]!.kind)) errs.push(`prop ${i} in void`);
    if (p.solid) {
      const lo = S / 2 - 0.6;
      const hi = S / 2 + 0.6;
      const hit = (x0: number, z0: number, x1: number, z1: number) => b.x0 - ox < x1 - 1e-6 && b.x1 - ox > x0 + 1e-6 && b.z0 - oz < z1 - 1e-6 && b.z1 - oz > z0 + 1e-6;
      const pass = (sd: 'N' | 'E' | 'S' | 'W') => isPassable(getEdge(l, p.cx, p.cz, sd)) || getEdge(l, p.cx, p.cz, sd) === 'exit';
      if (hit(lo, lo, hi, hi)) errs.push(`solid prop ${i} (${p.model ?? p.type}) blocks the cell centre`);
      if ((pass('N') && hit(lo, 0, hi, lo)) || (pass('S') && hit(lo, hi, hi, S)) || (pass('W') && hit(0, lo, lo, hi)) || (pass('E') && hit(hi, lo, S, hi)))
        errs.push(`solid prop ${i} (${p.model ?? p.type}) blocks an entrance`);
      if ((p.cx === l.start.x && p.cz === l.start.z) || (p.cx === l.exit.x && p.cz === l.exit.z)) errs.push(`solid prop ${i} in start/exit`);
    }
  }
  for (let a = 0; a < floorProps.length; a++) {
    const A = propBox(floorProps[a]!.p);
    for (let c = a + 1; c < floorProps.length; c++) {
      const B = propBox(floorProps[c]!.p);
      if (A.x0 < B.x1 - 1e-6 && A.x1 > B.x0 + 1e-6 && A.z0 < B.z1 - 1e-6 && A.z1 > B.z0 + 1e-6) errs.push(`props ${floorProps[a]!.i} and ${floorProps[c]!.i} overlap`);
    }
  }
  for (const { p } of floorProps) if (p.on !== undefined && !l.props[p.on]) errs.push('prop on a missing prop');
  for (const pl of l.pillars) {
    for (const { p } of floorProps) {
      const b = propBox(p);
      const dx = Math.max(b.x0 - pl.x * S, 0, pl.x * S - b.x1);
      const dz = Math.max(b.z0 - pl.z * S, 0, pl.z * S - b.z1);
      if (Math.hypot(dx, dz) < 0.4) errs.push('prop overlaps pillar');
    }
  }
  for (const p of l.props) if (p.on !== undefined && (p.on < 0 || p.on >= l.props.length)) errs.push('bad support index');
  return errs;
}

/** Building-level invariants: floors connected through stairs, start top, exit ground, min path. */
function check(b: Building): string[] {
  const errs = b.floors.flatMap((f) => checkFloor(f).map((e) => `f${f.floor}: ${e}`));
  const N = b.width * b.height;
  if (b.floors.length !== SIZE_CONFIG[b.size].floors) errs.push('floor count');
  if (b.start.floor < 0 || b.start.floor >= b.floors.length) errs.push('start floor out of range');
  if (b.exit.floor < 0 || b.exit.floor >= b.floors.length) errs.push('exit floor out of range');
  if (b.floors[b.exit.floor]!.exit.x !== b.exit.x) errs.push('exit not on its floor');
  const startNode = b.start.floor * N + cellIndex(b, b.start.x, b.start.z);
  const d = bfs(b.nav.adj, startNode);
  b.floors.forEach((f) =>
    f.cells.forEach((c, i) => {
      if (isWalkable(c.kind) && d[f.floor * N + i]! < 0) errs.push(`f${f.floor} cell ${i} unreachable from start`);
    }),
  );
  if (b.stats.pathLength < SIZE_CONFIG[b.size].minPath) errs.push('path too short');
  if (b.nav.distToExit[startNode] !== b.stats.pathLength) errs.push('distToExit mismatch');
  const f0 = b.floors[b.exit.floor]!;
  if (getEdge(f0, b.exit.x, b.exit.z, b.exit.side) !== 'exit') errs.push('exit edge missing');
  const ox = b.exit.x + DIR[b.exit.side].dx;
  const oz = b.exit.z + DIR[b.exit.side].dz;
  if (inBounds(f0, ox, oz) && f0.cells[cellIndex(f0, ox, oz)]!.kind !== 'void') errs.push('exit leads inside');
  const exits = b.floors.flatMap((f) => [...f.edgesX, ...f.edgesZ]).filter((e) => e === 'exit').length;
  if (exits !== 1) errs.push('exactly one exit');
  // U staircases line up: four stair cells below, an open stairwell above, landings at both ends,
  // and the way up goes landing → flight A → mid landing → flight B → upper landing.
  for (const s of b.stairs) {
    const lo = b.floors[s.lower]!;
    const up = b.floors[s.lower + 1]!;
    const c = stairCells(s);
    for (const q of [c.a, c.mid, c.mid2, c.b]) {
      if (lo.cells[cellIndex(lo, q.x, q.z)]!.kind !== 'stair') errs.push('stair cells');
      if (up.cells[cellIndex(up, q.x, q.z)]!.kind !== 'shaft') errs.push('shaft cells');
    }
    if (!isWalkable(lo.cells[cellIndex(lo, c.lowerLanding.x, c.lowerLanding.z)]!.kind)) errs.push('lower landing');
    if (!isWalkable(up.cells[cellIndex(up, c.upperLanding.x, c.upperLanding.z)]!.kind)) errs.push('upper landing');
    if (!isPassable(getEdge(lo, c.a.x, c.a.z, 'N'))) errs.push('stair entrance closed');
    if (!isPassable(getEdge(lo, c.a.x, c.a.z, 'S')) || !isPassable(getEdge(lo, c.mid.x, c.mid.z, s.turn === 1 ? 'E' : 'W')) || !isPassable(getEdge(lo, c.mid2.x, c.mid2.z, 'N')))
      errs.push('stair path closed');
    if (getEdge(lo, c.a.x, c.a.z, s.turn === 1 ? 'E' : 'W') !== 'solid') errs.push('no wall between the flights');
    if (getEdge(lo, c.b.x, c.b.z, 'N') !== 'solid') errs.push('flight B open at the top on the lower floor');
    if (!isPassable(getEdge(up, c.b.x, c.b.z, 'N'))) errs.push('stair exit closed');
  }
  return errs;
}

describe('rng', () => {
  it('is deterministic and in range', () => {
    const a = new Rng('x');
    const b = new Rng('x');
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('sub-streams are independent', () => {
    expect(streamRng('s', 'layout').next()).not.toBe(streamRng('s', 'props').next());
  });
  it('int covers the inclusive range', () => {
    const r = new Rng('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });
});

for (const size of SIZES) {
  describe(`generator: ${size}`, () => {
    it(`${SEEDS} seeds are solvable, connected and non-overlapping`, () => {
      const failures: string[] = [];
      let totalPath = 0;
      for (const seed of seedList(SEEDS, size)) {
        const l = generateBuilding(seed, size);
        const errs = check(l);
        if (errs.length) failures.push(`${seed}: ${errs.slice(0, 3).join('; ')}`);
        totalPath += l.stats.pathLength;
      }
      expect(failures.slice(0, 10)).toEqual([]);
      expect(totalPath / SEEDS).toBeGreaterThan(SIZE_CONFIG[size].minPath);
    });

    it('is deterministic (same seed → identical level)', () => {
      for (const seed of seedList(50, `det-${size}`)) {
        const a = generateBuilding(seed, size);
        const b = generateBuilding(seed, size);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    });

    it('different seeds give different levels', () => {
      const hashes = new Set(seedList(100, `uniq-${size}`).map((s) => fnv1a(JSON.stringify(generateBuilding(s, size).floors.map((f) => f.cells)))));
      expect(hashes.size).toBeGreaterThan(95);
    });

    it('has loops, dead ends and halls across seeds', () => {
      let loops = 0;
      let deadEnds = 0;
      let halls = 0;
      let stubs = 0;
      let floors = 0;
      let walkable = 0;
      for (const seed of seedList(100, `mix-${size}`)) {
        const b = generateBuilding(seed, size);
        const s = b.stats;
        loops += s.loops;
        deadEnds += s.deadEnds;
        halls += s.halls;
        for (const l of b.floors) {
          floors++;
          walkable += l.stats.walkable;
          const nav = buildNav(l);
          // Actual corridor tips that lead nowhere (landings are excluded: stairs continue there).
          stubs += l.cells.filter((c, i) => c.kind === 'corridor' && (c.room < 0 || l.rooms[c.room]?.kind !== 'landing') && nav.adj[i]!.length <= 1).length;
        }
      }
      // Gameplay: many loops to circle the monster, only a handful of deliberate spurs.
      expect(loops / floors).toBeGreaterThan(1);
      expect((stubs / walkable) * 100).toBeLessThanOrEqual(1.5);
      expect(deadEnds).toBeLessThanOrEqual(stubs + floors);
      if (size !== 'small') expect(halls).toBeGreaterThan(80);
      expect(generateBuilding(`stairs-${size}`, size).stairs.length).toBeGreaterThanOrEqual(SIZE_CONFIG[size].floors - 1);
    });
  });
}

describe('KZU naming and floors', () => {
  it('room numbers carry the floor (E, 1, 2, …); start on a random upper floor, the exit is always on the ground floor', () => {
    for (const size of SIZES) {
      const startFloors = new Set<number>();
      const exitFloors = new Set<number>();
      for (const seed of seedList(60, `kzu-${size}`)) {
        const b = generateBuilding(seed, size);
        startFloors.add(b.start.floor);
        exitFloors.add(b.exit.floor);
        for (const l of b.floors) {
          const prefix = l.floor === 0 ? 'E' : String(l.floor);
          const labels = l.rooms.filter((r) => r.kind === 'room').map((r) => r.label);
          expect(labels.every((x) => !!x && x.startsWith(prefix) && /^[E1-4]\d\d$/.test(x)), seed).toBe(true);
          expect(new Set(labels).size, seed).toBe(labels.length);
          expect(l.dressing.roomLabels.join('|')).not.toMatch(/C \d\./);
        }
      }
      expect(startFloors.size, size).toBe(SIZE_CONFIG[size].floors - 1);
      expect(startFloors.has(0), size).toBe(false);
      expect([...exitFloors], size).toEqual([0]);
    }
  });
});

describe('golden seeds', () => {
  // Locks layouts so later phases (props, materials, decals) can't silently change existing seeds.
  // Update deliberately with: GEN_UPDATE_GOLDEN=1 (prints new values).
  const golden: Record<string, string> = {
    'kzu:small': 'b95211a1',
    'kzu:medium': 'f14ecd6f',
    'abc123:large': '79bbcc93',
  };
  it('layout fingerprints are stable', () => {
    for (const key of Object.keys(golden)) {
      const [seed, size] = key.split(':') as [string, LevelSize];
      const b = generateBuilding(seed, size);
      const fp = fnv1a(JSON.stringify([b.floors.map((f) => [f.cells, f.edgesX, f.edgesZ]), b.stairs, b.start, b.exit]));
      if (!golden[key] || process.env.GEN_UPDATE_GOLDEN) {
        console.log(`golden ${key}: '${fp}'`);
        continue;
      }
      expect(fp, key).toBe(golden[key]);
    }
  });
});
