/**
 * How much sky each cell sees (0 closed … 1 open): ceiling holes and windows let light in,
 * neighbours bleed a little. Drives baked indirect-light occlusion and the eye-adaptation exposure.
 */
import { getEdge } from '../gen/grid.ts';
import type { LevelData } from '../gen/types.ts';

export function computeOpenness(l: LevelData): number[] {
  const own = l.cells.map((c, i) => {
    if (c.kind === 'void') return 1;
    const x = i % l.width;
    const z = Math.floor(i / l.width);
    const windows = (['N', 'E', 'S', 'W'] as const).filter((sd) => getEdge(l, x, z, sd) === 'window').length;
    return Math.min(1, (c.ceiling === 'hole' ? 0.55 : 0) + windows * 0.16);
  });
  return l.cells.map((c, i) => {
    if (c.kind === 'void') return 1;
    let bleed = 0;
    for (const n of l.nav.adj[i] ?? []) bleed = Math.max(bleed, own[n]! * 0.45);
    return Math.min(1, 0.08 + own[i]! + bleed);
  });
}
