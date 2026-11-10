/**
 * First-person player: Rapier kinematic character controller with a capsule.
 * Walk / sprint / crouch (with headroom check), gravity, step-up, snap-to-ground,
 * shoving barrels, head-bob, flashlight. Physics runs at a fixed step; the camera
 * interpolates between the last two physics states.
 */
import * as THREE from 'three';
import { RAPIER, type PhysicsWorld } from '../physics/physicsWorld.ts';
import type { Input } from '../input/input.ts';
import { settings } from '../game/settings.ts';
import { bus } from '../core/events.ts';

const RADIUS = 0.32;
const STAND_HEIGHT = 1.75;
const CROUCH_HEIGHT = 1.1;
const EYE_STAND = 1.62;
const EYE_CROUCH = 0.98;
const WALK = 3.0;
const SPRINT = 5.4;
const CROUCH_SPEED = 1.5;
const ACCEL = 14;
const GRAVITY = 20;

const halfH = (h: number) => (h - 2 * RADIUS) / 2;

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly flashlight: THREE.SpotLight;
  yaw = 0;
  pitch = 0;
  crouching = false;
  sprinting = false;
  /** Feet position (physics state, current and previous for interpolation). */
  readonly feet = new THREE.Vector3();
  private prevFeet = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private vy = 0;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private eye = EYE_STAND;
  private bobPhase = 0;
  private bobAmount = 0;
  grounded = true;

  constructor(
    private physics: PhysicsWorld,
    spawn: { x: number; z: number },
    yaw: number,
    fov: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 250);
    this.camera.rotation.order = 'YXZ';
    this.yaw = yaw;
    const w = physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, STAND_HEIGHT / 2 + 0.02, spawn.z),
    );
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(halfH(STAND_HEIGHT), RADIUS).setFriction(0), this.body);
    this.controller = w.createCharacterController(0.02);
    this.controller.enableAutostep(0.32, 0.15, false);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(70);
    this.feet.set(spawn.x, 0, spawn.z);
    this.prevFeet.copy(this.feet);

    this.flashlight = new THREE.SpotLight(0xfff4e0, 0, 28, 0.48, 0.55, 1.6);
    this.flashlight.position.set(0.18, -0.12, 0);
    this.flashlight.target.position.set(0.05, -0.1, -1);
    this.camera.add(this.flashlight, this.flashlight.target);
  }

  get height(): number {
    return this.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  }

  setFlashlight(on: boolean) {
    this.flashlight.intensity = on ? 38 : 0;
    bus.emit('player:flashlight', { on });
  }

  get flashlightOn(): boolean {
    return this.flashlight.intensity > 0;
  }

  /** Apply look deltas (pixels). */
  look(dx: number, dy: number) {
    const k = 0.0022 * settings.sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
  }

  /** Fixed-step simulation. */
  step(dt: number, input: Input) {
    this.prevFeet.copy(this.feet);

    // Crouch toggle-on-hold, with a headroom check before standing.
    const wantCrouch = input.isDown('crouch');
    if (wantCrouch !== this.crouching) {
      if (wantCrouch || this.canStand()) this.setCrouch(wantCrouch);
    }
    const mv = input.moveVector();
    this.sprinting = input.isDown('sprint') && !this.crouching && mv.y > 0.2;
    const speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;

    // Desired horizontal velocity in world space.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;
    const tx = (fx * mv.y + rx * mv.x) * speed;
    const tz = (fz * mv.y + rz * mv.x) * speed;
    const a = 1 - Math.exp(-ACCEL * dt);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.z += (tz - this.vel.z) * a;

    this.vy = this.grounded ? -1 : this.vy - GRAVITY * dt;
    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    this.body.setNextKinematicTranslation(next);
    // Actual velocity (after collisions) drives head-bob.
    this.vel.x = m.x / dt;
    this.vel.z = m.z / dt;
    this.feet.set(next.x, next.y - this.height / 2, next.z);

    // Head-bob.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.bobPhase += hs * dt * (this.sprinting ? 2.2 : 2.6);
    this.bobAmount += ((this.grounded && hs > 0.3 ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 6);
    // Eye height eases between stand and crouch.
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);
  }

  private setCrouch(c: boolean) {
    const t = this.body.translation();
    const oldH = this.height;
    this.crouching = c;
    const newH = this.height;
    this.collider.setShape(new RAPIER.Capsule(halfH(newH), RADIUS));
    // Keep the feet where they are.
    this.body.setTranslation({ x: t.x, y: t.y - oldH / 2 + newH / 2, z: t.z }, true);
    bus.emit('player:crouch', { on: c });
  }

  private canStand(): boolean {
    const t = this.body.translation();
    const feetY = t.y - this.height / 2;
    let blocked = false;
    this.physics.world.intersectionsWithShape(
      { x: t.x, y: feetY + STAND_HEIGHT / 2 + 0.03, z: t.z },
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Capsule(halfH(STAND_HEIGHT), RADIUS - 0.02),
      () => {
        blocked = true;
        return false;
      },
      undefined,
      undefined,
      this.collider,
      this.body,
    );
    return !blocked;
  }

  /** Interpolate camera between physics states. alpha ∈ [0,1]. */
  updateCamera(alpha: number, dt: number) {
    const x = this.prevFeet.x + (this.feet.x - this.prevFeet.x) * alpha;
    const y = this.prevFeet.y + (this.feet.y - this.prevFeet.y) * alpha;
    const z = this.prevFeet.z + (this.feet.z - this.prevFeet.z) * alpha;
    let bobY = 0;
    let bobX = 0;
    let roll = 0;
    if (settings.headBob) {
      const amp = this.bobAmount * (this.sprinting ? 1.6 : 1);
      bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * amp;
      bobX = Math.cos(this.bobPhase) * 0.025 * amp;
      roll = Math.cos(this.bobPhase) * 0.004 * amp;
    }
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.camera.position.set(x + cos * bobX, y + this.eye + bobY, z - sin * bobX);
    this.camera.rotation.set(this.pitch, this.yaw, roll);
    // Sprint widens the FOV a touch.
    const fovTarget = settings.fov + (this.sprinting ? 6 : 0);
    if (Math.abs(this.camera.fov - fovTarget) > 0.01) {
      this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Horizontal speed in m/s (for UI/audio). */
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}
