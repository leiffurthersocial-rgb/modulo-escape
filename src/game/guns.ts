/**
 * Guns: a CC0 service pistol (Poly Haven) lying on the floor somewhere. Walk over it to pick it
 * up (you carry at most one). It holds ONE bullet: shoot a monster and it's stunned for a while,
 * then slinks off and comes back later; the gun is spent and vanishes. A new one turns up
 * somewhere else after a while (never in sight, never right next to you).
 *
 * Aiming is generous (it's a panic shot): the monster nearest the centre of your view, within a
 * small cone, in line of sight, wins. The bang is loud: every monster within ~40 m hears it.
 */
import * as THREE from 'three';
import { bus } from '../core/events.ts';
import type { Building } from '../gen/types.ts';
import type { Rng } from '../core/rng.ts';
import type { NavQuery } from '../ai/navQuery.ts';
import type { Senses } from '../ai/senses.ts';
import type { Monster } from '../ai/monster.ts';
import type { PropModel } from '../world/propModels.ts';
import type { Player } from '../player/player.ts';

interface Pickup {
  object: THREE.Group;
  pos: THREE.Vector3;
  floor: number;
}

/** Most guns lying around at once, and how long until a used one is replaced. */
const MAX_PICKUPS = 2;
const RESPAWN = [35, 70] as const;

export class Guns {
  readonly group = new THREE.Group();
  private pickups: Pickup[] = [];
  /** Holding a loaded gun. */
  held = false;
  /** First-person gun, on the camera. */
  private view: THREE.Group;
  private flash: THREE.PointLight;
  private flashT = 0;
  private recoil = 0;
  private bob = 0;
  private respawnAt: number[] = [];
  private time = 0;
  private template: THREE.Group;

  constructor(
    private scene: THREE.Scene,
    private building: Building,
    private nav: NavQuery,
    private senses: Senses,
    model: PropModel | null,
    private rng: Rng,
  ) {
    this.template = model ? fromModel(model) : fallbackPistol();
    scene.add(this.group);
    this.view = this.template.clone();
    this.view.visible = false;
    this.flash = new THREE.PointLight(0xffc070, 0, 9, 2);
    this.flash.position.set(0, 0.04, -0.32);
    this.view.add(this.flash);
  }

  /** Put the first-person gun on the camera, and the first pickups in the building. */
  init(player: Player) {
    player.camera.add(this.view);
    this.view.position.set(0.17, -0.17, -0.36);
    this.view.rotation.set(0, Math.PI / 2, 0);
    // One near-ish your start (not on top of you), one anywhere.
    this.spawn(player, 10, 35);
    this.spawn(player, 25, 999);
  }

  /** Place a gun on the floor somewhere between `min` and `max` metres (walking) from you, out of sight. */
  private spawn(player: Player, min: number, max: number): boolean {
    const p = player.feet;
    const here = this.nav.nodeAt(p.x, p.y, p.z);
    const pos = new THREE.Vector3();
    for (let tries = 0; tries < 60; tries++) {
      const floor = Math.floor(this.rng.next() * this.building.floors.length);
      const n = this.nav.randomNode(this.rng, floor);
      if (n < 0) continue;
      const l = this.building.floors[floor]!;
      const cell = l.cells[n % this.nav.N];
      if (!cell || cell.kind === 'stair' || cell.kind === 'shaft') continue;
      this.nav.nodePos(n, pos);
      const d = pos.distanceTo(p);
      if (here >= 0 && (d < min || d > max)) continue;
      if (this.pickups.some((g) => g.pos.distanceTo(pos) < 20)) continue;
      if (floor === player.floor && this.senses.lineOfSight(pos.clone().setY(pos.y + 0.3), player.camera.position)) continue;
      // Off-centre in the cell, on the floor, lying on its side at a random angle.
      pos.x += (this.rng.next() - 0.5) * 1.6;
      pos.z += (this.rng.next() - 0.5) * 1.6;
      const o = this.template.clone();
      o.position.set(pos.x, pos.y + 0.025, pos.z);
      o.rotation.set(Math.PI / 2, 0, this.rng.next() * Math.PI * 2);
      this.group.add(o);
      this.pickups.push({ object: o, pos: pos.clone(), floor });
      return true;
    }
    return false;
  }

