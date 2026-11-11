/**
 * Jump scare when the monster catches the player. Everything that makes it land lives here so a
 * real model / sound can be dropped in later:
 *   0.00 s  input frozen, monster snapped in front of the camera (lunge pose), sting plays ('scare:start')
 *   0.00–0.15  camera whips round to the monster's face
 *   0.05     white-red flash (UI overlay), then heavy shake decaying
 *   1.25     cut to black (UI overlay)
 *   1.80     'scare:end' → caught screen
 */
import * as THREE from 'three';
import { bus } from '../core/events.ts';
import type { Monster } from '../ai/monster.ts';
import type { Player } from '../player/player.ts';

export interface JumpScareConfig {
  duration: number;
  /** Seconds until the overlay cuts to black. */
  blackAt: number;
  /** Distance of the monster from the camera (m). */
  faceDistance: number;
  /** Camera shake amplitude (radians) at the start, decays over the scare. */
  shake: number;
  /** Seconds the camera takes to turn to the face. */
  turnTime: number;
}

export const JUMPSCARE: JumpScareConfig = { duration: 2.2, blackAt: 1.7, faceDistance: 0.85, shake: 0.08, turnTime: 0.12 };

export class JumpScare {
  active = false;
  private t = 0;
  private by = '';
  private head = new THREE.Vector3();
  private startYaw = 0;
  private startPitch = 0;

  constructor(readonly config: JumpScareConfig = JUMPSCARE) {}

  start(by: string, monster: Monster | null, player: Player) {
    this.active = true;
    this.t = 0;
    this.by = by;
    this.startYaw = player.yaw;
    this.startPitch = player.pitch;
    const eye = player.camera.position;
    if (monster) {
      // Put the monster right in front of the current view, facing the camera.
      const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      monster.lunge(new THREE.Vector3(eye.x + fwd.x * this.config.faceDistance, player.feet.y, eye.z + fwd.z * this.config.faceDistance), eye);
      monster.headPosition(this.head);
    } else {
      this.head.copy(eye).add(new THREE.Vector3(-Math.sin(player.yaw), 0.3, -Math.cos(player.yaw)));
    }
    bus.emit('scare:start', { by });
  }

  /** Advance; drives the player's view. Returns true when finished. */
  update(dt: number, player: Player): boolean {
    if (!this.active) return false;
    this.t += dt;
    const c = this.config;
    // Turn to the face, then shake.
    const eye = player.camera.position;
    const d = this.head.clone().sub(eye);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    const k = Math.min(1, this.t / c.turnTime);
    const ease = 1 - (1 - k) ** 3;
    let dy = yaw - this.startYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const shake = c.shake * Math.max(0, 1 - this.t / c.duration);
    player.yaw = this.startYaw + dy * ease + (Math.random() - 0.5) * shake;
    player.pitch = this.startPitch + (pitch - this.startPitch) * ease + (Math.random() - 0.5) * shake;
    if (this.t >= c.duration) {
      this.active = false;
      bus.emit('scare:end', { by: this.by });
      return true;
    }
    return false;
  }
}
