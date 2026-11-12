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
import { RobinBody, type RobinTemplate, type Species } from './robinBody.ts';
import { getEdge } from '../gen/grid.ts';
import { DOOR_WIDTH } from '../gen/config.ts';

/**
 * watch  — saw you while another monster is already after you: stands and stares, then backs off
 * stare  — Leo: creeps at you on his knuckles, staring; running or coming close sets him off
 * pound  — Leo: slams the floor (lights stutter, the floor shakes), then listens for footsteps
 * ambush — Leo: waits crouched in a doorway near you, then lunges without a roar
 */
export type MonsterState = 'dormant' | 'patrol' | 'investigate' | 'chase' | 'search' | 'attack' | 'roar' | 'charge' | 'stunned' | 'watch' | 'stare' | 'pound' | 'ambush';

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
  /** Seconds without an encounter before it slips round, out of sight, to a few rooms from you (0 = never). */
  stalkAfter: number;
  /** Hearing multiplier on footstep radii. */
  ears: number;
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
  ears: 1,
};

/**
 * Three monsters, three ways to die:
 *  robin — the hunter: screams near you, chases, keeps reappearing near you.
 *  leo   — the brute: half-blind, sharp ears, stomps you can hear (and feel) from far away; when he
 *          sees you he ROARS, then charges in a straight line faster than you can sprint and can
 *          barely turn — dodge round a corner; if he hits a wall he's stunned for a few seconds.
 *  jovan — the watcher: so tall his head drags along the ceiling; almost silent; he only moves
 *          while you are NOT looking at him — then fast. Lights flicker around him. Long reach.
 */
export const SPECIES_TUNING: Record<Species, MonsterTuning> = {
  robin: DEFAULT_TUNING,
  leo: { walkSpeed: 1.3, chaseSpeed: 6.4, chaseRamp: 0, sightRange: 16, fov: 0.85, catchDistance: 1.6, memory: 1, searchTime: 9, driftEvery: 12, stalkAfter: 18, ears: 1.6 },
  jovan: { walkSpeed: 0.9, chaseSpeed: 4.6, chaseRamp: 0, sightRange: 22, fov: 1.25, catchDistance: 1.9, memory: 4, searchTime: 10, driftEvery: 14, stalkAfter: 26, ears: 1 },
};

