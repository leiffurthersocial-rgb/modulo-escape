/**
 * Rapier world. Static colliders for the whole level are created once from the same kit
 * boxes the renderer uses (cheap cuboids; the player can never fall through an unloaded chunk).
 * Barrels are dynamic bodies the player can shove; other solid props are fixed.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { LevelData } from '../gen/types.ts';
import type { KitPiece } from '../gen/kit.ts';
import { KIT, transformBox } from '../kit/greybox.ts';

let initPromise: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

export { RAPIER };

export class PhysicsWorld {
  readonly world: RAPIER.World;
  /** Prop index → dynamic body (barrels). */
  readonly dynamicProps = new Map<number, RAPIER.RigidBody>();
  private gateCollider: RAPIER.Collider | null = null;
  staticColliderCount = 0;

  constructor(level: LevelData, pieces: KitPiece[], stepHz = 60) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / stepHz;
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    for (const p of pieces) {
      for (const b of KIT[p.id]) {
        if (b.collide === false) continue;
        const a = transformBox(b, p.x, p.z, p.yaw);
        this.addBox(fixed, a.min, a.max);
      }
    }
    // Ground outside the building (so you can walk out of the exit).
    const W = level.width * level.cellSize;
    const D = level.height * level.cellSize;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(W / 2 + 150, 0.5, D / 2 + 150).setTranslation(W / 2, -0.76, D / 2),
      fixed,
    );

    level.props.forEach((p, i) => {
      if (!p.solid) return;
      if (p.type === 'barrel') {
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, 0.45 * p.scale, p.z).setLinearDamping(0.6).setAngularDamping(0.8).setCanSleep(true).setSleeping(true),
        );
        this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.45 * p.scale, 0.3 * p.scale).setDensity(60).setFriction(0.7), body);
        this.dynamicProps.set(i, body);
      } else {
        const h = p.type === 'desk' ? 0.75 : p.type === 'chair' ? 0.85 : 0.6;
        this.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, p.r * p.scale * 0.9).setTranslation(p.x, h / 2, p.z), fixed);
      }
    });
  }

  private addBox(body: RAPIER.RigidBody, min: number[], max: number[]) {
    const hx = (max[0]! - min[0]!) / 2;
    const hy = (max[1]! - min[1]!) / 2;
    const hz = (max[2]! - min[2]!) / 2;
    if (hx <= 0 || hy <= 0 || hz <= 0) return null;
    this.staticColliderCount++;
    return this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(min[0]! + hx, min[1]! + hy, min[2]! + hz),
      body,
    );
  }

  /** Blocks the exit opening until the gate opens. */
  setGateBlocker(center: { x: number; z: number }, alongX: boolean, width: number, height: number) {
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const hx = alongX ? width / 2 : 0.15;
    const hz = alongX ? 0.15 : width / 2;
    this.gateCollider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, height / 2, hz).setTranslation(center.x, height / 2, center.z), fixed);
  }

  removeGateBlocker() {
    if (this.gateCollider) {
      this.world.removeCollider(this.gateCollider, true);
      this.gateCollider = null;
    }
  }

  step() {
    this.world.step();
  }

  dispose() {
    this.world.free();
  }
}
