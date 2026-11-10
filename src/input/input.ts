/**
 * Input: action map over keyboard, mouse look via Pointer Lock (with a drag-to-look
 * fallback when lock is unavailable or refused, e.g. some iPadOS Safari setups), and
 * virtual inputs injected by the touch controls.
 */
import { settings, type Action } from '../game/settings.ts';

export type LookMode = 'locked' | 'drag' | 'touch' | 'none';

export class Input {
  private down = new Set<string>();
  private pressedQueue = new Set<Action>();
  private lookDX = 0;
  private lookDY = 0;
  /** Analog move from the virtual joystick, x = strafe, y = forward, in [-1, 1]. */
  readonly virtualMove = { x: 0, y: 0 };
  readonly virtualHeld = new Set<Action>();
  lookMode: LookMode = 'none';
  pointerLockSupported: boolean;
  pointerLockFailed = false;
  enabled = true;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  onLockChange: (locked: boolean) => void = () => {};
  /** Set while the key-remap UI waits for a key. */
  captureNext: ((code: string) => void) | null = null;

  constructor(private canvas: HTMLElement) {
    this.pointerLockSupported = 'requestPointerLock' in canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', () => (this.dragging = false));
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Try to capture the mouse. Resolves to the look mode that ended up active. */
  async requestLock(): Promise<LookMode> {
    if (!this.pointerLockSupported || this.pointerLockFailed) {
      this.lookMode = 'drag';
      return this.lookMode;
    }
    try {
      const el = this.canvas as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
      const r = el.requestPointerLock();
      if (r && typeof (r as Promise<void>).then === 'function') await r;
      // Older Safari returns undefined and reports via events; give it a moment.
      await new Promise((res) => setTimeout(res, 60));
      if (this.locked) this.lookMode = 'locked';
      else if (this.pointerLockFailed) this.lookMode = 'drag';
      return this.lookMode;
    } catch {
      this.pointerLockFailed = true;
      this.lookMode = 'drag';
      return this.lookMode;
    }
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  isDown(a: Action): boolean {
    if (this.virtualHeld.has(a)) return true;
    if (!this.enabled) return false;
    return settings.bindings[a].some((c) => this.down.has(c));
  }

  /** True once per key press (edge-triggered). */
  pressed(a: Action): boolean {
    if (this.pressedQueue.has(a)) {
      this.pressedQueue.delete(a);
      return true;
    }
    return false;
  }

  /** Inject an edge-triggered action (touch buttons). */
  press(a: Action) {
    this.pressedQueue.add(a);
  }

  /** Move vector: x = right, y = forward. Length ≤ 1. */
  moveVector(): { x: number; y: number } {
    let x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0) + this.virtualMove.x;
    let y = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0) + this.virtualMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  addLook(dx: number, dy: number) {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  clearTransient() {
    this.pressedQueue.clear();
    this.consumeLook();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.captureNext) {
      e.preventDefault();
      const fn = this.captureNext;
      this.captureNext = null;
      fn(e.code);
      return;
    }
    if (e.target instanceof HTMLInputElement) return;
    if (!e.repeat) {
      for (const [a, codes] of Object.entries(settings.bindings) as [Action, string[]][]) {
        if (codes.includes(e.code)) this.pressedQueue.add(a);
      }
    }
    this.down.add(e.code);
    // Keep the browser from scrolling / opening find etc. for game keys.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'Tab'].includes(e.code) || e.ctrlKey) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onPointerLockChange = () => {
    if (this.locked) this.lookMode = 'locked';
    this.onLockChange(this.locked);
  };

  private onPointerLockError = () => {
    this.pointerLockFailed = true;
    this.lookMode = 'drag';
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.lookMode === 'drag') {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (this.locked) {
      // Guard against the occasional giant first-event jump some browsers report.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.addLook(e.movementX, e.movementY);
    } else if (this.lookMode === 'drag' && this.dragging) {
      this.addLook((e.clientX - this.lastX) * 1.5, (e.clientY - this.lastY) * 1.5);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('mousemove', this.onMouseMove);
  }
}
