/**
 * The KZU layer on top of a generated floor: wings ("Trakte") named E, 1, 2, 3, 4, room numbers
 * within each wing (E01 … E23, 101 … 123, …), and what every room is used for.
 *
 * Wings are a Voronoi split of the floor around spread-out seeds. Rooms are numbered per wing in
 * reading order along its corridors (row by row from the wing's north-west), so neighbouring doors
 * have neighbouring numbers. Halls become the landmarks (Mensa, Aula, Turnhalle, Mediothek,
 * Pausenhalle); small rooms are WCs, Hauswart, Lager, Sekretariat; the rest are classrooms with a
 * share of labs, Informatik, Musik, BG and the Lehrerzimmer.
 */
import type { Rng } from '../core/rng.ts';
import type { LevelData, Room, RoomUse } from './types.ts';

export const WING_PREFIXES = ['E', '1', '2', '3', '4'] as const;
export type WingPrefix = (typeof WING_PREFIXES)[number];

export interface Wing {
  prefix: WingPrefix;
  /** Centre (cell coordinates). */
  x: number;
  z: number;
}

/** Room number text: "E07", "312". */
export const roomNumber = (prefix: WingPrefix, n: number) => `${prefix}${String(n).padStart(2, '0')}`;

/** German display names for room uses (signs above doors, hall signs). */
export const USE_NAME: Record<RoomUse, string> = {
  classroom: 'Zimmer',
  chemie: 'Chemie',
  physik: 'Physik',
  biologie: 'Biologie',
  informatik: 'Informatik',
  musik: 'Musik',
  bg: 'Bildnerisches Gestalten',
  lehrerzimmer: 'Lehrerzimmer',
  sekretariat: 'Sekretariat',
  wc_damen: 'WC Damen',
  wc_herren: 'WC Herren',
  hauswart: 'Hauswart',
  lager: 'Lager',
  mensa: 'Mensa',
  aula: 'Aula',
  turnhalle: 'Turnhalle',
  pausenhalle: 'Pausenhalle',
  mediothek: 'Mediothek',
};

const HALL_USES: RoomUse[] = ['mensa', 'aula', 'turnhalle', 'mediothek', 'pausenhalle'];
const SPECIAL_USES: RoomUse[] = ['chemie', 'physik', 'biologie', 'informatik', 'musik', 'bg', 'lehrerzimmer'];
const SMALL_USES: RoomUse[] = ['wc_damen', 'wc_herren', 'hauswart', 'lager', 'sekretariat'];

/** Wing of a cell (index into `wings`). */
export function wingAt(wings: Wing[], x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  wings.forEach((w, i) => {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Assign wings, room uses and numbers (mutates `l.rooms`). */
export function assignKzu(l: LevelData, rng: Rng): Wing[] {
  // Wings: jittered seeds on a coarse grid, as many as fit (up to 5).
  const n = l.width * l.height >= 900 ? 5 : 4;
  const cols = n === 5 ? 3 : 2;
  const rows = 2;
  const spots: { x: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) spots.push({ x: ((c + 0.5) / cols) * l.width, z: ((r + 0.5) / rows) * l.height });
  const picked = rng.shuffle(spots).slice(0, n);
  const prefixes = rng.shuffle([...WING_PREFIXES]).slice(0, n) as WingPrefix[];
  // "E" is the wing with the exit (the Eingang / ground-floor feel), when it exists.
  const wings: Wing[] = picked.map((s, i) => ({
    prefix: prefixes[i]!,
    x: s.x + rng.range(-0.15, 0.15) * (l.width / cols),
    z: s.z + rng.range(-0.15, 0.15) * (l.height / rows),
  }));
  if (l.exit.x >= 0) {
    const ew = wingAt(wings, l.exit.x, l.exit.z);
    const e = wings.findIndex((w) => w.prefix === 'E');
    if (e >= 0 && e !== ew) [wings[e]!.prefix, wings[ew]!.prefix] = [wings[ew]!.prefix, wings[e]!.prefix];
  }

  // Uses.
  const rooms = l.rooms.filter((r) => r.kind === 'room');
  const halls = l.rooms.filter((r) => r.kind === 'hall');
  // Biggest halls get the biggest functions.
  const hallOrder = [...halls].sort((a, b) => b.w * b.h - a.w * a.h || a.id - b.id);
  const hallUses = rng.shuffle(HALL_USES.slice(0, 4));
  // Turnhalle and Aula want the biggest spaces.
  hallUses.sort((a, b) => Number(b === 'turnhalle' || b === 'aula') - Number(a === 'turnhalle' || a === 'aula'));
  hallOrder.forEach((h, i) => (h.use = hallUses[i] ?? 'pausenhalle'));
  const specials = rng.shuffle([...SPECIAL_USES]);
  const smalls = rng.shuffle([...SMALL_USES]);
  let si = 0;
  let mi = 0;
  for (const r of rng.shuffle([...rooms])) {
    const area = r.w * r.h;
    if (area <= 2) r.use = smalls[mi++ % smalls.length]!;
    else if (si < specials.length * 2 && rng.chance(0.38)) r.use = specials[si++ % specials.length]!;
    else r.use = 'classroom';
  }

  // Numbers per wing, in reading order (row bands of 3 cells, then x).
  const byWing = new Map<number, Room[]>();
  for (const r of rooms) {
    const w = wingAt(wings, r.x + r.w / 2, r.z + r.h / 2);
    const list = byWing.get(w) ?? [];
    list.push(r);
    byWing.set(w, list);
  }
  for (const [w, list] of byWing) {
    list.sort((a, b) => Math.floor(a.z / 3) - Math.floor(b.z / 3) || a.x - b.x || a.id - b.id);
    list.forEach((r, i) => (r.label = roomNumber(wings[w]!.prefix, i + 1)));
  }
  return wings;
}

/** The text on a door plate: the number, or the hall's name. */
export function plateText(r: Room): string {
  if (r.label) return r.label;
  return r.use ? USE_NAME[r.use] : '';
}
