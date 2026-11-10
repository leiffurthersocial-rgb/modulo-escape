/**
 * Set dressing: decals, room plates, dampness, vines, roots, trees and shrubs.
 * Pure and seeded with its own sub-streams, so it never changes the layout of a seed.
 */
import { streamRng, type Rng } from '../core/rng.ts';
import { DIR, SIDES, cellIndex, getEdge, inBounds } from './grid.ts';
import { WALL_THICKNESS } from './config.ts';
import type { LevelData, Side } from './types.ts';

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
  atlas: 'main' | 'plate';
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
  /** Room number labels, by room id ("C 1.07"). */
  roomLabels: string[];
}

const T = WALL_THICKNESS / 2;

export function dressLevel(l: LevelData, attempt = 0): Dressing {
  const rng = streamRng(l.seed, 'decals', attempt);
  const flora = streamRng(l.seed, 'flora', attempt);
  const damp = computeDamp(l, streamRng(l.seed, 'damp', attempt));
  const roomLabels = l.rooms.map((r, i) => `C ${1 + (i % 3)}.${String(1 + i).padStart(2, '0')}`);
  return {
    damp,
    decals: placeDecals(l, rng, damp),
    vines: placeVines(l, flora, damp),
    roots: placeRoots(l, flora, damp),
    ...placeOutdoor(l, flora),
    roomLabels,
  };
}

function computeDamp(l: LevelData, rng: Rng): number[] {
  // Smooth random field + boosts near windows and ceiling holes.
  const raw = l.cells.map(() => rng.next());
  return l.cells.map((c, i) => {
    if (c.kind === 'void') return 0;
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
    let d = (sum / n) * 0.7;
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
      if (c.kind === 'void') continue;
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
        tryAdd(dm * 0.5, (u) => push('main', rng.pick(DECAL_TILES.moss), wallPoint(l, cx, cz, side, u, 0.35), 1.2, 0.7, 0, cx, cz));
        tryAdd(0.12, (u) => push('main', rng.pick(DECAL_TILES.stain), wallPoint(l, cx, cz, side, u, rng.range(0.6, 1.4)), 0.9, 0.9, rng.range(0, Math.PI * 2), cx, cz));
      }
      // Room plates beside doors, on the corridor side.
      if (c.kind === 'corridor') {
        for (const side of SIDES) {
          if (getEdge(l, cx, cz, side) !== 'door') continue;
          const nx = cx + DIR[side].dx;
          const nz = cz + DIR[side].dz;
          const room = inBounds(l, nx, nz) ? l.cells[cellIndex(l, nx, nz)]!.room : -1;
          if (room < 0) continue;
          push('plate', room % 32, wallPoint(l, cx, cz, side, 1.45, 1.55), 0.42, 0.21, 0, cx, cz);
        }
      }
      // Floor: stains, cracks, moss creeping in.
      const fy = 0.004 + out.length * 1e-6; // tiny stagger avoids z-fighting between floor decals
      const floorP = (u: number, v: number) => ({ x: (cx + 0.5) * S + u, y: fy, z: (cz + 0.5) * S + v, nx: 0, nz: 0 });
      if (rng.chance(0.3)) push('main', DECAL_TILES.floorStain[0], floorP(rng.range(-1, 1), rng.range(-1, 1)), rng.range(1.2, 2), rng.range(1.2, 2), rng.range(0, 6.28), cx, cz, 1);
      if (c.floor === 'cracked' && rng.chance(0.8)) push('main', rng.pick(DECAL_TILES.crack), floorP(rng.range(-0.8, 0.8), rng.range(-0.8, 0.8)), 1.6, 1.6, rng.range(0, 6.28), cx, cz, 1);
      if (dm > 0.45 && rng.chance(dm)) push('main', rng.pick(DECAL_TILES.moss), floorP(rng.range(-1.2, 1.2), rng.range(-1.2, 1.2)), 1.4, 1.4, rng.range(0, 6.28), cx, cz, 1);
    }
  }
  return out;
}

