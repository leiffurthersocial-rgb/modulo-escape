/**
 * Autopilot: walks the player along the shortest nav path to the exit.
 * Used by Playwright smoke tests and the /bench route; harmless in normal play (off).
 */
import { cellCenter, cellIndex, worldToCell } from '../gen/grid.ts';
import { pathToExit } from '../gen/nav.ts';
import type { Game } from './game.ts';

export class Autopilot {
  active = false;
  constructor(private game: Game) {}

  /** Call once per frame before the game update. */
  update() {
    if (!this.active) return;
    const { level, player, input, gate } = this.game;
    const f = player.feet;
    const c = worldToCell(level, f.x, f.z);
    const inside = c.x >= 0 && c.z >= 0 && c.x < level.width && c.z < level.height;
    const i = inside ? cellIndex(level, c.x, c.z) : -1;
    let tx: number;
    let tz: number;
    if (i < 0 || level.nav.distToExit[i]! <= 0) {
      // In the exit cell: go through the gate.
      tx = gate.position.x + gate.outward.x * 3;
      tz = gate.position.z + gate.outward.z * 3;
    } else {
      const path = pathToExit(level.nav, i);
      const next = path[1] ?? i;
      const n = cellCenter(level, next % level.width, Math.floor(next / level.width));
      // Aim at the next cell centre; once lined up with the shared edge this passes doorways cleanly.
      const cur = cellCenter(level, c.x, c.z);
      const alongX = Math.abs(n.x - cur.x) > 0.1;
      const off = alongX ? Math.abs(f.z - cur.z) : Math.abs(f.x - cur.x);
      if (off > 0.45) {
        tx = alongX ? f.x : cur.x;
        tz = alongX ? cur.z : f.z;
        if (alongX) tx = f.x + Math.sign(n.x - cur.x) * 0.3;
        else tz = f.z + Math.sign(n.z - cur.z) * 0.3;
      } else {
        tx = n.x;
        tz = n.z;
      }
    }
    const want = Math.atan2(-(tx - f.x), -(tz - f.z));
    let d = want - player.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    player.yaw += d * 0.35;
    player.pitch *= 0.9;
    input.virtualMove.x = 0;
    input.virtualMove.y = Math.abs(d) < 1.2 ? 1 : 0.2;
  }

  stop() {
    this.active = false;
    this.game.input.virtualMove.x = 0;
    this.game.input.virtualMove.y = 0;
  }
}