export class Monster implements Entity {
  readonly id: string;
  readonly species: Species;
  /** Jovan: you're looking at him right now (he freezes). */
  watched = false;
  private chargeDir = new THREE.Vector3();
  private presenceT = 0;
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
  private tmp2 = new THREE.Vector3();
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
    this.species = robinTpl?.species ?? 'robin';
    this.id = this.species === 'robin' ? 'monster' : `monster-${this.species}`;
    if (tuning === DEFAULT_TUNING) this.tuning = SPECIES_TUNING[this.species];
    this.rng = streamRng(seed, this.species === 'robin' ? 'monster' : `monster:${this.species}`);
    this.nextDrift = this.tuning.driftEvery;
    this.position.copy(spawn);
    if (kind === 'robin' && robinTpl) {
      const r = new RobinBody(robinTpl);
      const stepLoud = this.species === 'leo' ? 1.7 : this.species === 'jovan' ? 0.15 : 1;
      r.onStep = (foot, loud) => bus.emit('monster:step', { x: foot.x, y: foot.y, z: foot.z, floor: this.floor, loud: loud * stepLoud, species: this.species });
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

  /** The sculpted Robin body, if that's the body in use (the jump scare choreographs it). */
  get robinBody(): RobinBody | null {
    return this.robin;
  }

  /** Jump scare: stand at `at` facing `look` and attack (the AI stops). */
  lunge(at: THREE.Vector3, look: THREE.Vector3) {
    this.state = 'attack';
    if (this.robin) this.robin.act = 'none';
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

  /** Debug: put it at `at` (on `floor`), awake, coming to look at `toward`. */
  teleport(at: THREE.Vector3, floor: number, toward: THREE.Vector3) {
    this.position.copy(at);
    this.object.position.copy(at);
    this.floor = floor;
    this.path = [];
    this.lastKnown.copy(toward);
    this.lastEncounter = this.time;
    this.setState('investigate');
  }

  /** Debug: back to sleep (stands still until woken). */
  sleep() {
    this.setState('dormant');
    this.setPose('idle');
    if (this.robin) this.robin.speed = 0;
  }

  wake() {
    if (this.state === 'dormant') this.setState('patrol');
  }

  /** Leo heard your footsteps after a slam: he goes there fast. */
  private rush = false;
  private pounded = false;
  private unseenT = 0;

  private setState(s: MonsterState) {
    const at = { x: this.position.x, y: this.position.y + 2, z: this.position.z, floor: this.floor };
    if (s === 'chase' && this.state !== 'chase' && this.species === 'robin') bus.emit('monster:vocal', { ...at, kind: 'screech' });
    if (s === 'roar') {
      bus.emit('monster:vocal', { ...at, kind: 'roar' });
      this.robin?.scream();
    }
    if (s === 'stunned') bus.emit('monster:vocal', { ...at, kind: 'thud' });
    if (s === 'stare') bus.emit('monster:vocal', { ...at, kind: 'growl' });
    this.state = s;
    this.stateTime = 0;
    this.path = [];
    this.rush = false;
    this.pounded = false;
    if (this.robin) this.robin.act = s === 'roar' ? 'roar' : s === 'stunned' ? 'stunned' : 'none';
  }

  update(dt: number, ctx: EntityContext) {
    this.time += dt;
    this.stateTime += dt;
    this.mixer?.update(dt);
    this.creature?.update(dt);
    this.image?.update(dt, this.eyeTarget.copy(ctx.player.eye));
    if (this.robin) {
      this.robin.duck = this.state !== 'attack' ? this.duckAmount(ctx) : 0;
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
    const sees = !player.invisible && sameFloor && dist < range && inCone && ctx.senses.lineOfSight(eye, player.eye);
    const leo = this.species === 'leo';
    const jovan = this.species === 'jovan';
    const busy = this.state === 'roar' || this.state === 'charge' || this.state === 'stunned' || this.state === 'stare' || this.state === 'pound';
    if (jovan) {
      // You're looking at him: he freezes (and twitches). Look away and he comes.
      const chest = this.tmp2.copy(this.position).setY(this.position.y + 2.2);
      const dir = chest.clone().sub(player.eye);
      const d = dir.length();
      this.watched = !player.invisible && sameFloor && d < 30 && dir.normalize().dot(player.forward) > player.viewCos && ctx.senses.lineOfSight(chest, player.eye);
      if (this.robin) this.robin.frozen = this.watched;
      this.presenceT -= dt;
      if (this.presenceT < 0) {
        this.presenceT = 0.5;
        bus.emit('monster:presence', { x: this.position.x, y: this.position.y, z: this.position.z, floor: this.floor, species: this.species });
      }
    }
    this.unseenT = sees ? 0 : this.unseenT + dt;
    if (sees) {
      this.lastSeen = this.time;
      this.lastEncounter = this.time;
      this.lastKnown.copy(player.position);
      // Someone else is already after you: don't pile on — watch from where it is, then back off.
      const engage = !ctx.othersHunting(this.id) || flat < 4 || this.state === 'chase' || busy;
      if (!engage) {
        if (this.state !== 'watch') this.setState('watch');
      } else if (leo) {
        if (this.state === 'ambush' && flat < 10) {
          // Sprung: no roar, straight at you.
          this.chargeDir.copy(player.position).sub(this.position).setY(0).normalize();
          this.setState('charge');
          bus.emit('monster:vocal', { x: this.position.x, y: this.position.y + 2, z: this.position.z, floor: this.floor, kind: 'roar' });
        } else if (!busy) this.setState(flat > 8 && !player.sprinting ? 'stare' : 'roar');
      } else if (this.state !== 'chase') this.setState('chase');
    } else if (this.state !== 'chase' && !busy && this.state !== 'watch' && this.state !== 'ambush') {
      const heard = player.invisible ? null : ctx.senses.hear(this.position, this.floor, 2, this.tuning.ears);
      if (heard && (this.state !== 'investigate' || heard.pos.distanceTo(this.lastKnown) > 2)) {
        this.lastKnown.copy(heard.pos);
        if (this.state !== 'investigate') this.setState('investigate');
        else this.path = [];
      }
    }

    // ── Jovan, watched: frozen in place ──
    if (jovan && this.watched) {
      this.setPose('idle');
      if (this.robin) this.robin.speed = 0;
      return;
    }
    // ── Leo: roar, charge, stunned, stare-down, floor slam ──
    if (leo && busy) {
      this.leoBusy(dt, ctx, flat, sameFloor, sees, me);
      return;
    }
    // ── watching you (another monster has you): stand, stare, then back off ──
    if (this.state === 'watch') {
      this.setPose('idle');
      if (this.robin) this.robin.speed = 0;
      const toP = this.tmp2.copy(player.position).sub(this.position).setY(0);
      if (toP.lengthSq() > 0.01) this.face(toP.normalize(), dt);
      if (this.stateTime > 3 + this.rng.next() * 2 || (!sees && this.stateTime > 1.2)) {
        this.setState('patrol');
        this.path = ctx.nav.path(me, this.farNode(ctx, 7)).slice(1);
      }
      return;
    }
    // ── Leo lying in wait ──
    if (this.state === 'ambush') {
      if (this.path.length) {
        this.setPose('walk', 0.8);
        if (this.robin) this.robin.speed = this.tuning.walkSpeed;
        this.follow(ctx, dt, this.tuning.walkSpeed);
      } else {
        this.setPose('idle');
        if (this.robin) this.robin.speed = 0;
        this.vocalize(dt, flat, sameFloor, false);
      }
      if (this.stateTime > 28) this.setState('patrol');
      return;
    }

    // ── stalking: the hunter never stays away for long ──
    if (this.tuning.stalkAfter > 0 && ctx.isHunter(this.id) && (this.state === 'patrol' || this.state === 'search') && this.time - this.lastEncounter > this.tuning.stalkAfter && this.stalk(ctx, me)) return;
    // Leo, hunting: sometimes he gets ahead of you and waits in a doorway instead.
    if (leo && ctx.isHunter(this.id) && this.state === 'patrol' && this.time > this.nextDrift - 0.05 && sameFloor && flat < 30 && this.rng.next() < 0.25 && this.setAmbush(ctx, me)) return;

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
      speed *= this.rush ? 3.4 : 1.5;
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
        // Pacing: the hunter drifts towards your area (not your exact cell) so encounters happen;
        // the others roam somewhere else.
        this.nextDrift = this.time + this.tuning.driftEvery * (0.7 + this.rng.next() * 0.6);
        if (ctx.isHunter(this.id)) {
          const pn = ctx.nav.nodeAt(player.position.x, player.position.y, player.position.z);
          const near = ctx.nav.nodesNear(pn, 4).filter((n) => n !== pn);
          if (near.length) this.path = ctx.nav.path(me, this.rng.pick(near)).slice(1);
        } else this.path = ctx.nav.path(me, this.farNode(ctx, 6)).slice(1);
      }
      if (!this.path.length) this.path = ctx.nav.path(me, ctx.nav.randomNode(this.rng, this.floor)).slice(1);
    }

    // ── body + sound ──
    const moving = direct || this.path.length > 0;
    if (this.state === 'chase' || this.rush) this.setPose('run');
    else if (moving) {
      speed *= 0.75 + 0.35 * Math.max(0, Math.sin(this.time * 2.6)); // lurch
      this.setPose('walk', 0.8);
    } else this.setPose('idle');
    if (this.creature) this.creature.speed = speed;
    if (this.robin) this.robin.speed = moving ? speed : 0;
    this.vocalize(dt, flat, sameFloor, moving);

    if (direct) this.moveTowards(player.position, speed, dt);
    else this.follow(ctx, dt, speed);
  }

  /** Leo's roar (stand and bellow), charge (straight line, barely turns) and stun (hit a wall). */
  private leoBusy(dt: number, ctx: EntityContext, flat: number, sameFloor: boolean, sees: boolean, me: number) {
    const player = ctx.player;
    const toP = this.tmp2.copy(player.position).sub(this.position).setY(0);
    if (this.state === 'stare') {
      // Creeping at you on his knuckles, staring. Run, or let him get close, and he goes off.
      this.setPose('walk', 0.6);
      if (this.robin) this.robin.speed = 0.75;
      if (sees) this.lastKnown.copy(player.position);
      if (!this.path.length || this.stateTime % 1 < dt) this.goTo(ctx, me, this.lastKnown);
      this.follow(ctx, dt, 0.75);
      if (toP.lengthSq() > 0.01) this.face(toP.clone().normalize(), dt);
      if (sees && (flat < 7 || player.sprinting || this.stateTime > 4.5)) this.setState('roar');
      else if (this.unseenT > 1.5) this.setState('pound');
      return;
    }
    if (this.state === 'pound') {
      // Slam the floor with both fists, then hold still and listen.
      this.setPose(this.stateTime < 0.9 ? 'attack' : 'idle');
      if (this.robin) this.robin.speed = 0;
      if (!this.pounded && this.stateTime > 0.45) {
        this.pounded = true;
        const at = { x: this.position.x, y: this.position.y, z: this.position.z, floor: this.floor };
        bus.emit('monster:pound', at);
        bus.emit('monster:vocal', { ...at, y: at.y + 1, kind: 'thud' });
      }
      if (this.stateTime > 1.1 && sameFloor && !player.invisible && player.moving && !player.crouching && this.position.distanceTo(player.position) < 22) {
        // Felt your footsteps: he knows exactly where you are, and comes fast.
        this.lastKnown.copy(player.position);
        this.setState('investigate');
        this.rush = true;
        bus.emit('monster:vocal', { x: this.position.x, y: this.position.y + 2, z: this.position.z, floor: this.floor, kind: 'growl' });
        return;
      }
      if (this.stateTime > 3.4) this.setState('search');
      return;
    }
    if (this.state === 'roar') {
      this.setPose('attack');
      if (this.robin) this.robin.speed = 0;
      if (toP.lengthSq() > 0.01) this.face(toP.clone().normalize(), dt);
      if (this.stateTime > 1.15) {
        this.chargeDir.copy(toP.lengthSq() > 0.01 ? toP.normalize() : this.heading);
        this.setState('charge');
      }
      return;
    }
    if (this.state === 'stunned') {
      this.setPose('idle');
      if (this.robin) this.robin.speed = 0;
      if (this.stateTime > 2.4) this.setState('pound');
      return;
    }
    // Charge: steer only a little towards you (≤ 0.55 rad/s); walls stop him cold.
    if (toP.lengthSq() > 0.01) {
      const want = toP.normalize();
      const ang = Math.atan2(this.chargeDir.x * want.z - this.chargeDir.z * want.x, this.chargeDir.dot(want));
      const turn = THREE.MathUtils.clamp(ang, -0.55 * dt, 0.55 * dt);
      this.chargeDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -turn).normalize();
    }
    let speed = this.tuning.chaseSpeed;
    // A doorway ahead: if he's roughly lined up he squeezes through the middle (slowing down);
    // otherwise he runs into the wall beside it.
    const door = this.doorAhead(ctx, 2.6);
    if (door && Math.abs(door.offset) < 1.6) {
      const to = door.centre.clone().sub(this.position).setY(0).normalize();
      const ang = Math.atan2(this.chargeDir.x * to.z - this.chargeDir.z * to.x, this.chargeDir.dot(to));
      this.chargeDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.clamp(ang, -3 * dt, 3 * dt)).normalize();
      speed *= THREE.MathUtils.lerp(0.5, 1, Math.min(1, door.dist / 2.6));
    }
    this.setPose('run');
    if (this.robin) this.robin.speed = speed;
    const next = this.position.clone().addScaledVector(this.chargeDir, speed * dt);
    if (this.blocked(ctx, this.position, next)) {
      this.lastKnown.copy(player.position);
      this.setState('stunned');
      return;
    }
    this.position.copy(next);
    this.face(this.chargeDir, dt);
    if (sameFloor && flat < this.tuning.catchDistance) ctx.catchPlayer(this.id);
    if (this.stateTime > 3.2) {
      this.lastKnown.copy(player.position);
      this.setState('pound');
    }
  }

  /** A random node on its floor at least `cells` away from you (roaming elsewhere). */
  private farNode(ctx: EntityContext, cells: number): number {
    const p = ctx.player.position;
    for (let i = 0; i < 12; i++) {
      const n = ctx.nav.randomNode(this.rng, this.floor);
      if (n >= 0 && ctx.nav.nodePos(n).distanceTo(p) > cells * 4) return n;
    }
    return ctx.nav.randomNode(this.rng, this.floor);
  }

  /** Leo: pick a spot near you, out of your sight, preferably in a doorway, and wait there. */
  private setAmbush(ctx: EntityContext, me: number): boolean {
    const p = ctx.player;
    const pn = ctx.nav.nodeAt(p.position.x, p.position.y, p.position.z);
    if (pn < 0) return false;
    const N = ctx.nav.N;
    const inner = new Set(ctx.nav.nodesNear(pn, 1));
    const cands = ctx.nav.nodesNear(pn, 3).filter((n) => !inner.has(n) && Math.floor(n / N) === p.floor);
    const pos = new THREE.Vector3();
    for (const n of this.rng.shuffle(cands)) {
      ctx.nav.nodePos(n, pos);
      if (ctx.senses.lineOfSight(pos.clone().setY(pos.y + 1.4), p.eye)) continue;
      const path = ctx.nav.path(me, n);
      if (path.length < 2 || path.length > 18) continue;
      this.setState('ambush');
      this.path = path.slice(1);
      return true;
    }
    return false;
  }

  /** Would moving from a to b cross a wall (or leave the walkable floor)? */
  private blocked(ctx: EntityContext, a: THREE.Vector3, b: THREE.Vector3): boolean {
    const l = ctx.building.floors[this.floor];
    if (!l) return true;
    const S = l.cellSize;
    // Keep a body's width off the walls: test a point a little ahead.
    const ahead = b.clone().addScaledVector(this.chargeDir, 0.6);
    const ax = Math.floor(a.x / S);
    const az = Math.floor(a.z / S);
    const bx = Math.floor(ahead.x / S);
    const bz = Math.floor(ahead.z / S);
    if (bx < 0 || bz < 0 || bx >= l.width || bz >= l.height) return true;
    const walk = (x: number, z: number) => {
      const k = l.cells[z * l.width + x]!.kind;
      return k !== 'void' && k !== 'shaft' && k !== 'stair';
    };
    if (!walk(bx, bz)) return true;
    // Doors and broken walls only let him through the opening (minus half his body width), not
    // the wall beside it.
    const half = DOOR_WIDTH / 2 - 0.4;
    const pass = (e: string, off: number) => e === 'open' || ((e === 'door' || e === 'broken' || e === 'exit') && Math.abs(off) < half);
    if (bx !== ax) {
      const ex = (bx > ax ? ax + 1 : ax) * S;
      const zc = a.z + ((ahead.z - a.z) * (ex - a.x)) / (ahead.x - a.x || 1e-6);
      if (!pass(getEdge(l, ax, az, bx > ax ? 'E' : 'W'), zc - (az + 0.5) * S)) return true;
    }
    if (bz !== az) {
      const cx = bx !== ax ? bx : ax;
      const ez = (bz > az ? az + 1 : az) * S;
      const xc = a.x + ((ahead.x - a.x) * (ez - a.z)) / (ahead.z - a.z || 1e-6);
      if (!pass(getEdge(l, cx, az, bz > az ? 'S' : 'N'), xc - (cx + 0.5) * S)) return true;
    }
    return false;
  }

  /** The first doorway (door / broken wall / exit) the charge line crosses within `range`. */
  private doorAhead(ctx: EntityContext, range: number): { centre: THREE.Vector3; offset: number; dist: number } | null {
    const l = ctx.building.floors[this.floor];
    if (!l) return null;
    const S = l.cellSize;
    let cx = Math.floor(this.position.x / S);
    let cz = Math.floor(this.position.z / S);
    const p = new THREE.Vector3();
    for (let d = 0.2; d <= range; d += 0.2) {
      p.copy(this.position).addScaledVector(this.chargeDir, d);
      const nx = Math.floor(p.x / S);
      const nz = Math.floor(p.z / S);
      if (nx === cx && nz === cz) continue;
      const side = nx > cx ? 'E' : nx < cx ? 'W' : nz > cz ? 'S' : 'N';
      if (cx < 0 || cz < 0 || cx >= l.width || cz >= l.height) return null;
      const e = getEdge(l, cx, cz, side);
      if (e === 'door' || e === 'broken' || e === 'exit') {
        const centre = side === 'E' || side === 'W' ? new THREE.Vector3((side === 'E' ? cx + 1 : cx) * S, this.position.y, (cz + 0.5) * S) : new THREE.Vector3((cx + 0.5) * S, this.position.y, (side === 'S' ? cz + 1 : cz) * S);
        const offset = side === 'E' || side === 'W' ? p.z - centre.z : p.x - centre.x;
        return { centre, offset, dist: d };
      }
      if (e !== 'open') return null;
      cx = nx;
      cz = nz;
    }
    return null;
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

  private vocalize(dt: number, flat: number, sameFloor: boolean, moving = false) {
    const at = { x: this.position.x, y: this.position.y + 2, z: this.position.z, floor: this.floor };
    if (this.species === 'jovan') {
      // Almost silent: his head dragging along the ceiling while he moves, now and then a click.
      this.nextVocal -= dt;
      if (this.nextVocal > 0) return;
      this.nextVocal = 1.8 + this.rng.next() * 2.2;
      if (moving) bus.emit('monster:vocal', { ...at, y: this.position.y + 3.4, kind: 'scrape' });
      else if (this.rng.next() < 0.4) bus.emit('monster:vocal', { ...at, kind: 'click' });
      return;
    }
    if (this.species === 'leo') {
      // Heavy breathing far off; a growl that rattles the walls when he's close.
      this.nextVocal -= dt;
      if (this.nextVocal > 0) return;
      const close = sameFloor && flat < 14;
      this.nextVocal = close ? 2.2 + this.rng.next() * 2.5 : 3.5 + this.rng.next() * 3;
      if (close || this.rng.next() < 0.5) bus.emit('monster:vocal', { ...at, kind: close ? 'growl' : 'breath' });
      return;
    }
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
    // Squeeze through doorways: slow down in them.
    this.position.addScaledVector(d, Math.min(len, speed * dt * (1 - 0.4 * (this.robin?.duck ?? 0))));
    this.face(d, dt);
  }

  private face(d: THREE.Vector3, dt: number) {
    if (Math.abs(d.x) + Math.abs(d.z) > 0.1) this.heading.lerp(new THREE.Vector3(d.x, 0, d.z).normalize(), Math.min(1, dt * 8)).normalize();
    this.object.position.copy(this.position);
    this.object.rotation.y = Math.atan2(this.heading.x, this.heading.z);
  }

  /** Robin is 3.1 m tall: crouch under door lintels (2.6 m) and on stairs. */
  /**
   * 0..1: how much to duck. Ramps up from 2.5 m before a doorway (or broken wall / the exit) to
   * fully ducked 0.7 m from it, so the bend starts in time and eases out after; stairs: always.
   */
  private duckAmount(ctx: EntityContext): number {
    const l = ctx.building.floors[this.floor];
    if (!l) return 0;
    const S = l.cellSize;
    const cx = Math.floor(this.position.x / S);
    const cz = Math.floor(this.position.z / S);
    if (cx < 0 || cz < 0 || cx >= l.width || cz >= l.height) return 0;
    if (l.cells[cz * l.width + cx]!.kind === 'stair') return 1;
    const u = this.position.x - cx * S;
    const v = this.position.z - cz * S;
    const door = (side: 'N' | 'E' | 'S' | 'W') => {
      const e = getEdge(l, cx, cz, side);
      return e === 'door' || e === 'broken' || e === 'exit';
    };
    let d = Infinity;
    if (door('N')) d = Math.min(d, v);
    if (door('S')) d = Math.min(d, S - v);
    if (door('W')) d = Math.min(d, u);
    if (door('E')) d = Math.min(d, S - u);
    const fast = this.robin?.speed ?? 0;
    return 1 - THREE.MathUtils.smoothstep(d, 0.7, 2.5 + 0.3 * fast);
  }


  dispose() {
    this.robin?.dispose();
    this.mixer?.stopAllAction();
    this.creature?.dispose();
    this.image?.dispose();
  }
}