function placeVines(l: LevelData, rng: Rng, damp: number[]): VineSlot[] {
  const out: VineSlot[] = [];
  const S = l.cellSize;
  for (let cz = 0; cz < l.height; cz++) {
    for (let cx = 0; cx < l.width; cx++) {
      const i = cellIndex(l, cx, cz);
      const c = l.cells[i]!;
      if (c.kind === 'void') continue;
      for (const side of SIDES) {
        if (getEdge(l, cx, cz, side) !== 'window') continue;
        // Inside: curtain of vines from the lintel; outside: creepers over the facade.
        if (rng.chance(0.55 + damp[i]! * 0.3)) {
          const p = wallPoint(l, cx, cz, side, rng.range(-0.4, 0.4), l.storeyHeight - 0.05);
          out.push({ x: p.x, y: p.y, z: p.z, ax: p.ax, az: p.az, nx: p.nx, nz: p.nz, width: rng.range(1.2, 2.4), length: rng.range(0.9, 2.0), strands: rng.int(4, 8), seed: rng.int(0, 1e9), cx, cz });
        }
        if (rng.chance(0.6)) {
          const d = DIR[side];
          const p = wallPoint(l, cx, cz, side, rng.range(-1, 1), l.storeyHeight + 0.2);
          const off = WALL_THICKNESS + 0.04;
          out.push({ x: p.x + d.dx * off, y: p.y, z: p.z + d.dz * off, ax: p.ax, az: p.az, nx: d.dx, nz: d.dz, width: rng.range(1.5, 3.5), length: rng.range(1.5, 3.4), strands: rng.int(6, 12), seed: rng.int(0, 1e9), cx, cz });
        }
      }
      if (c.ceiling === 'hole' && rng.chance(0.85)) {
        const ccx = (cx + 0.5) * S;
        const ccz = (cz + 0.5) * S;
        for (const s of [-1, 1]) {
          out.push({ x: ccx + s * 0.95, y: l.storeyHeight + 0.1, z: ccz, ax: 0, az: 1, nx: -s, nz: 0, width: 1.8, length: rng.range(1.2, 2.8), strands: rng.int(3, 6), seed: rng.int(0, 1e9), cx, cz });
        }
      }
    }
  }
  return out;
}

function placeRoots(l: LevelData, rng: Rng, damp: number[]): RootSlot[] {
  const out: RootSlot[] = [];
  const S = l.cellSize;
  l.cells.forEach((c, i) => {
    if (c.kind === 'void') return;
    const cx = i % l.width;
    const cz = Math.floor(i / l.width);
    if (c.floor !== 'cracked' && damp[i]! < 0.6) return;
    const n = rng.chance(0.5) ? rng.int(1, 3) : 0;
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

function placeOutdoor(l: LevelData, rng: Rng): { trees: FloraSlot[]; shrubs: FloraSlot[] } {
  const trees: FloraSlot[] = [];
  const shrubs: FloraSlot[] = [];
  const S = l.cellSize;
  const nearBuilding = (x: number, z: number) => SIDES.some((s) => {
    const nx = x + DIR[s].dx;
    const nz = z + DIR[s].dz;
    return inBounds(l, nx, nz) && l.cells[cellIndex(l, nx, nz)]!.kind !== 'void';
  });
  const nearWindow = (x: number, z: number) => SIDES.some((s) => {
    const nx = x + DIR[s].dx;
    const nz = z + DIR[s].dz;
    return inBounds(l, nx, nz) && l.cells[cellIndex(l, nx, nz)]!.kind !== 'void' && getEdge(l, x, z, s) === 'window';
  });
  for (let z = -3; z < l.height + 3; z++) {
    for (let x = -3; x < l.width + 3; x++) {
      const inside = inBounds(l, x, z);
      if (inside && l.cells[cellIndex(l, x, z)]!.kind !== 'void') continue;
      const nb = inside && nearBuilding(x, z);
      const pTree = inside ? (nearWindow(x, z) ? 0.55 : nb ? 0.12 : 0.3) : 0.35;
      if (rng.chance(pTree)) {
        // Keep trunks off the facade so they don't poke through walls.
        const margin = nb ? 1.2 : 0.6;
        trees.push({ x: (x + rng.range(margin / S, 1 - margin / S)) * S, z: (z + rng.range(margin / S, 1 - margin / S)) * S, scale: rng.range(0.75, 1.3), rot: rng.range(0, 6.28), variant: rng.int(0, 2) });
      }
      const ns = rng.int(nb ? 2 : 0, nb ? 5 : 3);
      for (let k = 0; k < ns; k++) shrubs.push({ x: (x + rng.next()) * S, z: (z + rng.next()) * S, scale: rng.range(0.6, 1.4), rot: rng.range(0, 6.28), variant: rng.int(0, 7) });
    }
  }
  // Shrubs right against the facade would clip into walls: nudge out of building cells.
  return {
    trees,
    shrubs: shrubs.filter((s) => {
      const cx = Math.floor(s.x / S);
      const cz = Math.floor(s.z / S);
      if (!inBounds(l, cx, cz)) return true;
      if (l.cells[cellIndex(l, cx, cz)]!.kind !== 'void') return false;
      const u = s.x / S - cx;
      const v = s.z / S - cz;
      return u > 0.12 && u < 0.88 && v > 0.12 && v < 0.88;
    }),
  };
}
