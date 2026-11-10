/**
 * Typed event bus. Systems publish facts; others (UI, audio, the future horror
 * director) subscribe without the publisher knowing about them.
 */
import type { LevelData, Side } from '../gen/types.ts';

export interface GameEvents {
  'level:loaded': { level: LevelData };
  'level:started': { seed: string };
  'level:won': { seed: string; timeMs: number };
  'player:enteredCell': { x: number; z: number; prevX: number; prevZ: number };
  'player:flashlight': { on: boolean };
  'player:sprint': { on: boolean };
  'player:crouch': { on: boolean };
  'exit:approached': { x: number; z: number; side: Side };
  'exit:opened': Record<string, never>;
  'game:paused': { paused: boolean };
  'chunk:loaded': { key: string };
  'chunk:unloaded': { key: string };
  'light:flicker': { id: number; intensity: number; ms: number };
  'audio:cue': { name: string; x?: number; z?: number; volume?: number };
  'settings:changed': { key: string };
  'quality:changed': { preset: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(type: K, fn: Handler<E[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as Handler<E[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus<GameEvents>();
