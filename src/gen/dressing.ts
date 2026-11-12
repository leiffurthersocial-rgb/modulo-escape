/**
 * Set dressing: decals, room plates, dampness, vines, roots, trees and shrubs.
 * Pure and seeded with its own sub-streams, so it never changes the layout of a seed.
 */
import { streamRng, type Rng } from '../core/rng.ts';
import { DIR, SIDES, cellIndex, getEdge, inBounds, isWalkable } from './grid.ts';
import { WALL_THICKNESS } from './config.ts';
import type { LevelData, Side } from './types.ts';
import { USE_NAME, wingAt } from './kzu.ts';

/** Decal atlas tiles (4×4 grid in the main atlas). */
export const DECAL_TILES = {
  crack: [0, 1, 2],
  stain: [3, 4, 5],
  streak: [6, 7, 8],
  stencil: [9, 10],
  graffiti: [11, 12],
  moss: [13, 14],
  floorStain: [15],
} as const;

export interface DecalSlot {
  atlas: 'main' | 'plate' | 'sign';
  tile: number;
  /** Centre (world metres). */
  x: number;
  y: number;
  z: number;
  /** Surface normal (unit, axis aligned). */
  nx: number;
  ny: number;
  nz: number;
  w: number;
  h: number;
  /** In-plane rotation (radians). */
  rot: number;
  cx: number;
  cz: number;
}

export interface VineSlot {
  /** Anchor point at the top (world). */
  x: number;
  y: number;
  z: number;
  /** Unit vector along the wall the strands spread over. */
  ax: number;
  az: number;
  /** Unit normal pointing away from the wall (strands hang slightly off it). */
  nx: number;
  nz: number;
  width: number;
  length: number;
  strands: number;
  seed: number;
  cx: number;
  cz: number;
}

export interface RootSlot {
  x: number;
  z: number;
  angle: number;
  length: number;
  seed: number;
  cx: number;
  cz: number;
}

export interface FloraSlot {
  x: number;
  z: number;
  scale: number;
  rot: number;
  variant: number;
}

export interface Dressing {
  /** 0..1 dampness per cell (moss, wetness, streaks). */
  damp: number[];
  decals: DecalSlot[];
  vines: VineSlot[];
  roots: RootSlot[];
  trees: FloraSlot[];
  shrubs: FloraSlot[];
  /** Door plate text by room id: "E07", "E12\nChemie", "Mensa" ('' = no plate). */
  roomLabels: string[];
}

const T = WALL_THICKNESS / 2;
/** Door plates in the plate atlas (16 × 8). */
export const PLATE_TILES = 128;
/** Sign atlas tiles (8 × 4); mirrors SIGN_LAYOUT in render/decalAtlas.ts. */
export const SIGN_TILE = {
  notausgang: { left: 0, right: 1, up: 2 },
  ausgang: 3,
  trakt: { E: 4, '1': 5, '2': 6, '3': 7, '4': 8 } as Record<string, number>,
  hallBase: 9,
  halls: ['mensa', 'aula', 'turnhalle', 'mediothek', 'pausenhalle'] as string[],
};

export function dressLevel(l: LevelData, attempt = 0): Dressing {
  const rng = streamRng(l.seed, 'decals', attempt);
  const flora = streamRng(l.seed, 'flora', attempt);
  const damp = computeDamp(l, streamRng(l.seed, 'damp', attempt));
  const roomLabels = l.rooms.map((r) => {
    if (r.label) return r.use && r.use !== 'classroom' ? `${r.label}\n${USE_NAME[r.use]}` : r.label;
    return r.use ? USE_NAME[r.use] : '';
  });
  return {
    damp,
    decals: [...placeDecals(l, rng, damp), ...placeSigns(l, streamRng(l.seed, 'signs', attempt))],
    // Clean concrete look: no creepers, roots or moss patches (kept as code for later moods).
    vines: [] as VineSlot[],
    roots: [] as RootSlot[],
    ...placeOutdoor(l, flora),
    roomLabels,
  };
}

