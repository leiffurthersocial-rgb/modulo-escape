/**
 * The monster. Body: Robin — the sculpted 3.1 m skinned body with robin.png as its face
 * (src/ai/robinBody.ts) — when robin.png and the GLB are present; else the floating billboard
 * (src/ai/monsterImage.ts), the procedural "Tall One" (src/ai/creature.ts), or a skinned GLB
 * (MONSTER_MODEL_ID) when `kind: 'model'`. Brain: a small state machine on top of the building's
 * nav graph, line of sight and hearing:
 *
 *   dormant → patrol      wanders; every ~9 s drifts towards the player's area; after 14 s without
 *                         an encounter it reappears, unseen, 3–5 cells from the player (any floor)
 *   patrol/search → investigate   heard a noise (footsteps: crouch 1.5 m, walk 5 m, sprint 18 m)
 *   any → chase           sees the player (same floor, view cone, nothing in between; the flashlight
 *                          makes you visible from further away, crouching from less far)
 *   chase                 keeps tracking for 3 s after losing sight, runs straight at you when close,
 *                          speeds up the longer it runs; then goes to the last known spot → search
 *   search                sweeps around for a while → patrol
 *   attack                the jump scare (game takes over)
 *
 * Emits 'monster:step' (audible footsteps) and 'monster:vocal' (breathing, clicks, screech).
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { bus } from '../core/events.ts';
import { streamRng, type Rng } from '../core/rng.ts';
import type { Entity, EntityContext } from './entities.ts';
import type { MonsterModel } from './monsterModel.ts';
import { Creature, type CreatureMode } from './creature.ts';
import { ImageBody, type MonsterImage } from './monsterImage.ts';
import { RobinBody, type RobinTemplate } from './robinBody.ts';
import { getEdge } from '../gen/grid.ts';

export type MonsterState = 'dormant' | 'patrol' | 'investigate' | 'chase' | 'search' | 'attack';

export interface MonsterTuning {
  walkSpeed: number;
  chaseSpeed: number;
  /** Extra chase speed per second of chasing (capped at +30%). */
  chaseRamp: number;
  sightRange: number;
  /** Half-angle of the view cone (radians). */
  fov: number;
  catchDistance: number;
  /** Seconds it keeps tracking you after losing sight. */
  memory: number;
  searchTime: number;
  /** Seconds between drifts towards the player's area while patrolling. */
  driftEvery: number;
  /** Seconds without an encounter before it slips round, out of sight, to a few rooms from you. */
  stalkAfter: number;
}

export const DEFAULT_TUNING: MonsterTuning = {
  walkSpeed: 1.1,
  chaseSpeed: 3.3,
  chaseRamp: 0.03,
  sightRange: 17,
  fov: 1.05,
  catchDistance: 1.1,
  memory: 1.5,
  searchTime: 7,
  driftEvery: 9,
  stalkAfter: 14,
};

export class Monster implements Entity {
  readonly id = 'monster';
  readonly object = new THREE.Group();
  position = new THREE.Vector3();
  floor = 0;
  state: MonsterState = 'dormant';
  private path: number[] = [];
  private target = new THREE.Vector3();
  private lastKnown = new THREE.Vector3();
  private lastSeen = -1e9;
  private stateTime = 0;
  private heading = new THREE.Vector3(0, 0, 1);
  private rng: Rng;
  private tmp = new THREE.Vector3();
  private time = 0;
  private nextDrift: number;
  private nextVocal = 3;
  /** Last time it saw you or reappeared near you (drives stalking). */
  private lastEncounter = 0;
  private creature: Creature | null = null;
  private image: ImageBody | null = null;
  private robin: RobinBody | null = null;
  private eyeTarget = new THREE.Vector3();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(
    seed: string,
    spawn: THREE.Vector3,
    model: MonsterModel | null = null,
    readonly tuning: MonsterTuning = DEFAULT_TUNING,
    kind: 'creature' | 'model' | 'image' | 'robin' = 'creature',
    img: MonsterImage | null = null,
    robinTpl: RobinTemplate | null = null,
  ) {
    this.rng = streamRng(seed, 'monster');
    this.nextDrift = tuning.driftEvery;
    this.position.copy(spawn);
    if (kind === 'robin' && robinTpl) {
      const r = new RobinBody(robinTpl);
      r.onStep = (foot, loud) => bus.emit('monster:step', { x: foot.x, y: foot.y, z: foot.z, floor: this.floor, loud });
      this.object.add(r.object);
      this.robin = r;
    } else if (kind === 'image' && img) {
      this.image = new ImageBody(img);
      this.object.add(this.image.object);
    } else if (kind === 'model' && model) this.buildFromModel(model);
    else this.buildCreature();
    this.object.position.copy(spawn);
    this.setPose('idle');
  }

