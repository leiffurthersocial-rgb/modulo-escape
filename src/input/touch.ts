/**
 * On-screen touch controls: floating left joystick (move), right-side look pad,
 * and buttons for sprint (hold), crouch (toggle) and flashlight.
 * Safe-area aware. Uses Pointer Events so it also works with Apple Pencil.
 */
import type { Input } from './input.ts';
import type { Action } from '../game/settings.ts';

export function isTouchOnlyDevice(): boolean {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const anyFine = matchMedia('(any-pointer: fine)').matches;
  return coarse && !anyFine;
}

export class TouchControls {
  readonly el: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private crouchOn = false;
  enabled = false;

  constructor(
    parent: HTMLElement,
    private input: Input,
    onPause: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="touch-move" data-zone="move"></div>
      <div class="touch-look" data-zone="look"></div>
      <div class="stick-base"><div class="stick-knob"></div></div>
      <div class="touch-buttons">
        <button data-act="sprint" class="tbtn">RUN</button>
        <button data-act="crouch" class="tbtn">DUCK</button>
        <button data-act="flashlight" class="tbtn">LIGHT</button>
      </div>`;
    parent.appendChild(this.el);
    this.stickBase = this.el.querySelector('.stick-base')!;
    this.stickKnob = this.el.querySelector('.stick-knob')!;
    const move = this.el.querySelector<HTMLElement>('.touch-move')!;
    const look = this.el.querySelector<HTMLElement>('.touch-look')!;

    move.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      move.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('active');
      this.setKnob(0, 0);
    });
    move.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const R = 56;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      this.setKnob(dx, dy);
      // Small dead zone, then linear.
      const nx = Math.abs(dx) < 6 ? 0 : dx / R;
      const ny = Math.abs(dy) < 6 ? 0 : -dy / R;
      this.input.virtualMove.x = nx;
      this.input.virtualMove.y = ny;
      // Pushing the stick to the rim sprints.
      if (len > R * 1.35 && ny > 0.7) this.input.virtualHeld.add('sprint');
      else if (!this.sprintButtonHeld) this.input.virtualHeld.delete('sprint');
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.virtualMove.x = 0;
      this.input.virtualMove.y = 0;
      if (!this.sprintButtonHeld) this.input.virtualHeld.delete('sprint');
      this.stickBase.classList.remove('active');
    };
    move.addEventListener('pointerup', endStick);
    move.addEventListener('pointercancel', endStick);

    look.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      look.setPointerCapture(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.input.addLook((e.clientX - this.lookLast.x) * 2.2, (e.clientY - this.lookLast.y) * 2.2);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('button[data-act]')) {
      const act = btn.dataset.act as Action;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (act === 'sprint') {
          this.sprintButtonHeld = true;
          this.input.virtualHeld.add('sprint');
          btn.classList.add('on');
        } else if (act === 'crouch') {
          this.crouchOn = !this.crouchOn;
          if (this.crouchOn) this.input.virtualHeld.add('crouch');
          else this.input.virtualHeld.delete('crouch');
          btn.classList.toggle('on', this.crouchOn);
        } else if (act === 'pause') {
          onPause();
        } else {
          this.input.press(act);
        }
      });
      if (act === 'sprint') {
        const up = () => {
          this.sprintButtonHeld = false;
          this.input.virtualHeld.delete('sprint');
          btn.classList.remove('on');
        };
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('pointerleave', up);
      }
    }
  }

  private sprintButtonHeld = false;

  private setKnob(dx: number, dy: number) {
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.el.hidden = !on;
    if (!on) {
      this.input.virtualMove.x = 0;
      this.input.virtualMove.y = 0;
      this.input.virtualHeld.clear();
      this.crouchOn = false;
    }
  }

  /** Hide while menus are open, without losing the enabled setting. */
  setVisible(v: boolean) {
    this.el.hidden = !(v && this.enabled);
  }
}
