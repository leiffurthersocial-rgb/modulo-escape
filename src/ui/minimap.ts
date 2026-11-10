/**
 * Fog-of-war minimap (off by default). Shows cells you have been in and seen into
 * (one passable step away), walls, doors, and the exit once discovered.
 */
import { cellIndex, DIR, getEdge, SIDES } from '../gen/grid.ts';
import type { LevelData } from '../gen/types.ts';

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private seen: Uint8Array;
  private nextDraw = 0;
  visible = false;

  constructor(
    parent: HTMLElement,
    private level: LevelData,
  ) {
    this.canvas.className = 'minimap';
    this.canvas.width = 400;
    this.canvas.height = 400;
    this.canvas.hidden = true;
    this.ctx = this.canvas.getContext('2d')!;
    this.seen = new Uint8Array(level.width * level.height);
    parent.appendChild(this.canvas);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.canvas.hidden = !v;
    this.nextDraw = 0;
  }

  /** Mark the player's cell and its directly connected neighbours as seen. */
  reveal(x: number, z: number) {
    const l = this.level;
    if (x < 0 || z < 0 || x >= l.width || z >= l.height) return;
    const i = cellIndex(l, x, z);
    this.seen[i] = 2;
    for (const n of l.nav.adj[i] ?? []) if (!this.seen[n]) this.seen[n] = 1;
    // Rooms reveal entirely when entered.
    const room = l.cells[i]!.room;
    if (room >= 0) l.cells.forEach((c, j) => c.room === room && (this.seen[j] = Math.max(this.seen[j]!, 1)));
  }

  draw(px: number, pz: number, yaw: number, now: number) {
    if (!this.visible || now < this.nextDraw) return;
    this.nextDraw = now + 100;
    const l = this.level;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const scale = W / (Math.max(l.width, l.height) * l.cellSize * 0.55);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    // Centre on the player.
    ctx.setTransform(scale, 0, 0, scale, W / 2 - px * scale, W / 2 - pz * scale);
    const S = l.cellSize;
    for (let z = 0; z < l.height; z++) {
      for (let x = 0; x < l.width; x++) {
        const s = this.seen[cellIndex(l, x, z)]!;
        if (!s) continue;
        ctx.fillStyle = s === 2 ? 'rgba(200,196,180,0.55)' : 'rgba(200,196,180,0.25)';
        ctx.fillRect(x * S, z * S, S, S);
      }
    }
    ctx.lineWidth = 0.5;
    for (let z = 0; z < l.height; z++) {
      for (let x = 0; x < l.width; x++) {
        if (!this.seen[cellIndex(l, x, z)]) continue;
        for (const side of SIDES) {
          const e = getEdge(l, x, z, side);
          if (e === 'open' || e === 'none') continue;
          ctx.strokeStyle = e === 'exit' ? '#e0483c' : e === 'door' ? '#c99a4e' : e === 'window' ? '#5fa2c9' : e === 'broken' ? '#9a8a74' : '#e8e6df';
          if (e === 'door' || e === 'broken') ctx.setLineDash([0.6, 0.6]);
          else ctx.setLineDash([]);
          const d = DIR[side];
          const cx = (x + 0.5) * S + (d.dx * S) / 2;
          const cz = (z + 0.5) * S + (d.dz * S) / 2;
          ctx.beginPath();
          if (d.dx) {
            ctx.moveTo(cx, z * S);
            ctx.lineTo(cx, (z + 1) * S);
          } else {
            ctx.moveTo(x * S, cz);
            ctx.lineTo((x + 1) * S, cz);
          }
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);
    // Player arrow.
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#d8b04a';
    ctx.beginPath();
    ctx.moveTo(0, -1.6);
    ctx.lineTo(1, 1);
    ctx.lineTo(-1, 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
