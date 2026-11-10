import { cellIndex, getEdge } from './grid.ts';
import type { EdgeKind, LevelData } from './types.ts';

const H: Record<EdgeKind, string> = { none: '   ', solid: '───', window: '┄┄┄', door: '   ', open: '   ', broken: ' ╳ ', exit: '▓▓▓' };
const V: Record<EdgeKind, string> = { none: ' ', solid: '│', window: '┆', door: ' ', open: ' ', broken: '╳', exit: '▓' };

/** Debug rendering of a level: S start, X exit, · corridor, ░ room, ▒ hall, ◘ ceiling hole. */
export function asciiMap(l: LevelData): string {
  const lines: string[] = [];
  for (let z = 0; z <= l.height; z++) {
    let top = '';
    for (let x = 0; x < l.width; x++) {
      top += '+' + H[z < l.height ? getEdge(l, x, z, 'N') : getEdge(l, x, z - 1, 'S')];
    }
    lines.push(top + '+');
    if (z === l.height) break;
    let row = '';
    for (let x = 0; x <= l.width; x++) {
      row += V[x < l.width ? getEdge(l, x, z, 'W') : getEdge(l, x - 1, z, 'E')];
      if (x === l.width) break;
      const c = l.cells[cellIndex(l, x, z)]!;
      let ch = c.kind === 'void' ? '   ' : c.kind === 'corridor' ? ' · ' : c.kind === 'hall' ? '▒▒▒' : '░░░';
      if (c.ceiling === 'hole' && c.kind !== 'void') ch = ch[0] + '◘' + ch[2];
      if (x === l.start.x && z === l.start.z) ch = ' S ';
      if (x === l.exit.x && z === l.exit.z) ch = ' X ';
      row += ch;
    }
    lines.push(row);
  }
  return lines.join('\n');
}
