/** The exit: a heavy barred gate that looks locked and slides up into the lintel when reached. */
import * as THREE from 'three';
import type { LevelData } from '../gen/types.ts';
import { SIDE_YAW, cellCenter, DIR } from '../gen/grid.ts';

export class ExitGate {
  readonly object = new THREE.Group();
  readonly leaf = new THREE.Group();
  /** World position of the gate centre at floor level. */
  readonly position = new THREE.Vector3();
  /** Unit vector pointing out of the building through the gate. */
  readonly outward = new THREE.Vector3();
  private t = 0;
  opening = false;
  readonly width = 2.4;
  readonly height = 2.9;

  constructor(level: LevelData, material: THREE.Material) {
    const c = cellCenter(level, level.exit.x, level.exit.z);
    const d = DIR[level.exit.side];
    this.position.set(c.x + (d.dx * level.cellSize) / 2, level.elevation, c.z + (d.dz * level.cellSize) / 2);
    this.outward.set(d.dx, 0, d.dz);
    this.object.position.copy(this.position);
    // Pieces are authored along X; side N/S edges run along X, E/W along Z.
    this.object.rotation.y = level.exit.side === 'N' || level.exit.side === 'S' ? 0 : Math.PI / 2;
    void SIDE_YAW;

    const barGeo = new THREE.BoxGeometry(0.07, this.height - 0.05, 0.07);
    const railGeo = new THREE.BoxGeometry(this.width - 0.05, 0.12, 0.09);
    for (let i = 0; i < 11; i++) {
      const bar = new THREE.Mesh(barGeo, material);
      bar.position.set(-this.width / 2 + 0.12 + i * ((this.width - 0.24) / 10), this.height / 2, 0);
      this.leaf.add(bar);
    }
    for (const y of [0.15, 1.2, this.height - 0.15]) {
      const rail = new THREE.Mesh(railGeo, material);
      rail.position.set(0, y, 0);
      this.leaf.add(rail);
    }
    // Chain + padlock: sells "locked".
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.12), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.35 }));
    lock.position.set(0, 1.05, 0.12);
    this.leaf.add(lock);
    this.leaf.traverse((o) => {
      o.castShadow = true;
    });
    this.object.add(this.leaf);
  }

  open() {
    this.opening = true;
  }

  get openAmount(): number {
    return this.t;
  }

  update(dt: number) {
    if (!this.opening || this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / 2.5);
    const e = this.t * this.t * (3 - 2 * this.t);
    this.leaf.position.y = e * (this.height - 0.3);
    // A little shake while it grinds open.
    this.leaf.position.x = this.t < 1 ? Math.sin(this.t * 90) * 0.01 : 0;
  }
}
