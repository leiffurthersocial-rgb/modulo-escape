/**
 * KZU room numbers, like the real school: the prefix is the floor (E = Erdgeschoss, then 1, 2,
 * 3, 4), followed by a two-digit number in reading order across the floor: E01, E02 … 101 … 204.
 */
import type { LevelData } from './types.ts';

export const FLOOR_PREFIXES = ['E', '1', '2', '3', '4'] as const;

/** Room number text: "E07", "312". */
export const roomNumber = (floor: number, n: number) => `${FLOOR_PREFIXES[floor] ?? String(floor)}${String(n).padStart(2, '0')}`;

/** Number every room on the floor (mutates `l.rooms`); halls and stairs get no number. */
export function assignKzu(l: LevelData): void {
  const rooms = l.rooms.filter((r) => r.kind === 'room');
  // Reading order: bands of 3 cells from the north, then west to east.
  rooms.sort((a, b) => Math.floor(a.z / 3) - Math.floor(b.z / 3) || a.x - b.x || a.id - b.id);
  rooms.forEach((r, i) => (r.label = roomNumber(l.floor, i + 1)));
}