function computeDamp(l: LevelData, rng: Rng): number[] {
  // Smooth random field + boosts near windows and ceiling holes.
  const raw = l.cells.map(() => rng.next());
  return l.cells.map((c, i) => {
    if (!isWalkable(c.kind)) return 0;
    const x = i % l.width;
    const z = Math.floor(i / l.width);
    let sum = raw[i]!;
    let n = 1;
    for (const s of SIDES) {
      const nx = x + DIR[s].dx;
      const nz = z + DIR[s].dz;
      if (inBounds(l, nx, nz)) {
        sum += raw[cellIndex(l, nx, nz)]!;
        n++;
      }
    }
    let d = (sum / n) * 0.55;
    const windows = SIDES.filter((s) => getEdge(l, x, z, s) === 'window').length;
    d += windows * 0.12 + (c.ceiling === 'hole' ? 0.3 : 0) + (c.floor === 'puddle' ? 0.2 : 0);
    return Math.min(1, d);
  });
}

/** Point on the interior face of a cell's wall (side), u ∈ [-1,1] along it, at height y. */
function wallPoint(l: LevelData, cx: number, cz: number, side: Side, u: number, y: number) {
  const S = l.cellSize;
  const half = S / 2;
  const ccx = (cx + 0.5) * S;
  const ccz = (cz + 0.5) * S;
  const d = DIR[side];
  // Normal points into the cell (opposite of the side direction).
  const nx = -d.dx;
  const nz = -d.dz;
  const off = half - T - 0.012;
  const ax = d.dz !== 0 ? 1 : 0;
  const az = d.dx !== 0 ? 1 : 0;
  return { x: ccx + d.dx * off + ax * u, y, z: ccz + d.dz * off + az * u, nx, nz, ax, az };
}

function placeDecals(l: LevelData, rng: Rng, damp: number[]): DecalSlot[] {
  const out: DecalSlot[] = [];
  const S = l.cellSize;
  const push = (atlas: 'main' | 'plate', tile: number, p: { x: number; y: number; z: number; nx: number; nz: number }, w: number, h: number, rot: number, cx: number, cz: number, ny = 0) =>
    out.push({ atlas, tile, x: p.x, y: p.y, z: p.z, nx: p.nx, ny, nz: p.nz, w, h, rot, cx, cz });

  for (let cz = 0; cz < l.height; cz++) {
    for (let cx = 0; cx < l.width; cx++) {
      const i = cellIndex(l, cx, cz);
      const c = l.cells[i]!;
      if (!isWalkable(c.kind)) continue;
      const dm = damp[i]!;
      for (const side of SIDES) {
        const e = getEdge(l, cx, cz, side);
        if (e === 'window') {
          // Water streaks running down below the sill.
          if (rng.chance(0.45 + dm * 0.4)) push('main', rng.pick(DECAL_TILES.streak), wallPoint(l, cx, cz, side, rng.range(-0.6, 0.6), 0.5), 1.1, 0.9, 0, cx, cz);
          continue;
        }
        if (e !== 'solid') continue;
        // Up to two decals per wall face, in distinct slots along it.
        const slots = rng.shuffle([-1.1, 0, 1.1]);
        let used = 0;
        const tryAdd = (p: number, fn: (u: number) => void) => {
          if (used < 2 && rng.chance(p)) {
            fn(slots[used]!);
            used++;
          }
        };
        tryAdd(0.25 + dm * 0.5, (u) => push('main', rng.pick(DECAL_TILES.streak), wallPoint(l, cx, cz, side, u, rng.range(2.2, 2.7)), rng.range(0.9, 1.3), rng.range(1.6, 2.4), 0, cx, cz));
        tryAdd(0.22, (u) => push('main', rng.pick(DECAL_TILES.crack), wallPoint(l, cx, cz, side, u, rng.range(0.8, 2.6)), 1.1, 1.1, rng.range(-0.6, 0.6), cx, cz));
        if (c.kind === 'corridor') tryAdd(0.1, (u) => push('main', rng.pick(DECAL_TILES.stencil), wallPoint(l, cx, cz, side, u, 1.75), 1.0, 0.5, 0, cx, cz));
        tryAdd(0.05, (u) => push('main', rng.pick(DECAL_TILES.graffiti), wallPoint(l, cx, cz, side, u, rng.range(1.2, 1.7)), 1.3, 0.8, rng.range(-0.08, 0.08), cx, cz));
        rng.next(); // (was: moss patch) keep the stream stable
        tryAdd(0.12, (u) => push('main', rng.pick(DECAL_TILES.stain), wallPoint(l, cx, cz, side, u, rng.range(0.6, 1.4)), 0.9, 0.9, rng.range(0, Math.PI * 2), cx, cz));
      }
      // Room plates beside doors, on the corridor side.
      if (c.kind === 'corridor') {
        for (const side of SIDES) {
          if (getEdge(l, cx, cz, side) !== 'door') continue;
          const nx = cx + DIR[side].dx;
          const nz = cz + DIR[side].dz;
          const room = inBounds(l, nx, nz) ? l.cells[cellIndex(l, nx, nz)]!.room : -1;
          if (room < 0 || room >= PLATE_TILES) continue;
          const two = l.rooms[room]?.kind === 'hall' || (l.rooms[room]?.use ?? 'classroom') !== 'classroom';
          push('plate', room, wallPoint(l, cx, cz, side, 1.45, 1.55), two ? 0.56 : 0.42, two ? 0.28 : 0.21, 0, cx, cz);
        }
      }
      if (c.kind === 'stair') continue;
      // Floor: stains, cracks, moss creeping in.
      const fy = 0.004 + out.length * 1e-6; // tiny stagger avoids z-fighting between floor decals
      const floorP = (u: number, v: number) => ({ x: (cx + 0.5) * S + u, y: fy, z: (cz + 0.5) * S + v, nx: 0, nz: 0 });
      if (rng.chance(0.3)) push('main', DECAL_TILES.floorStain[0], floorP(rng.range(-1, 1), rng.range(-1, 1)), rng.range(1.2, 2), rng.range(1.2, 2), rng.range(0, 6.28), cx, cz, 1);
      if (c.floor === 'cracked' && rng.chance(0.8)) push('main', rng.pick(DECAL_TILES.crack), floorP(rng.range(-0.8, 0.8), rng.range(-0.8, 0.8)), 1.6, 1.6, rng.range(0, 6.28), cx, cz, 1);

    }
  }
  return out;
}

