import { describe, expect, it } from 'vitest';
import { fnv1a, Rng, streamRng } from '../src/core/rng.ts';
import {
  bfs,
  cellIndex,
  DIR,
  generateLevel,
  getEdge,
  inBounds,
  isPassable,
  kitPieces,
  SIDES,
  SIZE_CONFIG,
  type LevelData,
  type LevelSize,
} from '../src/gen/index.ts';

const SEEDS = Number(process.env.GEN_SEEDS ?? 1000);
const SIZES: LevelSize[] = ['small', 'medium', 'large'];
const seedList = (n: number, salt: string) => Array.from({ length: n }, (_, i) => `${salt}-${i}`);

/** All structural invariants for one level. Returns a list of problems (empty = OK). */
function check(l: LevelData): string[] {
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
        const nWalk = inBounds(l, nx, nz) && l.cells[cellIndex(l, nx, nz)]!.kind !== 'void';
        if (c.kind === 'void' && !nWalk && e !== 'none') errs.push(`edge between voids at ${x},${z},${s}`);
        if (c.kind !== 'void' && e === 'none') errs.push(`missing edge at ${x},${z},${s}`);
        if (isPassable(e) && (c.kind === 'void' || !nWalk)) errs.push(`passable edge to outside at ${x},${z},${s}`);
      }
    }
  }

  // Solvable + connected: every walkable cell reaches the exit.
  const exitI = cellIndex(l, l.exit.x, l.exit.z);
  const startI = cellIndex(l, l.start.x, l.start.z);
  const d = bfs(l.nav.adj, startI);
  if (d[exitI]! < 0) errs.push('exit unreachable');
  l.cells.forEach((c, i) => {
    if (c.kind !== 'void' && d[i]! < 0) errs.push(`cell ${i} unreachable`);
  });
  if (l.nav.distToExit[startI] !== l.stats.pathLength) errs.push('distToExit mismatch');
  if (l.stats.pathLength < SIZE_CONFIG[l.size].minPath) errs.push('path too short');

  // Exit gate is on an outward wall of the exit cell.
  if (getEdge(l, l.exit.x, l.exit.z, l.exit.side) !== 'exit') errs.push('exit edge missing');
  const ox = l.exit.x + DIR[l.exit.side].dx;
  const oz = l.exit.z + DIR[l.exit.side].dz;
  if (inBounds(l, ox, oz) && l.cells[cellIndex(l, ox, oz)]!.kind !== 'void') errs.push('exit leads inside');
  if ([...l.edgesX, ...l.edgesZ].filter((e) => e === 'exit').length !== 1) errs.push('exactly one exit');

  // Kit pieces occupy unique slots (no overlapping geometry).
  const slots = new Set<string>();
  for (const p of kitPieces(l)) {
    if (slots.has(p.slot)) errs.push(`slot ${p.slot} used twice`);
    slots.add(p.slot);
  }

  // Props: inside their cell, no overlaps, solid ones never block the centre cross or doorways.
  const S = l.cellSize;
  l.props.forEach((p, i) => {
    const u = p.x - p.cx * S;
    const v = p.z - p.cz * S;
    if (u - p.r < 0.15 || v - p.r < 0.15 || u + p.r > S - 0.15 || v + p.r > S - 0.15) errs.push(`prop ${i} intersects wall`);
    if (l.cells[cellIndex(l, p.cx, p.cz)]!.kind === 'void') errs.push(`prop ${i} in void`);
    if (p.solid) {
      const band = 0.6 * (S / 4);
      const mid = S / 2;
      if (Math.abs(u - mid) < band + p.r || Math.abs(v - mid) < band + p.r) errs.push(`solid prop ${i} blocks centre cross`);
      if ((p.cx === l.start.x && p.cz === l.start.z) || (p.cx === l.exit.x && p.cz === l.exit.z)) errs.push(`solid prop ${i} in start/exit`);
    }
    for (let j = i + 1; j < l.props.length; j++) {
      const q = l.props[j]!;
      if (Math.hypot(p.x - q.x, p.z - q.z) < p.r + q.r) errs.push(`props ${i} and ${j} overlap`);
    }
  });
  for (const pl of l.pillars) {
    for (const p of l.props) {
      if (Math.hypot(p.x - pl.x * S, p.z - pl.z * S) < p.r + 0.4) errs.push('prop overlaps pillar');
    }
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
        const l = generateLevel(seed, size);
        const errs = check(l);
        if (errs.length) failures.push(`${seed}: ${errs.slice(0, 3).join('; ')}`);
        totalPath += l.stats.pathLength;
      }
      expect(failures.slice(0, 10)).toEqual([]);
      expect(totalPath / SEEDS).toBeGreaterThan(SIZE_CONFIG[size].minPath);
    });

    it('is deterministic (same seed → identical level)', () => {
      for (const seed of seedList(50, `det-${size}`)) {
        const a = generateLevel(seed, size);
        const b = generateLevel(seed, size);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    });

    it('different seeds give different levels', () => {
      const hashes = new Set(seedList(100, `uniq-${size}`).map((s) => fnv1a(JSON.stringify(generateLevel(s, size).cells))));
      expect(hashes.size).toBeGreaterThan(95);
    });

    it('has loops, dead ends and halls across seeds', () => {
      let loops = 0;
      let deadEnds = 0;
      let halls = 0;
      for (const seed of seedList(100, `mix-${size}`)) {
        const s = generateLevel(seed, size).stats;
        loops += s.loops;
        deadEnds += s.deadEnds;
        halls += s.halls;
      }
      expect(loops).toBeGreaterThan(50);
      expect(deadEnds).toBeGreaterThan(50);
      if (size !== 'small') expect(halls).toBeGreaterThan(80);
    });
  });
}

describe('golden seeds', () => {
  // Locks layouts so later phases (props, materials, decals) can't silently change existing seeds.
  // Update deliberately with: GEN_UPDATE_GOLDEN=1 (prints new values).
  const golden: Record<string, string> = {
    'kzu:small': 'd08287b8',
    'kzu:medium': '3cd0fc4b',
    'abc123:large': '66d70ed0',
  };
  it('layout fingerprints are stable', () => {
    for (const key of Object.keys(golden)) {
      const [seed, size] = key.split(':') as [string, LevelSize];
      const l = generateLevel(seed, size);
      const fp = fnv1a(JSON.stringify([l.cells, l.edgesX, l.edgesZ, l.start, l.exit]));
      if (!golden[key] || process.env.GEN_UPDATE_GOLDEN) {
        console.log(`golden ${key}: '${fp}'`);
        continue;
      }
      expect(fp, key).toBe(golden[key]);
    }
  });
});
