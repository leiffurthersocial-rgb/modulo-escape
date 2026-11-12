/**
 * Furnishing by room use (labs, Mensa, Aula, Turnhalle, Mediothek, Lehrerzimmer, WCs …) and set
 * dressing (CC0 Poly Haven models: chess set, books, microscopes, extinguishers …), on top of the
 * classroom layout from props.ts. Pure and seeded with its own stream.
 *
 * Passability (asserted by the tests): every solid prop keeps out of the cell's centre square and
 * of the entrance strip of every passable side, so all open sides stay connected through the
 * middle. Wall furniture only stands against solid walls and is at most ~1.2 m deep.
 * Small things stand ON other props (`on`), the renderer lifts them onto that surface.
 */
import type { Rng } from '../core/rng.ts';
import { cellIndex, getEdge, isPassable, isWalkable } from './grid.ts';
import type { LevelData, PropSlot, PropType, Room, Side } from './types.ts';

/** Box furniture sizes: w along the wall, d depth, h height (m). */
export const BOX_SIZE: Partial<Record<PropType, { w: number; d: number; h: number; solid: boolean }>> = {
  lab_bench: { w: 2.6, d: 0.8, h: 0.92, solid: true },
  counter: { w: 3.0, d: 0.8, h: 1.0, solid: true },
  stage: { w: 3.4, d: 1.05, h: 0.62, solid: true },
  seat_row: { w: 1.1, d: 0.55, h: 0.9, solid: true },
  wall_bars: { w: 2.8, d: 0.16, h: 2.5, solid: true },
  hoop: { w: 1.2, d: 0.6, h: 1.0, solid: false },
  gym_mat: { w: 2.0, d: 1.0, h: 0.08, solid: false },
  wc_stall: { w: 2.6, d: 1.15, h: 2.05, solid: true },
  sink: { w: 0.6, d: 0.45, h: 0.88, solid: true },
  piano: { w: 1.5, d: 0.62, h: 1.25, solid: true },
  monitor: { w: 0.52, d: 0.2, h: 0.42, solid: false },
  shelf: { w: 1.8, d: 0.45, h: 2.0, solid: true },
  pinboard: { w: 1.2, d: 0.03, h: 0.9, solid: false },
};

/**
 * The CC0 models we place, with their measured size (m, real-world scale): w along the model's X,
 * d along its Z (its front faces +Z), and whether you bump into them. `scale` shrinks oversized ones.
 */