/**
 * German signs on the corridor walls:
 *  - glowing green NOTAUSGANG signs at junctions and turns, arrow along the shortest way out
 *  - AUSGANG above the exit gate
 *  - TRAKT signs where a corridor crosses into another wing
 *  - "← Mensa" / "Aula →" at junctions near the big halls
 * Signs only go on side walls (parallel to the way to go), so their arrow reads left/right.
 */
function placeSigns(l: LevelData, rng: Rng): DecalSlot[] {
  const out: DecalSlot[] = [];
  const dist = l.nav.distToExit;
  const adj = l.nav.adj;
  const used = new Set<string>();
  const cxz = (i: number) => [i % l.width, Math.floor(i / l.width)] as const;
  const corridorish = (i: number) => {
    const k = l.cells[i]!.kind;
    return k === 'corridor' || k === 'hall';
  };
  /** Put a sign on a free solid side wall of the cell (perpendicular to D); arrow tile by side. */
  const place = (i: number, D: { dx: number; dz: number }, tiles: [number, number] | number, w: number, h: number, y: number) => {
    const [cx, cz] = cxz(i);
    const walls = SIDES.filter((sd) => getEdge(l, cx, cz, sd) === 'solid' && DIR[sd].dx * D.dx + DIR[sd].dz * D.dz === 0 && !used.has(`${i}:${sd}`));
    if (!walls.length) return false;
    const side = rng.pick(walls);
    used.add(`${i}:${side}`);
    const p = wallPoint(l, cx, cz, side, rng.range(-0.5, 0.5), y);
    // Decal "right" on the wall = up × normal = (nz, 0, -nx).
    const right = D.dx * p.nz + D.dz * -p.nx > 0;
    const tile = typeof tiles === 'number' ? tiles : tiles[right ? 1 : 0];
    out.push({ atlas: 'sign', tile, x: p.x, y: p.y, z: p.z, nx: p.nx, ny: 0, nz: p.nz, w, h, rot: 0, cx, cz });
    return true;
  };
  const step = (a: number, b: number) => {
    const [ax, az] = cxz(a);
    const [bx, bz] = cxz(b);
    return { dx: bx - ax, dz: bz - az };
  };

  // Notausgang.
  if (dist.length) {
    l.cells.forEach((_, i) => {
      if (!corridorish(i) || !(dist[i]! > 0)) return;
      const next = adj[i]!.find((n) => dist[n] === dist[i]! - 1);
      if (next === undefined) return;
      const D = step(i, next);
      const junction = adj[i]!.length >= 3;
      const turn = adj[i]!.some((m) => dist[m] === dist[i]! + 1 && (step(m, i).dx !== D.dx || step(m, i).dz !== D.dz));
      const chance = junction ? 0.8 : turn ? 0.6 : dist[i]! % 4 === 0 ? 0.3 : 0;
      if (rng.chance(chance)) place(i, D, [SIGN_TILE.notausgang.left, SIGN_TILE.notausgang.right], 1.0, 0.5, 2.45);
    });
  }
  // Ausgang above the gate.
  if (l.exit.x >= 0) {
    const p = wallPoint(l, l.exit.x, l.exit.z, l.exit.side, 0, 3.25);
    out.push({ atlas: 'sign', tile: SIGN_TILE.ausgang, x: p.x, y: p.y, z: p.z, nx: p.nx, ny: 0, nz: p.nz, w: 0.66, h: 0.33, rot: 0, cx: l.exit.x, cz: l.exit.z });
  }
  // Trakt signs at wing borders.
  const wings = l.wings ?? [];
  if (wings.length) {
    const wingOf = l.cells.map((_, i) => wingAt(wings, (i % l.width) + 0.5, Math.floor(i / l.width) + 0.5));
    const seen = new Set<string>();
    l.cells.forEach((_, i) => {
      if (l.cells[i]!.kind !== 'corridor') return;
      for (const n of adj[i]!) {
        if (wingOf[n] === wingOf[i] || l.cells[n]!.kind !== 'corridor') continue;
        const key = `${Math.min(i, n)}-${Math.max(i, n)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        place(n, step(i, n), SIGN_TILE.trakt[wings[wingOf[n]!]!.prefix] ?? SIGN_TILE.trakt.E!, 0.8, 0.4, 2.15);
      }
    });
  }
  // Hall direction signs.
  const halls = l.rooms.filter((r) => r.kind === 'hall' && r.use && SIGN_TILE.halls.includes(r.use));
  if (halls.length) {
    const best = new Array<number>(l.cells.length).fill(Infinity);
    const toward = new Array<number>(l.cells.length).fill(-1);
    for (const h of halls) {
      const k = SIGN_TILE.halls.indexOf(h.use!);
      const d = new Array<number>(l.cells.length).fill(-1);
      const q: number[] = [];
      l.cells.forEach((c, i) => {
        if (c.room === h.id) {
          d[i] = 0;
          q.push(i);
        }
      });
      for (let head = 0; head < q.length; head++) {
        const c = q[head]!;
        if (d[c]! >= 12) continue;
        for (const n of adj[c]!) {
          if (d[n] !== -1) continue;
          d[n] = d[c]! + 1;
          q.push(n);
        }
      }
      d.forEach((v, i) => {
        if (v > 1 && v < best[i]!) {
          best[i] = v;
          toward[i] = k;
        }
      });
      // Direction for cells that chose this hall.
      l.cells.forEach((c, i) => {
        if (toward[i] !== k || best[i] !== d[i] || c.kind !== 'corridor' || adj[i]!.length < 3 || !rng.chance(0.55)) return;
        const next = adj[i]!.find((n) => d[n] === d[i]! - 1);
        if (next !== undefined) place(i, step(i, next), [SIGN_TILE.hallBase + k * 2, SIGN_TILE.hallBase + k * 2 + 1], 0.8, 0.4, 1.95);
      });
    }
  }
  return out;
}

/** A few creepers hanging from ceiling cracks along walls, only in the dampest spots. */
export function placeVines(l: LevelData, rng: Rng, damp: number[]): VineSlot[] {
  const out: VineSlot[] = [];
  for (let cz = 0; cz < l.height; cz++) {
    for (let cx = 0; cx < l.width; cx++) {
      const i = cellIndex(l, cx, cz);
      const c = l.cells[i]!;
      if (!isWalkable(c.kind) || c.kind === 'stair' || damp[i]! < 0.62 || !rng.chance(0.18)) continue;
      const walls = SIDES.filter((s) => getEdge(l, cx, cz, s) === 'solid');
      if (!walls.length) continue;
      const side = rng.pick(walls);
      const p = wallPoint(l, cx, cz, side, rng.range(-1, 1), l.storeyHeight - 0.02);
      out.push({ x: p.x, y: p.y, z: p.z, ax: p.ax, az: p.az, nx: p.nx, nz: p.nz, width: rng.range(0.6, 1.4), length: rng.range(0.5, 1.3), strands: rng.int(2, 4), seed: rng.int(0, 1e9), cx, cz });
    }
  }
  return out;
}

export function placeRoots(l: LevelData, rng: Rng, damp: number[]): RootSlot[] {
  const out: RootSlot[] = [];
  const S = l.cellSize;
  l.cells.forEach((c, i) => {
    if (!isWalkable(c.kind) || c.kind === 'stair') return;
    const cx = i % l.width;
    const cz = Math.floor(i / l.width);
    if (c.floor !== 'cracked' && damp[i]! < 0.6) return;
    const n = rng.chance(0.3) ? rng.int(1, 2) : 0;
    for (let k = 0; k < n; k++) {
      // Roots emerge from wall bases and crawl into the room along the floor.
      const walls = SIDES.filter((s) => getEdge(l, cx, cz, s) === 'solid');
      if (!walls.length) return;
      const side = rng.pick(walls);
      const d = DIR[side];
      const along = rng.range(-1.4, 1.4);
      const x = (cx + 0.5) * S + d.dx * (S / 2 - 0.2) + (d.dz !== 0 ? along : 0);
      const z = (cz + 0.5) * S + d.dz * (S / 2 - 0.2) + (d.dx !== 0 ? along : 0);
      out.push({ x, z, angle: Math.atan2(-d.dz, -d.dx) + rng.range(-0.6, 0.6), length: rng.range(1.0, 2.2), seed: rng.int(0, 1e9), cx, cz });
    }
  });
  return out;
}

/** Only the exit leads outside: a patch of jungle in front of the gate. */
function placeOutdoor(l: LevelData, rng: Rng): { trees: FloraSlot[]; shrubs: FloraSlot[] } {
  const trees: FloraSlot[] = [];
  const shrubs: FloraSlot[] = [];
  if (l.exit.x < 0) return { trees, shrubs };
  const S = l.cellSize;
  const d = DIR[l.exit.side];
  // Centre of the clearing, a few metres out from the gate.
  const ox = (l.exit.x + 0.5 + d.dx * 2.5) * S;
  const oz = (l.exit.z + 0.5 + d.dz * 2.5) * S;
  const inside = (x: number, z: number) => {
    const cx = Math.floor(x / S);
    const cz = Math.floor(z / S);
    return inBounds(l, cx, cz) && l.cells[cellIndex(l, cx, cz)]!.kind !== 'void';
  };
  for (let k = 0; k < 14; k++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(4, 16);
    const x = ox + Math.cos(a) * r;
    const z = oz + Math.sin(a) * r;
    if (!inside(x, z) && !inside(x + 1.5, z) && !inside(x - 1.5, z) && !inside(x, z + 1.5) && !inside(x, z - 1.5)) {
      trees.push({ x, z, scale: rng.range(0.8, 1.3), rot: rng.range(0, 6.28), variant: rng.int(0, 2) });
    }
  }
  for (let k = 0; k < 30; k++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(2, 14);
    const x = ox + Math.cos(a) * r;
    const z = oz + Math.sin(a) * r;
    if (!inside(x, z) && !inside(x + 0.6, z) && !inside(x - 0.6, z) && !inside(x, z + 0.6) && !inside(x, z - 0.6)) {
      shrubs.push({ x, z, scale: rng.range(0.6, 1.3), rot: rng.range(0, 6.28), variant: rng.int(0, 7) });
    }
  }
  return { trees, shrubs };
}
