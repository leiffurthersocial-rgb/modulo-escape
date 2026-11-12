/**
 * Jump scare when the monster catches the player. Two versions:
 *
 * Robin (3D body), ~4.4 s:
 *   0.00  input frozen; the camera whips round to where he is: Robin ~2 m away in the dark,
 *         hunched; the building's hum dies; your heartbeat starts, faster and faster
 *   0.0–  his head slowly turns upside down while he stares at you (flashlight stuttering)
 *   0.78  the head SNAPS back upright
 *   1.00  every light dies: total darkness; wet breathing right at your ear; he moves
 *   1.35  HIT: light back on — he's already in your face, face tearing open (mouth a black hole,
 *         eyes bulging and bleeding, glitching), arms flung wide; the scream; FOV kick, shake
 *   2.55  he drives you to the floor: the camera falls backwards and rolls, he follows you down
 *   3.20  cut to black, silence…
 *   3.85  …one last shriek: his ruined face, right at the lens, for a split second
 *   4.40  caught screen
 *   Flashes stay ≤ 3 per second (photosensitivity).
 *
 * Other bodies — the original: monster snapped in front, camera turn, shake, overlay face.
 *
 * 'scare:start' carries the timeline so audio (heartbeat, breath, scream, shriek) and the UI
 * (flash, black, last face) land on the right frames.
 */
import * as THREE from 'three';
import { bus } from '../core/events.ts';
import type { Monster } from '../ai/monster.ts';
import { RobinBody } from '../ai/robinBody.ts';
import type { Player } from '../player/player.ts';

export interface JumpScareConfig {
  duration: number;
  /** Seconds until the overlay cuts to black. */
  blackAt: number;
  /** Distance of the monster from the camera (m) — the face at the end. */
  faceDistance: number;
  /** Camera shake amplitude (radians) at the hit, decays over the scare. */
  shake: number;
  /** Seconds the camera takes to turn to the face. */
  turnTime: number;
  /** Robin: where he stands at the start (m) and when he lunges (s). */
  standOff: number;
  hitAt: number;
  lungeTime: number;
  /** Robin: total darkness from darkAt to hitAt. */
  darkAt: number;
  /** Robin: knocked to the floor between fallAt and fallAt + fallTime. */
  fallAt: number;
  fallTime: number;
  /** Robin: the last face, in the black. 0 = none. */
  booAt: number;
  booTime: number;
}

export const JUMPSCARE: JumpScareConfig = {
  duration: 4.4,
  blackAt: 3.2,
  faceDistance: 0.58,
  shake: 0.12,
  turnTime: 0.16,
  standOff: 2.3,
  hitAt: RobinBody.SCARE_HIT,
  lungeTime: 0.12,
  darkAt: 1.0,
  fallAt: 2.55,
  fallTime: 0.5,
  booAt: 3.85,
  booTime: 0.26,
};

/** The older, image-based scare (other bodies). */
const SIMPLE: Partial<JumpScareConfig> = { duration: 2.2, blackAt: 1.7, faceDistance: 0.85, shake: 0.08, hitAt: 0, booAt: 0 };

const ease = (x: number) => x * x * (3 - 2 * x);

export class JumpScare {
  active = false;
  /** True while the 3D Robin choreography runs (the UI hides the 2D face). */
  robin = false;
  config: JumpScareConfig = JUMPSCARE;
  /** Exposure multiplier the game applies (0 = total darkness). */
  exposure = 1;
  private t = 0;
  private by = '';
  private head = new THREE.Vector3();
  private startYaw = 0;
  private startPitch = 0;
  private monster: Monster | null = null;
  private fwd = new THREE.Vector3();
  private baseFov = 70;
  private flashOn = false;
  private light: THREE.PointLight | null = null;
  private sink = 0;
  private standOff = 2.3;
  private fall = 0;
  private roll = 0;

  constructor(readonly base: JumpScareConfig = JUMPSCARE) {}

