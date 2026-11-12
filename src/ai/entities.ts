/**
 * Entity system for things that move through the building on their own (the future monster,
 * maybe distractions). The game owns one EntityManager and updates it every frame while playing.
 */
import type * as THREE from 'three';
import type { Building } from '../gen/types.ts';
import type { NavQuery } from './navQuery.ts';
import type { Senses } from './senses.ts';

/** What an entity may know about the player (read-only snapshot each frame). */
export interface PlayerView {
  position: THREE.Vector3;
  eye: THREE.Vector3;
  floor: number;
  crouching: boolean;
  sprinting: boolean;
  flashlightOn: boolean;
  /** Where the camera looks, and cos of half the view cone (for "is he looking at me"). */
  forward: THREE.Vector3;
  viewCos: number;
  /** Debug: monsters can't see or hear you. */
  invisible: boolean;
  /** Walking or running (not standing still). */
  moving: boolean;
}

export interface EntityContext {
  building: Building;
  nav: NavQuery;
  senses: Senses;
  player: PlayerView;
  time: number;
  /** Ends the run (state 'caught'). */
  catchPlayer(by: string): void;
  /** The one monster currently allowed to stalk you (the others roam elsewhere). */
  isHunter(id: string): boolean;
  /** Is another monster already after you (chasing, charging, staring you down)? */
  othersHunting(id: string): boolean;
}

export interface Entity {
  readonly id: string;
  readonly object: THREE.Object3D;
  position: THREE.Vector3;
  floor: number;
  update(dt: number, ctx: EntityContext): void;
  dispose(): void;
}

export class EntityManager {
  readonly entities = new Map<string, Entity>();
  constructor(private scene: THREE.Scene) {}

  add(e: Entity) {
    this.entities.set(e.id, e);
    this.scene.add(e.object);
  }

  remove(id: string) {
    const e = this.entities.get(id);
    if (!e) return;
    this.scene.remove(e.object);
    e.dispose();
    this.entities.delete(id);
  }

  update(dt: number, ctx: EntityContext) {
    for (const e of this.entities.values()) e.update(dt, ctx);
  }

  dispose() {
    for (const id of [...this.entities.keys()]) this.remove(id);
  }
}
