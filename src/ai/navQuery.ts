/**
 * Navigation queries over the generator's building graph (all floors + stairs).
 * Node id = floor * width * height + cell. Pure maths, no rendering: entities ask it for paths,
 * node positions and random reachable places.
 */
import * as THREE from 'three';
import { stairCells, type Building } from '../gen/types.ts';
import { cellIndex, isWalkable } from '../gen/grid.ts';
import type { Rng } from '../core/rng.ts';

export class NavQuery {
  readonly N: number;
  constructor(readonly b: Building) {
    this.N = b.width * b.height;
  }

  floorAt(y: number): number {
    return Math.max(0, Math.min(this.b.floors.length - 1, Math.floor((y + 1.2) / this.b.floorStep)));
  }

  /** Node under a world position, or -1. */
  nodeAt(x: number, y: number, z: number): number {
    const f = this.floorAt(y);
    const cx = Math.floor(x / this.b.cellSize);
    const cz = Math.floor(z / this.b.cellSize);
    if (cx < 0 || cz < 0 || cx >= this.b.width || cz >= this.b.height) return -1;
    const i = cellIndex(this.b, cx, cz);
    // Stair cells belong to the floor the flight starts on.
    for (const ff of [f, f - 1]) {
      const level = this.b.floors[ff];
      if (level && isWalkable(level.cells[i]!.kind)) return ff * this.N + i;
    }
    return -1;
  }

  /** World position of a node's centre at walking height (stair cells follow the ramp). */
  nodePos(node: number, out = new THREE.Vector3()): THREE.Vector3 {
    const f = Math.floor(node / this.N);
    const i = node % this.N;
    const cx = i % this.b.width;
    const cz = Math.floor(i / this.b.width);
    const level = this.b.floors[f]!;
    let y = level.elevation;
    if (level.cells[i]!.kind === 'stair') {
      // U staircase: flight A a quarter up, the landing half way, flight B three quarters.
      const s = this.b.stairs.find((st) => {
        if (st.lower !== f) return false;
        const c = stairCells(st);
        return cx >= c.x0 && cx <= c.x0 + 1 && (cz === st.z || cz === st.z + 1);
      });
      if (s) {
        const c = stairCells(s);
        const frac = cz === c.mid.z ? 0.5 : cx === c.a.x ? 0.25 : 0.75;
        y += frac * this.b.floorStep;
      }
    }
    return out.set((cx + 0.5) * this.b.cellSize, y, (cz + 0.5) * this.b.cellSize);
  }

  neighbors(node: number): number[] {
    return this.b.nav.adj[node] ?? [];
  }

  /** A* path (inclusive), [] if unreachable. */
  path(from: number, to: number): number[] {
    if (from < 0 || to < 0) return [];
    const h = (n: number) => {
      const a = this.nodePos(n);
      const b = this.nodePos(to);
      return Math.abs(a.x - b.x) + Math.abs(a.z - b.z) + Math.abs(a.y - b.y) * 2;
    };
    const g = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const open: [number, number][] = [[h(from), from]];
    const closed = new Set<number>();
    while (open.length) {
      open.sort((p, q) => p[0] - q[0]);
      const [, cur] = open.shift()!;
      if (cur === to) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const n of this.neighbors(cur)) {
        const ng = g.get(cur)! + this.b.cellSize;
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng);
          prev.set(n, cur);
          open.push([ng + h(n), n]);
        }
      }
    }
    if (!g.has(to)) return [];
    const out = [to];
    while (out[0] !== from) out.unshift(prev.get(out[0]!)!);
    return out;
  }

  /** Nodes within `radius` graph steps of `node` (including it). */
  nodesNear(node: number, radius: number): number[] {
    if (node < 0) return [];
    const seen = new Map<number, number>([[node, 0]]);
    const q = [node];
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      const d = seen.get(c)!;
      if (d >= radius) continue;
      for (const n of this.neighbors(c)) {
        if (!seen.has(n)) {
          seen.set(n, d + 1);
          q.push(n);
        }
      }
    }
    return [...seen.keys()];
  }

  /** Random walkable node (optionally on a floor). */
  randomNode(rng: Rng, floor?: number): number {
    const nodes: number[] = [];
    this.b.floors.forEach((l) => {
      if (floor !== undefined && l.floor !== floor) return;
      l.cells.forEach((c, i) => isWalkable(c.kind) && nodes.push(l.floor * this.N + i));
    });
    return nodes.length ? rng.pick(nodes) : -1;
  }
}
