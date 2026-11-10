/**
 * Greybox kit: every KitId is a list of axis-aligned boxes in piece-local space.
 * The same boxes produce render geometry AND physics colliders, so they always agree.
 * Phase 2 replaces the render side per id with textured modules; colliders can stay.
 *
 * Local frame: origin at floor level in the middle of the piece.
 * Walls run along X (length = cell size), thickness along Z.
 */
import { CELL_SIZE, DOOR_HEIGHT, DOOR_WIDTH, STOREY_HEIGHT, WALL_THICKNESS } from '../gen/config.ts';
import type { KitId } from '../gen/kit.ts';

export type MatKey =
  | 'floor'
  | 'floor_cracked'
  | 'puddle'
  | 'ceiling'
  | 'wall'
  | 'wall_trim'
  | 'window_frame'
  | 'door_frame'
  | 'exit_frame'
  | 'pillar'
  | 'broken';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  mat: MatKey;
  /** Defaults to true. */
  collide?: boolean;
}

const L = CELL_SIZE;
const H = STOREY_HEIGHT;
const T = WALL_THICKNESS;
const SLAB = 0.25;
const h = L / 2;
const t = T / 2;

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MatKey, collide = true): Box => ({
  min: [x0, y0, z0],
  max: [x1, y1, z1],
  mat,
  collide,
});

/** A wall segment with a rectangular opening [ox0,ox1] × [oy0,oy1]. */
function wallWithOpening(ox0: number, ox1: number, oy0: number, oy1: number, frame: MatKey): Box[] {
  const out: Box[] = [];
  out.push(box(-h, 0, -t, ox0, H, t, 'wall'));
  out.push(box(ox1, 0, -t, h, H, t, 'wall'));
  out.push(box(ox0, oy1, -t, ox1, H, t, 'wall'));
  if (oy0 > 0) out.push(box(ox0, 0, -t, ox1, oy0, t, 'wall'));
  // Frame / reveal trims, slightly proud of the wall so they read in greybox.
  const f = 0.08;
  out.push(box(ox0 - f, oy0, -t - 0.02, ox0, oy1, t + 0.02, frame, false));
  out.push(box(ox1, oy0, -t - 0.02, ox1 + f, oy1, t + 0.02, frame, false));
  out.push(box(ox0 - f, oy1, -t - 0.02, ox1 + f, oy1 + f, t + 0.02, frame, false));
  return out;
}

const DW = DOOR_WIDTH / 2;

export const KIT: Record<KitId, Box[]> = {
  floor: [box(-h, -SLAB, -h, h, 0, h, 'floor')],
  floor_cracked: [box(-h, -SLAB, -h, h, 0, h, 'floor_cracked')],
  floor_puddle: [box(-h, -SLAB, -h, h, 0, h, 'floor'), box(-1.75, 0, -1.75, 1.75, 0.006, 1.75, 'puddle', false)],
  ceiling: [box(-h, H, -h, h, H + SLAB, h, 'ceiling')],
  ceiling_hole: [
    // 4 slabs around a 2.0 × 2.0 m hole.
    box(-h, H, -h, h, H + SLAB, -1, 'ceiling'),
    box(-h, H, 1, h, H + SLAB, h, 'ceiling'),
    box(-h, H, -1, -1, H + SLAB, 1, 'ceiling'),
    box(1, H, -1, h, H + SLAB, 1, 'ceiling'),
    box(-1.05, H - 0.15, -1.05, 1.05, H, -1, 'broken', false),
  ],
  wall: [box(-h, 0, -t, h, H, t, 'wall'), box(-h, 0, -t - 0.03, h, 0.15, t + 0.03, 'wall_trim', false)],
  wall_window: wallWithOpening(-1.1, 1.1, 0.95, 2.45, 'window_frame'),
  wall_door: wallWithOpening(-DW, DW, 0, DOOR_HEIGHT, 'door_frame'),
  wall_broken: [
    // Ragged hole: uneven remnants either side, chunk missing at the bottom.
    box(-h, 0, -t, -1.3, H, t, 'wall'),
    box(1.2, 0, -t, h, H, t, 'wall'),
    box(-1.3, 2.3, -t, 1.2, H, t, 'wall'),
    box(-1.3, 1.6, -t, -0.7, 2.3, t, 'broken'),
    box(0.6, 1.9, -t, 1.2, 2.3, t, 'broken'),
    box(-1.3, 0, -t, -0.9, 0.5, t, 'broken'),
  ],
  exit_gate: [
    ...wallWithOpening(-1.2, 1.2, 0, 2.9, 'exit_frame'),
    // The gate leaf itself is a separate animated object (see world/exitGate.ts).
  ],
  pillar: [box(-0.35, 0, -0.35, 0.35, H, 0.35, 'pillar')],
  corner_post: [box(-0.25, 0, -0.25, 0.25, H, 0.25, 'pillar')],
};

/** Rotate a local box by yaw (multiples of 90°) and translate → world AABB. */
export function transformBox(b: Box, x: number, z: number, yaw: number): { min: [number, number, number]; max: [number, number, number] } {
  const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const rot = (px: number, pz: number): [number, number] => {
    switch (q) {
      case 0:
        return [px, pz];
      case 1:
        return [pz, -px];
      case 2:
        return [-px, -pz];
      default:
        return [-pz, px];
    }
  };
  const [ax, az] = rot(b.min[0], b.min[2]);
  const [bx, bz] = rot(b.max[0], b.max[2]);
  return {
    min: [Math.min(ax, bx) + x, b.min[1], Math.min(az, bz) + z],
    max: [Math.max(ax, bx) + x, b.max[1], Math.max(az, bz) + z],
  };
}
