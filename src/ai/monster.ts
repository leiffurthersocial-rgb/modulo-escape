/**
 * The monster: Quaternius' CC0 zombie made tall, gaunt and dark with glowing eyes (placeholder capsule
 * if the model is missing). On by default (Settings → Monster, or ?monster=off). Swap the model in
 * MONSTER_MODEL_ID; the senses, nav and catch hooks stay.
 *
 * States: dormant → patrol (random reachable nodes) → investigate (last heard noise) →
 * chase (sees the player) → search (lost them; sweeps around the last known position) → patrol.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { streamRng, type Rng } from '../core/rng.ts';
import type { Entity, EntityContext } from './entities.ts';
import type { MonsterModel } from './monsterModel.ts';

export type MonsterState = 'dormant' | 'patrol' | 'investigate' | 'chase' | 'search' | 'attack';

export interface MonsterTuning {
  walkSpeed: number;
  chaseSpeed: number;
  sightRange: number;
  /** Half-angle of the view cone (radians). */
  fov: number;
  catchDistance: number;
  searchTime: number;
}

export const DEFAULT_TUNING: MonsterTuning = { walkSpeed: 1.3, chaseSpeed: 3.9, sightRange: 16, fov: 1.0, catchDistance: 1.0, searchTime: 10 };

export class Monster implements Entity {
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
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private time = 0;

  constructor(
    seed: string,
    spawn: THREE.Vector3,
    model: MonsterModel | null = null,
    readonly tuning: MonsterTuning = DEFAULT_TUNING,
  ) {
    this.rng = streamRng(seed, 'monster');
    this.position.copy(spawn);
    if (model) this.buildFromModel(model);
    else this.buildPlaceholder();
    this.object.position.copy(spawn);
    this.play('Idle');
  }

  /** Tall, gaunt and dark: the stylised zombie pushed towards horror. */
  private buildFromModel(model: MonsterModel) {
    const body = cloneSkinned(model.scene) as THREE.Group;
    body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false; // skinned bounds don't follow the animation
      // Near-black, wet skin: the cartoon colours are mostly desaturated away and only a
      // greenish sheen survives in the flashlight.
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color.set(0x262a24);
      mat.roughness = 0.42;
      mat.metalness = 0;
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.25) * vec3(0.85, 0.95, 0.85);`,
        );
      };
      mat.customProgramCacheKey = () => 'monster-skin';
      m.material = mat;
    });
    this.object.add(body);
    this.mixer = new THREE.AnimationMixer(body);
    for (const clip of model.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    // Measure the *posed* skinned mesh (bones applied), then scale to 2.15 m, gaunt, feet on y = 0.
    const measure = () => {
      this.mixer!.update(0);
      this.object.updateMatrixWorld(true);
      body.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.update());
      return new THREE.Box3().setFromObject(body, true);
    };
    this.actions.get('Idle')?.play();
    const box = measure();
    const h = Math.max(0.01, box.max.y - box.min.y);
    const s = 2.15 / h;
    body.scale.set(s * 0.8, s * 1.2, s * 0.8);
    const posed = measure();
    body.position.y -= posed.min.y;
    body.updateMatrixWorld(true);
    this.actions.get('Idle')?.stop();
    // Glowing eyes on the head bone.
    let head: THREE.Object3D | null = null;
    body.traverse((o) => {
      if (!head && /^head$/i.test(o.name)) head = o;
    });
    if (head) {
      const hb = head as THREE.Object3D;
      const hp = hb.getWorldPosition(new THREE.Vector3());
      const ws = hb.getWorldScale(new THREE.Vector3()).x || 1;
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyeMat);
        const wp = hp.clone().add(new THREE.Vector3(side * 0.07, 0.1, 0.26));
        eye.position.copy(hb.worldToLocal(wp));
        eye.scale.setScalar(1 / ws);
        hb.add(eye);
      }
      const glow = new THREE.PointLight(0xff9a60, 0.6, 2.2, 2);
      glow.position.copy(hb.worldToLocal(hp.clone().add(new THREE.Vector3(0, 0.05, 0.3))));
      hb.add(glow);
    }
  }

  private buildPlaceholder() {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.5, 4, 10), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 }));
    body.position.y = 1.1;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    eyes.position.set(0, 1.7, 0.33);
    this.object.add(body, eyes);
  }

  private play(name: string, timeScale = 1, fade = 0.35) {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = timeScale;
    if (a === this.current) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = a;
  }

  /** Jump scare: stand at `at` facing `look` and attack (the AI stops). */
  lunge(at: THREE.Vector3, look: THREE.Vector3) {
    this.state = 'attack';
    this.path = [];
    this.position.copy(at);
    this.object.position.copy(at);
    this.object.rotation.y = Math.atan2(look.x - at.x, look.z - at.z);
    this.play('Punch', 1.4, 0.05);
    setTimeout(() => this.state === 'attack' && this.play('Idle_Attack', 1.2, 0.15), 450);
  }

  /** World position of the head (for the scare camera); falls back to a fixed height. */
  headPosition(out: THREE.Vector3): THREE.Vector3 {
    let head: THREE.Object3D | null = null;
    this.object.traverse((o) => {
      if (!head && /^head$/i.test(o.name)) head = o;
    });
    this.object.updateMatrixWorld(true);
    if (head) return (head as THREE.Object3D).getWorldPosition(out);
    return out.copy(this.position).setY(this.position.y + 1.9);
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
    this.time += dt;
    this.mixer?.update(dt);
    if (this.state === 'dormant' || this.state === 'attack') return;
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
    // Lurch: speed swells and drops with each step; the chase is a relentless arms-out run.
    if (this.state === 'chase') this.play('Run_Arms', 1.05);
    else if (this.path.length) {
      speed *= 0.75 + 0.35 * Math.max(0, Math.sin(this.time * 2.6));
      this.play('Walk', 0.8);
    } else this.play('Idle', 0.7);
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
    this.mixer?.stopAllAction();
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.Material).dispose();
    });
  }
}