const MODEL: Record<string, { w: number; d: number; solid: boolean; scale?: number }> = {
  chess_set: { w: 0.56, d: 0.56, solid: false },
  decorative_book_set_01: { w: 0.4, d: 0.25, solid: false },
  binder_notebook: { w: 0.58, d: 0.2, solid: false },
  clipboard: { w: 0.23, d: 0.34, solid: false },
  alarm_clock_01: { w: 0.13, d: 0.07, solid: false },
  food_apple_01: { w: 0.1, d: 0.1, solid: false },
  desk_lamp_arm_01: { w: 0.2, d: 0.61, solid: false },
  standing_chalkboard_01: { w: 0.92, d: 0.76, solid: true },
  wall_clock: { w: 0.32, d: 0.05, solid: false },
  korean_fire_extinguisher_01: { w: 0.28, d: 0.37, solid: false },
  fire_alarm: { w: 0.1, d: 0.03, solid: false },
  'metal_trash_can#rust': { w: 0.77, d: 0.54, solid: true, scale: 0.75 },
  WetFloorSign_01: { w: 0.3, d: 0.36, solid: false },
  potted_plant_04: { w: 0.17, d: 0.18, solid: false },
  security_camera_01: { w: 0.17, d: 0.55, solid: false },
  Sofa_01: { w: 1.57, d: 0.66, solid: true },
  ArmChair_01: { w: 0.85, d: 0.77, solid: true },
  CoffeeTable_01: { w: 1.54, d: 0.97, solid: true, scale: 0.8 },
  metal_office_desk: { w: 2.0, d: 0.95, solid: true, scale: 0.85 },
  drawer_cabinet: { w: 1.14, d: 0.49, solid: true },
  dartboard: { w: 0.45, d: 0.04, solid: false },
  industrial_microscope: { w: 0.21, d: 0.5, solid: false },
  vintage_microscope: { w: 0.11, d: 0.18, solid: false },
  magnifying_glass_01: { w: 0.13, d: 0.03, solid: false },
  medical_box: { w: 0.53, d: 0.35, solid: false },
  circuit_board: { w: 0.4, d: 0.4, solid: false },
  boombox: { w: 0.72, d: 0.19, solid: false },
  portable_cassette_player: { w: 0.17, d: 0.04, solid: false },
  wooden_bookshelf_worn: { w: 1.37, d: 0.58, solid: true },
  dining_table: { w: 2.26, d: 1.39, solid: true, scale: 0.72 },
  dining_chair_02: { w: 0.43, d: 0.58, solid: true },
  plastic_monobloc_chair_01: { w: 0.64, d: 0.63, solid: true },
  plastic_crate_01: { w: 0.3, d: 0.41, solid: false },
  football: { w: 0.51, d: 0.22, solid: false },
  dirty_football: { w: 0.22, d: 0.22, solid: false },
  painted_wooden_bench: { w: 1.16, d: 0.5, solid: true },
  metal_toolbox: { w: 0.4, d: 0.27, solid: false },
  wooden_ladder: { w: 0.96, d: 0.5, solid: false },
  multi_cleaner_bottle: { w: 0.09, d: 0.09, solid: false },
  bleach_bottle: { w: 0.09, d: 0.06, solid: false },
  wooden_crate_01: { w: 0.83, d: 0.41, solid: true },
  trashbag: { w: 0.53, d: 0.46, solid: false },
  wheelchair_01: { w: 0.82, d: 1.09, solid: true },
  wooden_bucket_01: { w: 0.37, d: 0.34, solid: false },
  cardboard_box_01: { w: 0.39, d: 0.52, solid: false },
};

/** Every model id the furnisher may place (the game loads these). */
export const FURNISH_MODELS = Object.keys(MODEL);

/** Rotation so a prop's front (+Z) faces into the cell from a wall. */
const FACE_IN: Record<Side, number> = { N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 };

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** World-space footprint of a prop (box furniture: w × d turned by rot; others: r). */
export function propBox(p: PropSlot): Box {
  if (p.w !== undefined && p.d !== undefined) {
    const along = Math.abs(Math.cos(p.rot)) > 0.5;
    const hw = (along ? p.w : p.d) / 2;
    const hd = (along ? p.d : p.w) / 2;
    return { x0: p.x - hw, z0: p.z - hd, x1: p.x + hw, z1: p.z + hd };
  }
  return { x0: p.x - p.r, z0: p.z - p.r, x1: p.x + p.r, z1: p.z + p.r };
}

/** Point on a cell's wall face (offset `off` into the cell), `u` along the wall from its centre. */
function wallSpot(S: number, cx: number, cz: number, side: Side, off: number, u: number): { x: number; z: number } {
  switch (side) {
    case 'N':
      return { x: (cx + 0.5) * S + u, z: cz * S + off };
    case 'S':
      return { x: (cx + 0.5) * S - u, z: (cz + 1) * S - off };
    case 'W':
      return { x: cx * S + off, z: (cz + 0.5) * S - u };
    default:
      return { x: (cx + 1) * S - off, z: (cz + 0.5) * S + u };
  }
}

