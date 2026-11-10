import { DIR, SIDES, cellIndex, getEdge, inBounds, isPassable, isWalkable, type EdgeArrays } from './grid.ts';
import type { Cell, NavGraph } from './types.ts';

/** Cell adjacency through passable edges, plus BFS distances to the exit (if given). */
export function buildNav(l: EdgeArrays & { cells: Cell[] }, exitIndex = -1): NavGraph {
  const adj: number[][] = l.cells.map(() => []);
  for (let z = 0; z < l.height; z++) {
    for (let x = 0; x < l.width; x++) {
      const i = cellIndex(l, x, z);
      if (!isWalkable(l.cells[i]!.kind)) continue;
      for (const s of SIDES) {
        const nx = x + DIR[s].dx;
        const nz = z + DIR[s].dz;
        if (!inBounds(l, nx, nz)) continue;
        const j = cellIndex(l, nx, nz);
        if (!isWalkable(l.cells[j]!.kind)) continue;
        if (isPassable(getEdge(l, x, z, s))) adj[i]!.push(j);
      }
    }
  }
  return { adj, distToExit: exitIndex >= 0 ? bfs(adj, exitIndex) : [] };
}

export function bfs(adj: number[][], from: number): number[] {
  const dist = new Array<number>(adj.length).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!;
    for (const n of adj[c]!) {
      if (dist[n] === -1) {
        dist[n] = dist[c]! + 1;
        q.push(n);
      }
    }
  }
  return dist;
}

/** Shortest path (cell indices, inclusive) using the distance field. */
export function pathToExit(nav: NavGraph, from: number): number[] {
  const path = [from];
  let c = from;
  while (nav.distToExit[c]! > 0) {
    const next = nav.adj[c]!.find((n) => nav.distToExit[n] === nav.distToExit[c]! - 1);
    if (next === undefined) break;
    path.push(next);
    c = next;
  }
  return path;
}
