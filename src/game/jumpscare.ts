/**
 * Jump scare when the monster catches the player. Two versions:
 *
 * Robin (3D body) — a short choreography played on the model itself:
 *   0.00  input frozen; camera whips to Robin standing ~2 m away, hunched low, head cocked; the
 *         building's hum cuts to dead silence; flashlight stutters out
 *   0.30  the head snaps upright and stares at you
 *   0.42  HIT: Robin lunges into your face (0.16 s), arms flung wide, claws splayed; the scream
 *         lands on the same frame; camera punch (FOV kick + heavy shake), flash
 *   0.6–  his face fills the screen, head shaking while he screams, claws close in from the sides;
 *         red pulses ≤ 3/s (photosensitivity), slow zoom in
 *   2.15  cut to black → 2.6 caught screen
 *
 * Other bodies — the original: monster snapped in front, camera turn, shake, overlay face.
 *
 * 'scare:start' carries `hitAt` so audio (scream) and UI (flash) land on the lunge.
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
}

export const JUMPSCARE: JumpScareConfig = {
  duration: 2.6,
  blackAt: 2.15,
  faceDistance: 0.5,
  shake: 0.1,
  turnTime: 0.12,
  standOff: 2.3,
  hitAt: RobinBody.SCARE_HIT,
  lungeTime: 0.16,
};

/** The older, image-based scare (other bodies). */
const SIMPLE: Partial<JumpScareConfig> = { duration: 2.2, blackAt: 1.7, faceDistance: 0.85, shake: 0.08, hitAt: 0 };

export class JumpScare {
  active = false;
  /** True while the 3D Robin choreography runs (the UI hides the 2D face). */
  robin = false;
  config: JumpScareConfig = JUMPSCARE;
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
    const eye = player.camera.position;
    // Face the monster if it's roughly in front, else spin round to where it came from.
    this.fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    if (monster) {
      let dist = this.robin ? this.config.standOff : this.config.faceDistance;
      if (this.robin && free) {
        // Stage him where there's room: your view first, then where he came from, then around you.
        const view = this.fwd.clone();
        const toM = monster.position.clone().sub(eye).setY(0).normalize();
        const cands = [view, toM, ...[0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI].map((a) => view.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a))];
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
        monster.robinBody!.scareT = 0;
        // A light on his face: the scare must be seen, whatever the flashlight was doing.
        this.light = new THREE.PointLight(0xffe2cc, 0, 4.5, 1.6);
        this.light.position.set(0, 0.35, 0.1);
        player.camera.add(this.light);
      }
      monster.headPosition(this.head);
    } else {
      this.head.copy(eye).add(new THREE.Vector3(-Math.sin(player.yaw), 0.3, -Math.cos(player.yaw)));
    }
    bus.emit('scare:start', { by, hitAt: this.config.hitAt, robin: this.robin });
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
      // Distance: stand-off, then the lunge (ease-in, accelerating at you), then creep closer.
      const lt = THREE.MathUtils.clamp((t - c.hitAt) / c.lungeTime, 0, 1);
      const dist = t < c.hitAt ? this.standOff : THREE.MathUtils.lerp(this.standOff, c.faceDistance, lt * lt) - Math.max(0, t - c.hitAt - c.lungeTime) * 0.05;
      // Place the root so the HEAD ends at `dist` in front of the eye and, after the hit, at eye height.
      m.headPosition(this.head);
      const hx = this.head.x - m.object.position.x;
      const hz = this.head.z - m.object.position.z;
      const lat = this.fwd.x * hx + this.fwd.z * hz; // head ahead of the root along the view
      const wantSink = t < c.hitAt ? 0 : Math.max(0, this.head.y + 0.1 + this.sink - eye.y); // his eyes level with yours
      this.sink += (wantSink - this.sink) * Math.min(1, dt * (t < c.hitAt + c.lungeTime ? 30 : 8));
      const root = new THREE.Vector3(eye.x + this.fwd.x * (dist - lat), player.feet.y - this.sink, eye.z + this.fwd.z * (dist - lat));
      m.position.copy(root);
      m.object.position.copy(root);
      m.object.rotation.y = Math.atan2(-this.fwd.x, -this.fwd.z);
      m.headPosition(this.head);
      this.head.y += 0.1; // aim at his eyes

      // Light and flashlight: stutter out in the wind-up, blaze at the hit, then throb.
      const flicker = t > 0.16 && t < 0.3 ? (Math.floor(t * 40) % 2 === 0 ? 0 : 1) : 1;
      if (this.flashOn) player.flashlight.intensity = 38 * flicker * (t < c.hitAt ? 0.7 : 0.45);
      if (this.light) {
        const base = t < c.hitAt ? 0.5 * flicker : 1.5 * (0.65 + 0.35 * Math.sin(t * 18.85)); // 3 Hz throb
        this.light.intensity = base;
      }
      // Camera: FOV kick on the hit, then a slow push in.
      const kick = t < c.hitAt ? 0 : Math.exp(-(t - c.hitAt) * 9) * 16;
      const push = Math.max(0, t - c.hitAt) * 4;
      player.camera.fov = this.baseFov + kick - push;
      player.camera.updateProjectionMatrix();
      shake = t < c.hitAt ? 0.006 : c.shake * Math.max(0.35, Math.exp(-(t - c.hitAt) * 2.2));
    } else {
      shake = c.shake * Math.max(0, 1 - t / c.duration);
    }

    // Turn to the face (fast), shaking.
    const d = this.head.clone().sub(eye);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    const k = Math.min(1, t / c.turnTime);
    const ease = 1 - (1 - k) ** 3;
    let dy = yaw - this.startYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    player.yaw = this.startYaw + dy * ease + (Math.random() - 0.5) * shake;
    player.pitch = this.startPitch + (pitch - this.startPitch) * ease + (Math.random() - 0.5) * shake;
    if (t >= c.duration) {
      this.finish(player);
      return true;
    }
    return false;
  }

  private finish(player: Player) {
    this.active = false;
    if (this.light) {
      player.camera.remove(this.light);
      this.light.dispose();
      this.light = null;
    }
    player.camera.fov = this.baseFov;
    player.camera.updateProjectionMatrix();
    if (this.monster?.robinBody) this.monster.robinBody.scareT = -1;
    bus.emit('scare:end', { by: this.by });
  }
}