export function furnish(l: LevelData, props: PropSlot[], rng: Rng): void {
  const S = l.cellSize;
  const startI = l.start.x >= 0 ? cellIndex(l, l.start.x, l.start.z) : -1;
  const exitI = l.exit.x >= 0 ? cellIndex(l, l.exit.x, l.exit.z) : -1;
  // Occupied footprints per cell (existing props first).
  const occ = new Map<number, Box[]>();
  const boxOf = propBox;
  const occupy = (p: PropSlot) => {
    const i = cellIndex(l, p.cx, p.cz);
    const list = occ.get(i) ?? [];
    list.push(boxOf(p));
    occ.set(i, list);
  };
  for (const p of props) if (p.y === undefined && p.on === undefined) occupy(p);
  // Hall pillars sit on cell corners: keep 0.4 m around them free in all four cells.
  for (const pl of l.pillars) {
    const b: Box = { x0: pl.x * S - 0.42, z0: pl.z * S - 0.42, x1: pl.x * S + 0.42, z1: pl.z * S + 0.42 };
    for (const [dx, dz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const cx = pl.x + dx;
      const cz = pl.z + dz;
      if (cx < 0 || cz < 0 || cx >= l.width || cz >= l.height) continue;
      const i = cellIndex(l, cx, cz);
      const list = occ.get(i) ?? [];
      list.push(b);
      occ.set(i, list);
    }
  }
  const overlaps = (i: number, b: Box) => (occ.get(i) ?? []).some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.z0 < o.z1 && b.z1 > o.z0);

  /** Passability: a solid footprint must avoid the centre square and passable sides' entrance strips. */
  const blocks = (cx: number, cz: number, b: Box) => {
    const ox = cx * S;
    const oz = cz * S;
    const lo = S / 2 - 0.6;
    const hi = S / 2 + 0.6;
    const hit = (x0: number, z0: number, x1: number, z1: number) => b.x0 - ox < x1 && b.x1 - ox > x0 && b.z0 - oz < z1 && b.z1 - oz > z0;
    if (hit(lo, lo, hi, hi)) return true;
    const pass = (sd: Side) => isPassable(getEdge(l, cx, cz, sd)) || getEdge(l, cx, cz, sd) === 'exit';
    if (pass('N') && hit(lo, 0, hi, lo)) return true;
    if (pass('S') && hit(lo, hi, hi, S)) return true;
    if (pass('W') && hit(0, lo, lo, hi)) return true;
    if (pass('E') && hit(hi, lo, S, hi)) return true;
    return false;
  };
  const inCell = (cx: number, cz: number, b: Box, m = 0.15) => b.x0 >= cx * S + m - 1e-6 && b.z0 >= cz * S + m - 1e-6 && b.x1 <= (cx + 1) * S - m + 1e-6 && b.z1 <= (cz + 1) * S - m + 1e-6;

  const push = (p: PropSlot): number => {
    props.push(p);
    return props.length - 1;
  };
  /** The start and exit cells stay empty. */
  const reserved = (cx: number, cz: number) => {
    const i = cellIndex(l, cx, cz);
    return i === startI || i === exitI;
  };

  /** Furniture flush against a solid wall of a cell; `u` = offset along the wall from the centre. */
  const atWall = (type: PropType, cx: number, cz: number, side: Side, u = 0, extra: Partial<PropSlot> = {}): number => {
    const size = BOX_SIZE[type]!;
    if (getEdge(l, cx, cz, side) !== 'solid' || reserved(cx, cz)) return -1;
    const { x, z } = wallSpot(S, cx, cz, side, 0.15 + size.d / 2 + 0.01, u);
    const p: PropSlot = { type, cx, cz, x, z, r: 0, rot: FACE_IN[side], scale: 1, variant: rng.int(0, 3), solid: size.solid, w: size.w, d: size.d, wall: side, ...extra };
    const b = boxOf(p);
    const mounted = p.y !== undefined && p.y > 0;
    if (!inCell(cx, cz, b, 0.14)) return -1;
    if (!mounted && (overlaps(cellIndex(l, cx, cz), b) || (p.solid && blocks(cx, cz, b)))) return -1;
    if (!mounted) occupy(p);
    return push(p);
  };

  /**
   * A model standing on the floor at a cell-local spot (u,v in metres from the cell's corner).
   * Turned to a right angle (± a little); its footprint is the turned box.
   */
  const onFloor = (model: string, cx: number, cz: number, u: number, v: number, rot = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2])): number => {
    const m = MODEL[model]!;
    if (reserved(cx, cz)) return -1;
    const k = m.scale ?? 1;
    const p: PropSlot = { type: 'model', model, cx, cz, x: cx * S + u, z: cz * S + v, r: 0, rot, scale: k, variant: 0, solid: m.solid, w: m.w * k + 0.04, d: m.d * k + 0.04 };
    const b = boxOf(p);
    if (!inCell(cx, cz, b) || overlaps(cellIndex(l, cx, cz), b) || (m.solid && blocks(cx, cz, b))) return -1;
    occupy(p);
    return push(p);
  };
  /** A model mounted on a wall at height y (no footprint). */
  const onWallModel = (model: string, cx: number, cz: number, side: Side, u: number, y: number): number => {
    if (getEdge(l, cx, cz, side) !== 'solid') return -1;
    const { x, z } = wallSpot(S, cx, cz, side, 0.16, u);
    return push({ type: 'model', model, cx, cz, x, z, r: 0, rot: FACE_IN[side], scale: 1, variant: 0, solid: false, y, wall: side });
  };
  /** A small model standing on top of prop `parent` (offset in the parent's local frame). */
  const onTop = (model: string, parent: number, dx = 0, dz = 0, rot = rng.range(0, Math.PI * 2)): number => {
    const q = props[parent];
    if (!q) return -1;
    const c = Math.cos(q.rot);
    const s = Math.sin(q.rot);
    return push({ type: 'model', model, cx: q.cx, cz: q.cz, x: q.x + dx * c + dz * s, z: q.z - dx * s + dz * c, r: 0, rot, scale: 1, variant: 0, solid: false, on: parent });
  };

  const cellsOf = (r: Room) => {
    const out: [number, number][] = [];
    for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) out.push([x, z]);
    return out;
  };
  const solidSides = (cx: number, cz: number) => (['N', 'E', 'S', 'W'] as Side[]).filter((sd) => getEdge(l, cx, cz, sd) === 'solid');
  const corner = (k: number) => [
    [0.75, 0.75],
    [S - 0.75, 0.75],
    [0.75, S - 0.75],
    [S - 0.75, S - 0.75],
  ][k]! as [number, number];
  /** Put a model into corner k of a cell, as tight to the walls as its footprint allows. */
  const inCorner = (model: string, cx: number, cz: number, k: number, rot = rng.pick([0, Math.PI / 2])): number => {
    const m = MODEL[model]!;
    const sc = m.scale ?? 1;
    const along = Math.abs(Math.cos(rot)) > 0.5;
    const hx = ((along ? m.w : m.d) * sc) / 2 + 0.02;
    const hz = ((along ? m.d : m.w) * sc) / 2 + 0.02;
    const u = k % 2 === 0 ? 0.2 + hx : S - 0.2 - hx;
    const v = k < 2 ? 0.2 + hz : S - 0.2 - hz;
    return onFloor(model, cx, cz, u, v, rot);
  };
  const pick = <T>(xs: T[]) => rng.pick(xs);

  // Existing classroom desks get things on them; the teacher's desk gets a lamp and papers.
  const desks = props.map((p, i) => ({ p, i })).filter(({ p }) => p.type === 'classroom_desk');
  for (const { i } of desks) {
    const roll = rng.next();
    if (roll < 0.12) onTop(pick(['binder_notebook', 'decorative_book_set_01', 'decorative_book_set_01']), i, rng.range(-0.1, 0.1), rng.range(-0.05, 0.05));
    else if (roll < 0.16) onTop('food_apple_01', i, rng.range(-0.15, 0.15), rng.range(-0.08, 0.08));
    else if (roll < 0.18) onTop('alarm_clock_01', i, rng.range(-0.15, 0.15), 0);
    else if (roll < 0.205) onTop('chess_set', i, 0, 0, rng.range(-0.3, 0.3)); // a game left mid-move
  }
  props.forEach((p, i) => {
    if (p.type !== 'desk') return;
    if (rng.chance(0.7)) onTop('desk_lamp_arm_01', i, rng.range(0.25, 0.35), -0.05, p.rot + rng.range(-0.6, 0.6));
    if (rng.chance(0.6)) onTop(pick(['clipboard', 'binder_notebook', 'decorative_book_set_01']), i, rng.range(-0.3, -0.1), 0);
  });

  for (const r of l.rooms) {
    if (r.kind !== 'room' && r.kind !== 'hall') continue;
    const cells = cellsOf(r);
    const use = r.use ?? 'classroom';
    const walls = rng.shuffle(cells.flatMap(([x, z]) => solidSides(x, z).map((sd) => ({ x, z, sd }))));
    switch (use) {
      case 'classroom': {
        // A pinboard, the clock on a back wall, sometimes a standing chalkboard.
        const w = walls.slice(0, 3);
        if (w[0] && rng.chance(0.7)) atWall('pinboard', w[0].x, w[0].z, w[0].sd, rng.range(-0.6, 0.6), { y: 1.1 });
        if (w[1] && rng.chance(0.6)) onWallModel('wall_clock', w[1].x, w[1].z, w[1].sd, rng.range(-0.8, 0.8), 2.45);
        if (w[2] && rng.chance(0.3)) inCorner('standing_chalkboard_01', w[2].x, w[2].z, rng.int(0, 3));
        break;
      }
      case 'chemie':
      case 'physik':
      case 'biologie': {
        // Lab benches along the walls, kit on top; a fire extinguisher by the door.
        let n = 0;
        for (const w of walls) {
          if (n >= Math.max(2, cells.length)) break;
          const b = atWall('lab_bench', w.x, w.z, w.sd, rng.range(-0.3, 0.3));
          if (b < 0) continue;
          n++;
          const kit = use === 'biologie' ? ['industrial_microscope', 'vintage_microscope', 'magnifying_glass_01'] : use === 'chemie' ? ['medical_box', 'multi_cleaner_bottle', 'bleach_bottle'] : ['circuit_board', 'alarm_clock_01', 'binder_notebook'];
          for (const dx of [-0.8, 0, 0.8]) if (rng.chance(0.55)) onTop(pick(kit), b, dx + rng.range(-0.15, 0.15), rng.range(-0.1, 0.1));
        }
        const w = walls.at(-1);
        if (w) inCorner('korean_fire_extinguisher_01', w.x, w.z, rng.int(0, 3));
        break;
      }
      case 'informatik': {
        props.forEach((p, i) => {
          if (p.type !== 'classroom_desk' || l.cells[cellIndex(l, p.cx, p.cz)]!.room !== r.id) return;
          if (rng.chance(0.85)) push({ type: 'monitor', cx: p.cx, cz: p.cz, x: p.x, z: p.z, r: 0, rot: p.rot + Math.PI, scale: 1, variant: rng.int(0, 3), solid: false, w: 0.52, d: 0.2, on: i });
        });
        const w = walls[0];
        if (w) {
          const b = atWall('shelf', w.x, w.z, w.sd);
          if (b >= 0) for (const dx of [-0.5, 0.4]) onTop(pick(['circuit_board', 'binder_notebook', 'cardboard_box_01']), b, dx, 0);
        }
        break;
      }
      case 'musik': {
        for (const w of walls) if (atWall('piano', w.x, w.z, w.sd, rng.range(-0.6, 0.6)) >= 0) break;
        props.forEach((p, i) => {
          if (p.type === 'desk' && l.cells[cellIndex(l, p.cx, p.cz)]!.room === r.id) onTop(pick(['boombox', 'portable_cassette_player']), i, 0.1, 0);
        });
        break;
      }
      case 'bg': {
        let k = 0;
        for (const [x, z] of cells) {
          if (k++ > 4) break;
          inCorner(pick(['wooden_crate_01', 'cardboard_box_01', 'plastic_crate_01']), x, z, rng.int(0, 3));
        }
        const w = walls[0];
        if (w) atWall('sink', w.x, w.z, w.sd, rng.range(-1, 1));
        break;
      }
      case 'lehrerzimmer':
      case 'sekretariat': {
        // Sofa corner with a coffee table — and a chess game nobody finished.
        const [x0, z0] = cells[0]!;
        const sofaWall = solidSides(x0, z0)[0];
        if (use === 'lehrerzimmer' && sofaWall) {
          const sofa = onFloorWall('Sofa_01', x0, z0, sofaWall);
          if (sofa >= 0) {
            // The coffee table by the sofa, with a chess game nobody finished.
            for (let k = 0; k < 4; k++) {
              const t = inCorner('CoffeeTable_01', x0, z0, k, FACE_IN[sofaWall]);
              if (t < 0) continue;
              if (rng.chance(0.75)) onTop('chess_set', t, 0, 0, rng.range(-0.4, 0.4));
              break;
            }
          }
        }
        for (const [x, z] of cells.slice(use === 'lehrerzimmer' ? 1 : 0, 3)) {
          const sd = solidSides(x, z)[0];
          if (!sd) continue;
          const d = onFloorWall('metal_office_desk', x, z, sd);
          if (d >= 0) {
            onTop('desk_lamp_arm_01', d, 0.45, 0.05);
            onTop(pick(['binder_notebook', 'clipboard']), d, -0.3, 0);
            if (use === 'lehrerzimmer' && rng.chance(0.45)) onTop('chess_set', d, 0.05, 0.05, rng.range(0, 6.28));
          }
          inCorner('drawer_cabinet', x, z, rng.int(0, 3), FACE_IN[sd]);
        }
        const w = walls.at(-1);
        if (w) onWallModel(use === 'lehrerzimmer' ? 'dartboard' : 'wall_clock', w.x, w.z, w.sd, rng.range(-0.8, 0.8), use === 'lehrerzimmer' ? 1.6 : 2.4);
        if (cells[1]) inCorner(pick(['potted_plant_04']), cells[1][0], cells[1][1], rng.int(0, 3));
        break;
      }
      case 'wc_damen':
      case 'wc_herren': {
        for (const w of walls) if (atWall('wc_stall', w.x, w.z, w.sd) >= 0) break;
        for (const w of walls) if (atWall('sink', w.x, w.z, w.sd, rng.range(-1, 1)) >= 0) break;
        const [x, z] = cells[0]!;
        if (rng.chance(0.5)) {
          inCorner('WetFloorSign_01', x, z, rng.int(0, 3));
          inCorner('wooden_bucket_01', x, z, rng.int(0, 3));
        }
        break;
      }
      case 'hauswart':
      case 'lager': {
        for (const w of walls.slice(0, 2)) {
          const b = atWall('shelf', w.x, w.z, w.sd, rng.range(-0.8, 0.8));
          if (b < 0) continue;
          for (const dx of [-0.6, 0, 0.6]) if (rng.chance(0.6)) onTop(pick(use === 'hauswart' ? ['multi_cleaner_bottle', 'bleach_bottle', 'metal_toolbox', 'cardboard_box_01'] : ['cardboard_box_01', 'binder_notebook', 'decorative_book_set_01']), b, dx, 0);
        }
        for (const [x, z] of cells) {
          inCorner(pick(use === 'hauswart' ? ['metal_toolbox', 'wooden_ladder', 'wooden_bucket_01', 'trashbag'] : ['cardboard_box_01', 'wooden_crate_01', 'plastic_crate_01']), x, z, rng.int(0, 3));
          inCorner(pick(['cardboard_box_01', 'plastic_crate_01', 'trashbag']), x, z, rng.int(0, 3));
        }
        break;
      }
      case 'mensa': {
        // The food counter along a wall; long tables along the other walls; chairs everywhere.
        let counter = false;
        for (const w of walls) {
          if (!counter && atWall('counter', w.x, w.z, w.sd, rng.range(-0.4, 0.4)) >= 0) {
            counter = true;
            continue;
          }
          const t = onFloorWall('dining_table', w.x, w.z, w.sd, rng.range(-0.5, 0.5));
          if (t >= 0 && rng.chance(0.3)) onTop(pick(['food_apple_01', 'chess_set', 'binder_notebook', 'potted_plant_04']), t, rng.range(-0.4, 0.4), 0);
        }
        for (const [x, z] of cells) {
          for (let k = 0; k < 4; k++) if (rng.chance(0.35)) inCorner(pick(['dining_chair_02', 'plastic_monobloc_chair_01']), x, z, k, rng.range(0, 6.28));
        }
        let k = 0;
        for (const w of walls) {
          if (k++ > 3) break;
          inCorner(pick(['metal_trash_can#rust', 'plastic_crate_01', 'plastic_monobloc_chair_01']), w.x, w.z, rng.int(0, 3));
        }
        break;
      }
      case 'aula': {
        // A stage along one wall; rows of seats (short segments with aisles) facing it.
        let stageSide: Side | null = null;
        for (const w of walls) {
          if (atWall('stage', w.x, w.z, w.sd) >= 0) {
            stageSide = w.sd;
            for (const w2 of walls) if (w2.sd === w.sd && w2 !== w) atWall('stage', w2.x, w2.z, w2.sd);
            break;
          }
        }
        if (stageSide) {
          for (const [x, z] of cells) {
            for (let k = 0; k < 4; k++) {
              const [u, v] = corner(k);
              if (reserved(x, z)) continue;
              const p: PropSlot = { type: 'seat_row', cx: x, cz: z, x: x * S + u, z: z * S + v, r: 0, rot: FACE_IN[stageSide], scale: 1, variant: 0, solid: true, w: 1.1, d: 0.55 };
              const b = boxOf(p);
              if (inCell(x, z, b) && !overlaps(cellIndex(l, x, z), b) && !blocks(x, z, b)) {
                occupy(p);
                push(p);
              }
            }
          }
        }
        break;
      }
      case 'turnhalle': {
        let bars = 0;
        let hoops = 0;
        for (const w of walls) {
          if (bars < 3 && atWall('wall_bars', w.x, w.z, w.sd) >= 0) bars++;
          else if (hoops < 2 && atWall('hoop', w.x, w.z, w.sd, 0, { y: 2.55 }) >= 0) hoops++;
        }
        for (const [x, z] of cells) {
          if (rng.chance(0.25)) {
            const p: PropSlot = { type: 'gym_mat', cx: x, cz: z, x: (x + 0.5) * S + rng.range(-0.4, 0.4), z: (z + 0.5) * S + rng.range(-0.4, 0.4), r: 0, rot: rng.pick([0, Math.PI / 2]), scale: 1, variant: 0, solid: false, w: 2.0, d: 1.0 };
            const b = boxOf(p);
            if (inCell(x, z, b) && !overlaps(cellIndex(l, x, z), b)) {
              occupy(p);
              push(p);
            }
          }
          if (rng.chance(0.3)) onFloor(pick(['football', 'dirty_football']), x, z, rng.range(0.6, S - 0.6), rng.range(0.6, S - 0.6));
        }
        for (const w of walls.slice(0, 2)) onFloorWall('painted_wooden_bench', w.x, w.z, w.sd);
        break;
      }
      case 'mediothek': {
        for (const w of walls) {
          const b = onFloorWall('wooden_bookshelf_worn', w.x, w.z, w.sd);
          if (b >= 0 && rng.chance(0.8)) onTop(pick(['decorative_book_set_01', 'decorative_book_set_01']), b, rng.range(-0.3, 0.3), 0, FACE_IN[w.sd]);
        }
        for (const [x, z] of cells) {
          if (!rng.chance(0.5)) continue;
          const t = inCorner('dining_table', x, z, rng.int(0, 3), 0);
          if (t >= 0) onTop(pick(['decorative_book_set_01', 'decorative_book_set_01', 'chess_set', 'binder_notebook']), t, rng.range(-0.3, 0.3), 0);
        }
        break;
      }
      case 'pausenhalle': {
        for (const w of walls.slice(0, 4)) onFloorWall('painted_wooden_bench', w.x, w.z, w.sd);
        for (const [x, z] of cells) if (rng.chance(0.3)) inCorner(pick(['potted_plant_04', 'metal_trash_can#rust']), x, z, rng.int(0, 3));
        break;
      }
    }
  }

  // Corridors: extinguishers, fire alarms, bins, plants, a camera now and then — and rare scenes.
  let scenes = 0;
  l.cells.forEach((c, i) => {
    if (c.kind !== 'corridor' || i === startI || i === exitI || !isWalkable(c.kind)) return;
    const cx = i % l.width;
    const cz = Math.floor(i / l.width);
    const sides = solidSides(cx, cz);
    if (!sides.length) return;
    const roll = rng.next();
    const sd = pick(sides);
    if (roll < 0.06) onWallModel('fire_alarm', cx, cz, sd, rng.range(-1, 1), 1.45);
    else if (roll < 0.13) inCorner('korean_fire_extinguisher_01', cx, cz, rng.int(0, 3));
    else if (roll < 0.18) inCorner('metal_trash_can#rust', cx, cz, rng.int(0, 3));
    else if (roll < 0.21) inCorner(pick(['potted_plant_04']), cx, cz, rng.int(0, 3));
    else if (roll < 0.24) onWallModel('security_camera_01', cx, cz, sd, rng.chance(0.5) ? -1.6 : 1.6, 3.15);
    else if (roll < 0.26) onWallModel('wall_clock', cx, cz, sd, rng.range(-1, 1), 2.5);
    else if (roll < 0.29) onFloorWall('painted_wooden_bench', cx, cz, sd);
    else if (roll < 0.305 && scenes < 3) {
      // Little scenes: a wheelchair left alone; a mop bucket by a wet-floor sign.
      scenes++;
      if (rng.chance(0.5)) inCorner('wheelchair_01', cx, cz, rng.int(0, 3));
      else {
        const k = rng.int(0, 3);
        inCorner('WetFloorSign_01', cx, cz, k);
        inCorner('wooden_bucket_01', cx, cz, k ^ 1);
      }
    }
  });

  /** Models that belong flush against a wall (sofa, desks, shelves, benches), using their radius. */
  function onFloorWall(model: string, cx: number, cz: number, side: Side, along = 0): number {
    const m = MODEL[model]!;
    if (getEdge(l, cx, cz, side) !== 'solid' || reserved(cx, cz)) return -1;
    const k = m.scale ?? 1;
    const { x, z } = wallSpot(S, cx, cz, side, 0.17 + (m.d * k) / 2, along);
    const p: PropSlot = { type: 'model', model, cx, cz, x, z, r: 0, rot: FACE_IN[side], scale: k, variant: 0, solid: m.solid, w: m.w * k + 0.04, d: m.d * k + 0.04, wall: side };
    const b = boxOf(p);
    if (!inCell(cx, cz, b, 0.14) || overlaps(cellIndex(l, cx, cz), b) || (p.solid && blocks(cx, cz, b))) return -1;
    occupy(p);
    return push(p);
  }
}