  update(dt: number, player: Player) {
    this.time += dt;
    // Pick up: walk over it (not if you already carry one).
    if (!this.held) {
      for (const g of this.pickups) {
        if (g.floor !== player.floor || Math.hypot(g.pos.x - player.feet.x, g.pos.z - player.feet.z) > 1.0) continue;
        this.group.remove(g.object);
        this.pickups.splice(this.pickups.indexOf(g), 1);
        this.held = true;
        this.view.visible = true;
        bus.emit('gun:pickup', {});
        bus.emit('gun:held', { held: true });
        break;
      }
    }
    // Replacements for spent guns.
    this.respawnAt = this.respawnAt.filter((t) => {
      if (this.time < t) return true;
      return !(this.pickups.length < MAX_PICKUPS && this.spawn(player, 20, 999));
    });
    // First-person gun: sway with your steps, kick back when fired, muzzle flash.
    this.bob += dt * Math.min(6, player.realSpeed * 2.2);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = this.flashT > 0 ? 60 * (this.flashT / 0.07) : 0;
    this.view.position.set(0.17 + Math.sin(this.bob) * 0.006, -0.17 + Math.abs(Math.cos(this.bob)) * 0.006 + this.recoil * 0.03, -0.36 + this.recoil * 0.07);
    this.view.rotation.set(this.recoil * 0.5, Math.PI / 2, 0);
    if (!this.held && this.flashT <= 0 && this.recoil <= 0) this.view.visible = false;
  }

  /** Pull the trigger. Returns the monster hit, if any. */
  fire(player: Player, monsters: Monster[]): Monster | null {
    if (!this.held) return null;
    this.held = false;
    this.recoil = 1;
    this.flashT = 0.07;
    bus.emit('gun:held', { held: false });
    const eye = player.camera.position;
    const fwd = player.camera.getWorldDirection(new THREE.Vector3());
    let best: Monster | null = null;
    let bestScore = -Infinity;
    for (const m of monsters) {
      if (m.floor !== player.floor || !m.object.visible || m.state === 'dormant') continue;
      for (const h of [1.0, 1.7, 2.4]) {
        const at = m.position.clone().setY(m.position.y + h);
        const to = at.sub(eye);
        const d = to.length();
        if (d > 32) continue;
        const cos = to.divideScalar(d).dot(fwd);
        // A small cone that widens when it's close (it fills your view).
        const need = Math.cos(THREE.MathUtils.degToRad(d < 5 ? 16 : 7));
        if (cos < need) continue;
        if (!this.senses.lineOfSight(eye, m.position.clone().setY(m.position.y + h), player.collider)) continue;
        const score = cos - d * 0.002;
        if (score > bestScore) {
          bestScore = score;
          best = m;
        }
      }
    }
    const p = player.feet;
    bus.emit('gun:fired', { x: eye.x, y: eye.y, z: eye.z, hit: best?.id ?? null });
    bus.emit('noise', { x: p.x, y: p.y, z: p.z, floor: player.floor, radius: 40, source: 'player' });
    this.respawnAt.push(this.time + RESPAWN[0] + this.rng.next() * (RESPAWN[1] - RESPAWN[0]));
    return best;
  }

  /** Where the guns lie (debug / tests). */
  get positions(): { x: number; z: number; floor: number }[] {
    return this.pickups.map((g) => ({ x: g.pos.x, z: g.pos.z, floor: g.floor }));
  }

  dispose() {
    this.scene.remove(this.group);
    this.view.removeFromParent();
  }
}

/** The Poly Haven pistol as a group of meshes (lies on y = 0, centred). */
function fromModel(m: PropModel): THREE.Group {
  const g = new THREE.Group();
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = true;
    g.add(mesh);
  }
  // Fit to a real pistol's length (~20 cm) whatever the source scale.
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const s = 0.2 / Math.max(size.x, size.z, 1e-3);
  g.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3());
  g.children.forEach((ch) => ch.position.set(-c.x, -box.min.y, -c.z));
  return g;
}

/** If the model didn't load: a simple dark pistol from boxes. */
function fallbackPistol(): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.7, roughness: 0.45 });
  const g = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.03), mat);
  slide.position.set(0, 0.11, 0);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.028), mat);
  grip.position.set(-0.07, 0.05, 0);
  grip.rotation.z = -0.25;
  g.add(slide, grip);
  return g;
}