  /** `free(dir, max)`: clear distance from the eye along a horizontal direction (for staging). */
  start(by: string, monster: Monster | null, player: Player, free?: (dir: THREE.Vector3, max: number) => number) {
    this.active = true;
    this.t = 0;
    this.by = by;
    this.monster = monster;
    this.robin = !!monster?.robinBody;
    this.config = this.robin ? this.base : { ...this.base, ...SIMPLE };
    this.startYaw = player.yaw;
    this.startPitch = player.pitch;
    this.baseFov = player.camera.fov;
    this.flashOn = player.flashlightOn;
    this.sink = 0;
    this.fall = 0;
    this.roll = 0;
    this.exposure = 1;
    const eye = player.camera.position;
    this.fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    if (monster) {
      let dist = this.robin ? this.config.standOff : this.config.faceDistance;
      if (this.robin && free) {
        // Stage him where he came from if there's room (the camera whips round to him), else in
        // your view, else anywhere around you with space.
        const view = this.fwd.clone();
        const toM = monster.position.clone().sub(eye).setY(0).normalize();
        const cands = [toM, view, ...[0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI].map((a) => view.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a))];
        let best = view;
        let bestFree = -1;
        for (const d of cands) {
          const f = free(d, this.config.standOff + 0.6);
          if (f >= this.config.standOff + 0.5) {
            best = d;
            bestFree = f;
            break;
          }
          if (f > bestFree) {
            bestFree = f;
            best = d;
          }
        }
        this.fwd.copy(best);
        dist = THREE.MathUtils.clamp(bestFree - 0.5, 1.1, this.config.standOff);
      }
      this.standOff = dist;
      const at = new THREE.Vector3(eye.x + this.fwd.x * dist, player.feet.y, eye.z + this.fwd.z * dist);
      monster.lunge(at, eye);
      if (this.robin) {
        const body = monster.robinBody!;
        body.scareHit = this.config.hitAt;
        body.scareT = 0;
        // The face light (created once in prepare(): adding a light now would recompile every
        // shader in the scene and stutter right at the scare).
        this.prepare(player.camera);
      }
      monster.headPosition(this.head);
    } else {
      this.head.copy(eye).add(new THREE.Vector3(-Math.sin(player.yaw), 0.3, -Math.cos(player.yaw)));
    }
    const c = this.config;
    bus.emit('scare:start', { by, hitAt: c.hitAt, robin: this.robin, darkAt: this.robin ? c.darkAt : 0, booAt: this.robin ? c.booAt : 0 });
  }

  /** Advance; drives the player's view. Returns true when finished. */
  update(dt: number, player: Player): boolean {
    if (!this.active) return false;
    this.t += dt;
    const c = this.config;
    const t = this.t;
    const eye = player.camera.position;
    let shake: number;

    if (this.robin && this.monster) {
      const m = this.monster;
      const body = m.robinBody!;
      body.scareT = t;
      const dark = t >= c.darkAt && t < c.hitAt;
      const boo = c.booAt > 0 && t >= c.booAt && t < c.booAt + c.booTime;
      const black = t >= c.blackAt && !boo;
      // Knocked to the floor.
      const ft = THREE.MathUtils.clamp((t - c.fallAt) / c.fallTime, 0, 1);
      this.fall = ease(ft);
      this.roll = this.fall * 0.55 + (boo ? 0.25 : 0);
      // Distance: stand-off; in the dark he crosses the gap; then creeps closer; at the very end,
      // right at the lens.
      const crossed = THREE.MathUtils.clamp((t - c.darkAt - 0.12) / 0.15, 0, 1);
      let dist = t < c.darkAt ? this.standOff : THREE.MathUtils.lerp(this.standOff, c.faceDistance, ease(crossed));
      if (t > c.hitAt) dist -= Math.min(0.12, (t - c.hitAt) * 0.06);
      if (boo) dist = 0.24;
      // Face height: level with your eyes; looming over you once you're down.
      const above = this.fall * 0.5;
      m.headPosition(this.head);
      const hx = this.head.x - m.object.position.x;
      const hz = this.head.z - m.object.position.z;
      const lat = this.fwd.x * hx + this.fwd.z * hz;
      const wantSink = t < c.darkAt ? 0 : Math.max(0, this.head.y + 0.1 + this.sink - (eye.y + above));
      this.sink += (wantSink - this.sink) * Math.min(1, dt * (dark || boo ? 60 : 10));
      const root = new THREE.Vector3(eye.x + this.fwd.x * (dist - lat), player.feet.y - this.sink, eye.z + this.fwd.z * (dist - lat));
      m.position.copy(root);
      m.object.position.copy(root);
      m.object.rotation.y = Math.atan2(-this.fwd.x, -this.fwd.z);
      m.headPosition(this.head);
      this.head.y += 0.1; // aim at his eyes

      // Face warp: tears open from the hit on, full at the end.
      const warp = t < c.hitAt ? 0 : Math.min(1, 0.35 + (t - c.hitAt) * 0.6);
      body.setWarp(boo ? 1 : warp, t);

      // Lights: stuttering flashlight in the wind-up, black in the dark, blazing after.
      const flicker = (t > 0.16 && t < 0.3) || (t > 0.62 && t < 0.7) ? (Math.floor(t * 40) % 2 === 0 ? 0 : 1) : 1;
      if (this.flashOn) player.flashlight.intensity = dark ? 0 : 38 * flicker * (t < c.hitAt ? 0.7 : 0.45);
      if (this.light) {
        this.light.color.setHex(boo ? 0xff6050 : 0xffd8c8);
        this.light.intensity = dark ? 0 : boo ? 3 : t < c.hitAt ? 0.5 * flicker : 1.1 * (0.65 + 0.35 * Math.sin(t * 18.85)); // 3 Hz throb
      }
      this.exposure = dark || black ? 0.0 : 1;
      // Camera: FOV kick on the hit and the last face, then a slow push in.
      const kick = (t < c.hitAt ? 0 : Math.exp(-(t - c.hitAt) * 9) * 18) + (boo ? 22 * Math.exp(-(t - c.booAt) * 14) : 0);
      const push = Math.max(0, t - c.hitAt) * 4;
      player.camera.fov = this.baseFov + kick - push;
      player.camera.updateProjectionMatrix();
      shake = t < c.hitAt ? 0.006 : boo ? 0.2 : c.shake * Math.max(0.35, Math.exp(-(t - c.hitAt) * 2.2)) + (ft > 0 && ft < 1 ? 0.08 : 0);
    } else {
      shake = c.shake * Math.max(0, 1 - t / c.duration);
    }

    // Turn to the face (fast), shaking.
    const d = this.head.clone().sub(eye);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    const k = Math.min(1, t / c.turnTime);
    const e = 1 - (1 - k) ** 3;
    let dy = yaw - this.startYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    player.yaw = this.startYaw + dy * e + (Math.random() - 0.5) * shake;
    player.pitch = this.startPitch + (pitch - this.startPitch) * e + (Math.random() - 0.5) * shake;
    if (t >= c.duration) {
      this.finish(player);
      return true;
    }
    return false;
  }

  /** After the player's camera update each frame: knocked to the floor (drop + roll). */
  applyCamera(camera: THREE.Camera) {
    if (!this.active || !this.robin) return;
    camera.position.y -= this.fall * 1.25;
    camera.rotateZ(this.roll);
  }

  /**
   * Create the scare's face light up front (intensity 0), so the scene's light count never changes
   * during play — a new light would force every material to recompile (a visible hitch).
   */
  prepare(camera: THREE.Camera) {
    if (this.light) return;
    this.light = new THREE.PointLight(0xffd8c8, 0, 4.5, 1.6);
    this.light.position.set(0, 0.35, 0.1);
    camera.add(this.light);
  }

  private finish(player: Player) {
    this.active = false;
    this.exposure = 1;
    this.fall = 0;
    this.roll = 0;
    if (this.light) this.light.intensity = 0;
    player.camera.fov = this.baseFov;
    player.camera.updateProjectionMatrix();
    if (this.monster?.robinBody) {
      this.monster.robinBody.scareT = -1;
      this.monster.robinBody.setWarp(0, 0);
    }
    bus.emit('scare:end', { by: this.by });
  }
}