  private buildCreature() {
    const c = new Creature();
    c.onStep = (foot, loud) => bus.emit('monster:step', { x: foot.x, y: foot.y, z: foot.z, floor: this.floor, loud });
    this.object.add(c.object);
    this.creature = c;
  }

  /** Alternative body: a skinned GLB, measured posed, scaled to 2.3 m and darkened. */
  private buildFromModel(model: MonsterModel) {
    const body = cloneSkinned(model.scene) as THREE.Group;
    body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color.set(0x262a24);
      mat.roughness = 0.42;
      m.material = mat;
    });
    this.object.add(body);
    this.mixer = new THREE.AnimationMixer(body);
    for (const clip of model.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    const measure = () => {
      this.mixer!.update(0);
      this.object.updateMatrixWorld(true);
      body.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.update());
      return new THREE.Box3().setFromObject(body, true);
    };
    this.actions.get('Idle')?.play();
    const box = measure();
    const s = 2.3 / Math.max(0.01, box.max.y - box.min.y);
    body.scale.set(s * 0.8, s, s * 0.8);
    body.position.y -= measure().min.y;
    this.actions.get('Idle')?.stop();
  }

  /** Body pose for both bodies (creature modes / GLB clips). */
  private setPose(mode: CreatureMode, timeScale = 1) {
    if (this.creature) {
      this.creature.mode = mode;
      return;
    }
    if (this.image) {
      this.image.mode = mode;
      return;
    }
    if (this.robin) {
      this.robin.mode = mode;
      return;
    }
    const clip = { idle: 'Idle', walk: 'Walk', run: 'Run_Arms', attack: 'Punch' }[mode];
    const a = this.actions.get(clip);
    if (!a) return;
    a.timeScale = timeScale;
    if (a === this.current) return;
    a.reset().setEffectiveWeight(1).fadeIn(0.3).play();
    this.current?.fadeOut(0.3);
    this.current = a;
  }

  /** Jump scare: stand at `at` facing `look` and attack (the AI stops). */
  lunge(at: THREE.Vector3, look: THREE.Vector3) {
    this.state = 'attack';
    this.path = [];
    this.position.copy(at);
    this.object.position.copy(at);
    this.object.rotation.y = Math.atan2(look.x - at.x, look.z - at.z);
    this.setPose('attack', 1.4);
  }

  /** World position of the head (for the scare camera). */
  headPosition(out: THREE.Vector3): THREE.Vector3 {
    this.object.updateMatrixWorld(true);
    let head: THREE.Object3D | null = null;
    this.object.traverse((o) => {
      if (!head && /^head$/i.test(o.name)) head = o;
    });
    if (head) return (head as THREE.Object3D).getWorldPosition(out).add(new THREE.Vector3(0, 0.1, 0));
    return out.copy(this.position).setY(this.position.y + 2.1);
  }

  wake() {
    if (this.state === 'dormant') this.setState('patrol');
  }

  private setState(s: MonsterState) {
    if (s === 'chase' && this.state !== 'chase') bus.emit('monster:vocal', { x: this.position.x, y: this.position.y + 2, z: this.position.z, floor: this.floor, kind: 'screech' });
    this.state = s;
    this.stateTime = 0;
    this.path = [];
  }

  update(dt: number, ctx: EntityContext) {
    this.time += dt;
    this.stateTime += dt;
    this.mixer?.update(dt);
    this.creature?.update(dt);
    this.image?.update(dt, this.eyeTarget.copy(ctx.player.eye));
    if (this.robin) {
      this.robin.duck = this.needsDuck(ctx) ? 1 : 0;
      this.robin.update(dt, this.eyeTarget.copy(ctx.player.eye));
    }
    if (this.state === 'dormant' || this.state === 'attack') return;
    this.floor = ctx.nav.floorAt(this.position.y);
    const me = ctx.nav.nodeAt(this.position.x, this.position.y, this.position.z);
    const eye = this.tmp.copy(this.position).setY(this.position.y + 2.1);
    const player = ctx.player;

    // ── perception ──
    const toPlayer = player.eye.clone().sub(eye);
    const dist = toPlayer.length();
    const flat = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    const sameFloor = player.floor === this.floor;
    const inCone = toPlayer.clone().setY(0).normalize().dot(this.heading) > Math.cos(this.tuning.fov) || dist < 3;
    const range = this.tuning.sightRange * (player.flashlightOn ? 1.4 : 1) * (player.crouching ? 0.65 : 1);
    const sees = sameFloor && dist < range && inCone && ctx.senses.lineOfSight(eye, player.eye);
    if (sees) {
      this.lastSeen = this.time;
      this.lastEncounter = this.time;
      this.lastKnown.copy(player.position);
      if (this.state !== 'chase') this.setState('chase');
    } else if (this.state !== 'chase') {
      const heard = ctx.senses.hear(this.position, this.floor);
      if (heard && (this.state !== 'investigate' || heard.pos.distanceTo(this.lastKnown) > 2)) {
        this.lastKnown.copy(heard.pos);
        if (this.state !== 'investigate') this.setState('investigate');
        else this.path = [];
      }
    }

    // ── stalking: it never stays away for long ──
    if ((this.state === 'patrol' || this.state === 'search') && this.time - this.lastEncounter > this.tuning.stalkAfter && this.stalk(ctx, me)) return;

    // ── behaviour ──
    let speed = this.tuning.walkSpeed;
    let direct = false;
    if (this.state === 'chase') {
      // Losing it: after a short memory, or at once if you got far away out of sight (sprinting works).
      const tracking = this.time - this.lastSeen < this.tuning.memory && (sees || flat < 12);
      // It knows where you went for a few seconds after losing sight (it heard / smelled you).
      if (tracking) this.lastKnown.copy(player.position);
      speed = this.tuning.chaseSpeed * (1 + Math.min(0.15, this.stateTime * this.tuning.chaseRamp));
      direct = sees && sameFloor && flat < 7;
      if (!tracking) {
        // Lost you: walk (not run) to where it last saw you and look around there.
        this.setState('search');
        this.goTo(ctx, me, this.lastKnown);
      } else if (!direct) this.goTo(ctx, me, this.lastKnown);
      if (sameFloor && flat < this.tuning.catchDistance) ctx.catchPlayer(this.id);
    } else if (this.state === 'investigate') {
      speed *= 1.5;
      this.goTo(ctx, me, this.lastKnown);
      if (!this.path.length || this.position.distanceTo(this.lastKnown) < 1.2) this.setState('search');
    } else if (this.state === 'search') {
      if (!this.path.length) {
        // Sweep: random nodes a couple of cells around the last known spot.
        const near = ctx.nav.nodesNear(ctx.nav.nodeAt(this.lastKnown.x, this.lastKnown.y, this.lastKnown.z), 3);
        const pick = near.length ? this.rng.pick(near) : me;
        this.path = ctx.nav.path(me, pick).slice(1);
      }
      if (this.stateTime > this.tuning.searchTime) this.setState('patrol');
    } else if (this.state === 'patrol') {
      if (this.time > this.nextDrift) {
        // Pacing: drift towards the player's area (not their exact cell) so encounters happen.
        this.nextDrift = this.time + this.tuning.driftEvery * (0.7 + this.rng.next() * 0.6);
        const pn = ctx.nav.nodeAt(player.position.x, player.position.y, player.position.z);
        const near = ctx.nav.nodesNear(pn, 4).filter((n) => n !== pn);
        if (near.length) this.path = ctx.nav.path(me, this.rng.pick(near)).slice(1);
      }
      if (!this.path.length) this.path = ctx.nav.path(me, ctx.nav.randomNode(this.rng, this.floor)).slice(1);
    }

    // ── body + sound ──
    const moving = direct || this.path.length > 0;
    if (this.state === 'chase') this.setPose('run');
    else if (moving) {
      speed *= 0.75 + 0.35 * Math.max(0, Math.sin(this.time * 2.6)); // lurch
      this.setPose('walk', 0.8);
    } else this.setPose('idle');
    if (this.creature) this.creature.speed = speed;
    if (this.robin) this.robin.speed = moving ? speed : 0;
    this.vocalize(dt, flat, sameFloor);

    if (direct) this.moveTowards(player.position, speed, dt);
    else this.follow(ctx, dt, speed);
  }

  /**
   * If it is far from you (other floor or more than ~6 cells away), reappear 3–5 cells from you on
   * your floor, somewhere you can't see, and come looking. Never pops into view.
   */
  private stalk(ctx: EntityContext, me: number): boolean {
    const player = ctx.player;
    const pn = ctx.nav.nodeAt(player.position.x, player.position.y, player.position.z);
    if (pn < 0) return false;
    const close = new Set(ctx.nav.nodesNear(pn, 6));
    if (me >= 0 && close.has(me) && this.floor === player.floor) {
      this.lastEncounter = this.time; // already close by: just keep hunting normally
      return false;
    }
    const inner = new Set(ctx.nav.nodesNear(pn, 2));
    const N = ctx.nav.N;
    const cands = ctx.nav.nodesNear(pn, 5).filter((n) => {
      if (inner.has(n) || Math.floor(n / N) !== player.floor) return false;
      const l = ctx.building.floors[player.floor]!;
      return l.cells[n % N]!.kind !== 'stair';
    });
    const pos = new THREE.Vector3();
    for (const n of this.rng.shuffle(cands)) {
      ctx.nav.nodePos(n, pos);
      const eye = pos.clone().setY(pos.y + 1.6);
      if (ctx.senses.lineOfSight(eye, player.eye)) continue; // you'd see it appear
      this.position.copy(pos);
      this.object.position.copy(pos);
      this.floor = player.floor;
      this.lastEncounter = this.time;
      // Come towards your area (it "smelled" you) and search there — not your exact spot.
      const around = ctx.nav.nodesNear(pn, 2).filter((n) => Math.floor(n / N) === player.floor);
      ctx.nav.nodePos(around.length ? this.rng.pick(around) : pn, this.lastKnown);
      this.setState('investigate');
      bus.emit('monster:vocal', { x: pos.x, y: pos.y + 2, z: pos.z, floor: this.floor, kind: 'screech' });
      return true;
    }
    return false;
  }

  /** Breathing and clicking, more often when close or hunting. */
  /**
   * Sounds: near you on the same floor it screams (more often the closer it is); otherwise it
   * breathes and clicks now and then.
   */
  private wasNear = false;

  private vocalize(dt: number, flat: number, sameFloor: boolean) {
    const near = sameFloor && flat < 12;
    // Coming close: scream soon, don't wait for the idle timer.
    if (near && !this.wasNear) this.nextVocal = Math.min(this.nextVocal, 0.4);
    this.wasNear = near;
    this.nextVocal -= dt;
    if (this.nextVocal > 0) return;
    if (near) {
      this.nextVocal = 1.4 + (flat / 12) * 3.5 + this.rng.next() * 1.5;
      bus.emit('monster:vocal', { x: this.position.x, y: this.position.y + 2, z: this.position.z, floor: this.floor, kind: 'scream' });
      this.robin?.scream();
      return;
    }
    const hunting = this.state === 'chase' || this.state === 'investigate';
    this.nextVocal = (hunting ? 1.6 : 3.2) + this.rng.next() * 3;
    if (!sameFloor && flat > 12) return;
    const kind = this.rng.next() < 0.35 ? 'click' : 'breath';
    bus.emit('monster:vocal', { x: this.position.x, y: this.position.y + 2, z: this.position.z, floor: this.floor, kind });
  }

  private goTo(ctx: EntityContext, me: number, where: THREE.Vector3) {
    const goal = ctx.nav.nodeAt(where.x, where.y, where.z);
    if (goal < 0) return;
    if (!this.path.length || this.path[this.path.length - 1] !== goal) this.path = ctx.nav.path(me, goal).slice(1);
  }

  private moveTowards(p: THREE.Vector3, speed: number, dt: number) {
    const d = this.tmp.set(p.x - this.position.x, 0, p.z - this.position.z);
    const len = d.length();
    if (len < 0.05) return;
    d.divideScalar(len);
    this.position.addScaledVector(d, Math.min(len, speed * dt));
    this.position.y += (p.y - this.position.y) * Math.min(1, dt * 6);
    this.face(d, dt);
  }

  /** Move along the path (walls are respected because the path follows the nav graph). */
  private follow(ctx: EntityContext, dt: number, speed: number) {
    const next = this.path[0];
    if (next === undefined) {
      this.object.position.copy(this.position);
      return;
    }
    ctx.nav.nodePos(next, this.target);
    const d = this.target.clone().sub(this.position);
    const len = d.length();
    if (len < 0.3) {
      this.path.shift();
      return;
    }
    d.divideScalar(len);
    this.position.addScaledVector(d, Math.min(len, speed * dt));
    this.face(d, dt);
  }

  private face(d: THREE.Vector3, dt: number) {
    if (Math.abs(d.x) + Math.abs(d.z) > 0.1) this.heading.lerp(new THREE.Vector3(d.x, 0, d.z).normalize(), Math.min(1, dt * 8)).normalize();
    this.object.position.copy(this.position);
    this.object.rotation.y = Math.atan2(this.heading.x, this.heading.z);
  }

  /** Robin is 3.1 m tall: crouch under door lintels (2.6 m) and on stairs. */
  private needsDuck(ctx: EntityContext): boolean {
    const l = ctx.building.floors[this.floor];
    if (!l) return false;
    const S = l.cellSize;
    const cx = Math.floor(this.position.x / S);
    const cz = Math.floor(this.position.z / S);
    if (cx < 0 || cz < 0 || cx >= l.width || cz >= l.height) return false;
    if (l.cells[cz * l.width + cx]!.kind === 'stair') return true;
    const u = this.position.x - cx * S;
    const v = this.position.z - cz * S;
    const near = 1.5;
    const door = (side: 'N' | 'E' | 'S' | 'W') => {
      const e = getEdge(l, cx, cz, side);
      return e === 'door' || e === 'broken' || e === 'exit';
    };
    return (v < near && door('N')) || (S - v < near && door('S')) || (u < near && door('W')) || (S - u < near && door('E'));
  }

  dispose() {
    this.robin?.dispose();
    this.mixer?.stopAllAction();
    this.creature?.dispose();
    this.image?.dispose();
  }
}
