/**
 * Autopilot: walks the player along the shortest path to the exit, across floors and stairs.
 * Used by Playwright smoke tests and the /bench route; off in normal play.
 */
import * as THREE from 'three';
import type { Game } from './game.ts';

export class Autopilot {
  active = false;
  private tmp = new THREE.Vector3();
  constructor(private game: Game) {}

  /** Call once per frame before the game update. */
  update() {
    if (!this.active) return;
    const { nav, player, input, gate, building } = this.game;
    const f = player.feet;
    const node = nav.nodeAt(f.x, f.y, f.z);
    let tx: number;
    let tz: number;
    const d = node >= 0 ? building.nav.distToExit[node]! : -1;
    if (node < 0 || d <= 0) {
      // In the exit cell (or outside): go through the gate.
      tx = gate.position.x + gate.outward.x * 3;
      tz = gate.position.z + gate.outward.z * 3;
    } else {
      const next = nav.neighbors(node).find((n) => building.nav.distToExit[n] === d - 1) ?? node;
      const cur = nav.nodePos(node, new THREE.Vector3());
      const n = nav.nodePos(next, this.tmp);
      // Line up with the shared edge before crossing it (doorways, stair entrances).
      const alongX = Math.abs(n.x - cur.x) > 0.1;
      const off = alongX ? Math.abs(f.z - cur.z) : Math.abs(f.x - cur.x);
      if (off > 0.45) {
        tx = alongX ? f.x + Math.sign(n.x - cur.x) * 0.3 : cur.x;
        tz = alongX ? cur.z : f.z + Math.sign(n.z - cur.z) * 0.3;
      } else {
        tx = n.x;
        tz = n.z;
      }
    }
    const want = Math.atan2(-(tx - f.x), -(tz - f.z));
    let dy = want - player.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    player.yaw += dy * 0.35;
    player.pitch *= 0.9;
    input.virtualMove.x = 0;
    input.virtualMove.y = Math.abs(dy) < 1.2 ? 1 : 0.2;
  }

  stop() {
    this.active = false;
    this.game.input.virtualMove.x = 0;
    this.game.input.virtualMove.y = 0;
  }
}
