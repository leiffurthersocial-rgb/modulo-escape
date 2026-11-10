/**
 * Monster stub: the full state machine and movement plumbing, deliberately simple. Off by default
 * (enable with ?monster=stub for testing). The real monster (model, animation, audio, tuning)
 * replaces the placeholder body and the per-state behaviour; the senses, nav and catch hooks stay.
 *
 * States: dormant → patrol (random reachable nodes) → investigate (last heard noise) →
 * chase (sees the player) → search (lost them; sweeps around the last known position) → patrol.
 */
import * as THREE from 'three';
import { streamRng, type Rng } from '../core/rng.ts';
import type { Entity, EntityContext } from './entities.ts';

export type MonsterState = 'dormant' | 'patrol' | 'investigate' | 'chase' | 'search';

export interface MonsterTuning {
  walkSpeed: number;
  chaseSpeed: number;
  sightRange: number;
  /** Half-angle of the view cone (radians). */
  fov: number;
  catchDistance: number;
  searchTime: number;
}

export const DEFAULT_TUNING: MonsterTuning = { walkSpeed: 1.6, chaseSpeed: 4.6, sightRange: 18, fov: 1.1, catchDistance: 1.0, searchTime: 9 };

export class MonsterStub implements Entity {
  readonly id = 'monster';
  readonly object = new THREE.Group();
  position = new THREE.Vector3();
  floor = 0;
  state: MonsterState = 'dormant';
  private path: number[] = [];
  private target = new THREE.Vector3();
  private lastKnown = new THREE.Vector3();
  private stateTime = 0;
  private heading = new THREE.Vector3(0, 0, 1);
  private rng: Rng;
  private tmp = new THREE.Vector3();

  constructor(
    seed: string,
    spawn: THREE.Vector3,
    readonly tuning: MonsterTuning = DEFAULT_TUNING,
  ) {
    this.rng = streamRng(seed, 'monster');
    this.position.copy(spawn);
    // Placeholder body: a dark, tall capsule with faint eyes.
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.5, 4, 10), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 }));
    body.position.y = 1.1;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    eyes.position.set(0, 1.7, 0.33);
    this.object.add(body, eyes);
    this.object.position.copy(spawn);
  }

  wake() {
    if (this.state === 'dormant') this.setState('patrol');
  }

  private setState(s: MonsterState) {
    this.state = s;
    this.stateTime = 0;
    this.path = [];
  }

  update(dt: number, ctx: EntityContext) {
    this.stateTime += dt;
    if (this.state === 'dormant') return;
    this.floor = ctx.nav.floorAt(this.position.y);
    const me = ctx.nav.nodeAt(this.position.x, this.position.y, this.position.z);
    const eye = this.tmp.copy(this.position).setY(this.position.y + 1.7);

    // ── perception ──
    const toPlayer = ctx.player.eye.clone().sub(eye);
    const dist = toPlayer.length();
    const inCone = toPlayer.clone().normalize().dot(this.heading) > Math.cos(this.tuning.fov) || dist < 2.5;
    const range = this.tuning.sightRange * (ctx.player.flashlightOn ? 1.4 : 1) * (ctx.player.crouching ? 0.6 : 1);
    const sees = Math.abs(ctx.player.floor - this.floor) <= 0 && dist < range && inCone && ctx.senses.lineOfSight(eye, ctx.player.eye);
    if (sees) {
      this.lastKnown.copy(ctx.player.position);
      if (this.state !== 'chase') this.setState('chase');
    } else if (this.state === 'patrol' || this.state === 'search') {
      const heard = ctx.senses.hear(this.position, this.floor);
      if (heard) {
        this.lastKnown.copy(heard.pos);
        this.setState('investigate');
      }
    }

    // ── behaviour ──
    let speed = this.tuning.walkSpeed;
    if (this.state === 'chase') {
      speed = this.tuning.chaseSpeed;
      if (!sees && this.stateTime > 1.5) this.setState('search');
      this.goTo(ctx, me, this.lastKnown);
      if (dist < this.tuning.catchDistance + 0.6) ctx.catchPlayer(this.id);
    } else if (this.state === 'investigate') {
      this.goTo(ctx, me, this.lastKnown);
      if (!this.path.length || this.position.distanceTo(this.lastKnown) < 1.2) this.setState('search');
    } else if (this.state === 'search') {
      if (!this.path.length) {
        const n = ctx.nav.neighbors(me);
        const pick = n.length ? this.rng.pick(n) : me;
        this.path = [pick];
      }
      if (this.stateTime > this.tuning.searchTime) this.setState('patrol');
    } else if (this.state === 'patrol' && !this.path.length) {
      this.path = ctx.nav.path(me, ctx.nav.randomNode(this.rng)).slice(1);
    }
    this.follow(ctx, dt, speed);
  }

  private goTo(ctx: EntityContext, me: number, where: THREE.Vector3) {
    const goal = ctx.nav.nodeAt(where.x, where.y, where.z);
    if (goal < 0) return;
    if (!this.path.length || this.path[this.path.length - 1] !== goal) this.path = ctx.nav.path(me, goal).slice(1);
  }

  /** Move along the path at `speed` (kinematic; walls are respected because the path follows the nav graph). */
  private follow(ctx: EntityContext, dt: number, speed: number) {
    const next = this.path[0];
    if (next === undefined) return;
    ctx.nav.nodePos(next, this.target);
    const d = this.target.clone().sub(this.position);
    const len = d.length();
    if (len < 0.3) {
      this.path.shift();
      return;
    }
    const step = Math.min(len, speed * dt);
    d.divideScalar(len);
    this.position.addScaledVector(d, step);
    if (Math.abs(d.x) + Math.abs(d.z) > 0.1) this.heading.set(d.x, 0, d.z).normalize();
    this.object.position.copy(this.position);
    this.object.rotation.y = Math.atan2(this.heading.x, this.heading.z);
  }

  dispose() {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}
