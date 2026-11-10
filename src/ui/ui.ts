/**
 * DOM UI: loading, title, HUD, pause, settings (incl. key remapping), win and credits screens.
 * Pure DOM, no framework. All text is KZU-flavoured but plain.
 */
import licenses from '../../assets/LICENSES.json';
import { bus } from '../core/events.ts';
import type { Game, GameState } from '../game/game.ts';
import { ACTIONS, DEFAULT_BINDINGS, keyLabel, resetSettings, saveSettings, settings, type Action } from '../game/settings.ts';
import type { LevelSize } from '../gen/types.ts';
import { randomSeed } from '../core/rng.ts';

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { class?: string; style?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, style, ...rest } = props as Record<string, unknown>;
  if (cls) el.className = cls as string;
  if (style) el.setAttribute('style', style as string);
  Object.assign(el, rest);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function formatTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function shareLink(seed: string, size: LevelSize): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('seed', seed);
  if (size !== 'medium') u.searchParams.set('size', size);
  return u.toString();
}

export function gotoSeed(seed: string, size: LevelSize) {
  // A full navigation frees every GPU/WASM resource of the old level (important on iPad).
  location.assign(shareLink(seed, size));
}

export class UI {
  readonly el = h('div', { class: 'ui' });
  private loadingScreen: HTMLElement;
  private titleScreen!: HTMLElement;
  private pauseScreen!: HTMLElement;
  private settingsScreen!: HTMLElement;
  private winScreen!: HTMLElement;
  private creditsScreen!: HTMLElement;
  private hud!: HTMLElement;
  private timerEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private toastEl = h('div', { class: 'toast', style: 'opacity:0' });
  private game: Game | null = null;
  private settingsReturn: HTMLElement | null = null;
  private rafTimer = 0;

  constructor(private root: HTMLElement) {
    this.loadingScreen = h(
      'div',
      { class: 'screen' },
      h('div', { class: 'panel' }, h('h1', {}, 'Modulo: Escape', h('small', {}, 'KZU · Wing C · condemned')), h('p', { id: 'loading-text' }, 'Generating building…')),
    );
    this.el.append(this.loadingScreen, this.toastEl);
    root.appendChild(this.el);
  }

  setLoadingText(t: string) {
    const el = this.loadingScreen.querySelector('#loading-text');
    if (el) el.textContent = t;
  }

  attach(game: Game) {
    this.game = game;
    this.loadingScreen.hidden = true;
    this.buildHud(game);
    this.titleScreen = this.buildTitle(game);
    this.pauseScreen = this.buildPause(game);
    this.settingsScreen = this.buildSettings();
    this.winScreen = h('div', { class: 'screen', hidden: true });
    this.creditsScreen = this.buildCredits();
    this.el.append(this.titleScreen, this.pauseScreen, this.settingsScreen, this.winScreen, this.creditsScreen);
    this.el.append(this.toastEl);
    this.show(this.titleScreen);
    bus.on('exit:opened', () => this.toast('The gate grinds open…'));
  }

  private screens(): HTMLElement[] {
    return [this.titleScreen, this.pauseScreen, this.settingsScreen, this.winScreen, this.creditsScreen];
  }

  private show(s: HTMLElement | null) {
    for (const x of this.screens()) x.hidden = x !== s;
    this.hud.hidden = s !== null;
  }

  onState(state: GameState, game: Game) {
    if (state === 'playing') {
      this.show(null);
      this.startTimer();
    } else if (state === 'paused') {
      this.show(this.pauseScreen);
    } else if (state === 'won') {
      this.buildWin(game);
      this.show(this.winScreen);
    }
    if (state !== 'playing') cancelAnimationFrame(this.rafTimer);
  }

  toast(msg: string, ms = 2200) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    clearTimeout((this.toastEl as unknown as { _t?: number })._t);
    (this.toastEl as unknown as { _t?: number })._t = window.setTimeout(() => (this.toastEl.style.opacity = '0'), ms);
  }

  private async copyLink(game: Game) {
    const link = shareLink(game.level.seed, game.level.size);
    try {
      await navigator.clipboard.writeText(link);
      this.toast('Share link copied');
    } catch {
      prompt('Copy this link:', link);
    }
  }

  private async play(game: Game) {
    const mode = await game.input.requestLock();
    if (mode === 'drag' && !game.input.pointerLockSupported) this.toast('Mouse capture unavailable: drag to look', 3500);
    else if (mode === 'drag') this.toast('Mouse capture was refused: click-drag to look', 3500);
    game.setState('playing');
  }

  // ───────── screens ─────────

  private seedBox(game: Game): HTMLElement {
    return h(
      'div',
      { class: 'seed-box' },
      h('span', {}, 'Seed ', h('code', {}, game.level.seed), h('span', { style: 'color:var(--muted)' }, ` · ${game.level.size}`)),
      h('button', { onclick: () => void this.copyLink(game), title: 'Copy share link' }, 'Copy link'),
    );
  }

  private sizePicker(game: Game): HTMLElement {
    const sel = h('select', { id: 'size-select' });
    for (const s of ['small', 'medium', 'large'] as LevelSize[]) sel.append(h('option', { value: s, selected: s === game.level.size }, s));
    return h('div', { class: 'field' }, h('label', { htmlFor: 'size-select' }, 'Building size (new seed)'), sel);
  }

  private newSeed(game: Game) {
    const sel = this.el.querySelector<HTMLSelectElement>('#size-select');
    const size = (sel?.value as LevelSize) || game.level.size;
    gotoSeed(randomSeed(), size);
  }

  private buildTitle(game: Game): HTMLElement {
    const lockNote = game.input.pointerLockSupported
      ? 'Click Enter to capture the mouse. Esc pauses.'
      : 'Mouse capture is not available here: drag to look, or enable touch controls in Settings.';
    return h(
      'div',
      { class: 'screen' },
      h(
        'div',
        { class: 'panel' },
        h('div', {}, h('span', { class: 'stencil' }, 'KZU')),
        h('h1', {}, 'Modulo: Escape', h('small', {}, 'Wing C · closed since the flood')),
        h('p', {}, 'The east wing of the KZU school has been sealed for years. Find the way out.'),
        this.seedBox(game),
        h('p', {}, `WASD move · Shift sprint · C crouch · F flashlight · M minimap · F3 debug. ${lockNote}`),
        h('div', { class: 'row' }, h('button', { class: 'primary', id: 'btn-enter', onclick: () => void this.play(game) }, 'Enter the building')),
        this.sizePicker(game),
        h(
          'div',
          { class: 'row' },
          h('button', { onclick: () => this.newSeed(game) }, 'New random seed'),
          h('button', { onclick: () => this.openSettings(this.titleScreen) }, 'Settings'),
          h('button', { onclick: () => this.show(this.creditsScreen) }, 'Credits'),
        ),
      ),
    );
  }

  private buildPause(game: Game): HTMLElement {
    return h(
      'div',
      { class: 'screen', hidden: true },
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Paused'),
        this.seedBox(game),
        h('div', { class: 'row' }, h('button', { class: 'primary', id: 'btn-resume', onclick: () => void this.play(game) }, 'Resume')),
        h(
          'div',
          { class: 'row' },
          h('button', { onclick: () => this.openSettings(this.pauseScreen) }, 'Settings'),
          h('button', { onclick: () => gotoSeed(game.level.seed, game.level.size) }, 'Restart'),
        ),
        this.sizePicker(game),
        h('div', { class: 'row' }, h('button', { onclick: () => this.newSeed(game) }, 'New random seed'), h('button', { onclick: () => this.show(this.creditsScreen) }, 'Credits')),
      ),
    );
  }

  private buildWin(game: Game) {
    this.winScreen.replaceChildren(
      h(
        'div',
        { class: 'panel' },
        h('div', {}, h('span', { class: 'stencil' }, 'KZU · EXIT')),
        h('h2', {}, 'You got out'),
        h('div', { class: 'big-time', id: 'win-time' }, formatTime(game.elapsedMs)),
        this.seedBox(game),
        h('p', {}, 'Share the link: same seed, same building.'),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'primary', onclick: () => gotoSeed(randomSeed(), game.level.size) }, 'New building'),
          h('button', { onclick: () => gotoSeed(game.level.seed, game.level.size) }, 'Run it again'),
        ),
      ),
    );
  }

  private buildCredits(): HTMLElement {
    const list = licenses as { name: string; author: string; license: string; sourceUrl: string; attributionRequired: boolean }[];
    const items = list.length
      ? list.map((l) => h('li', {}, `${l.name} by ${l.author} (${l.license}) `, h('a', { href: l.sourceUrl, target: '_blank', rel: 'noopener', style: 'color:var(--accent)' }, 'source')))
      : [h('li', {}, 'Greybox build: no third-party assets yet.')];
    return h(
      'div',
      { class: 'screen', hidden: true },
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Credits'),
        h('p', {}, 'Modulo: Escape. Built with three.js, Rapier and Vite.'),
        h('ul', { style: 'margin:0;padding-left:18px;line-height:1.6;font-size:14px' }, ...items),
        h('div', { class: 'row' }, h('button', { onclick: () => this.back() }, 'Back')),
      ),
    );
  }

  private back() {
    const g = this.game;
    if (!g) return;
    this.show(g.state === 'paused' ? this.pauseScreen : g.state === 'won' ? this.winScreen : this.titleScreen);
  }

  private openSettings(from: HTMLElement) {
    this.settingsReturn = from;
    this.settingsScreen.replaceWith((this.settingsScreen = this.buildSettings()));
    this.show(this.settingsScreen);
  }

  private buildSettings(): HTMLElement {
    const field = (label: string, input: HTMLElement, val?: HTMLElement) =>
      [h('label', {}, label), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, input, val ?? null)] as const;
    const range = (key: 'sensitivity' | 'fov' | 'masterVolume', min: number, max: number, step: number, fmt: (v: number) => string) => {
      const val = h('span', { class: 'val' }, fmt(settings[key]));
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(settings[key]) });
      input.addEventListener('input', () => {
        settings[key] = Number(input.value);
        val.textContent = fmt(settings[key]);
        saveSettings(key);
      });
      return [input, val] as const;
    };
    const check = (key: 'headBob' | 'invertY' | 'minimap') => {
      const input = h('input', { type: 'checkbox', checked: settings[key], style: 'width:22px;height:22px;accent-color:var(--accent)' });
      input.addEventListener('change', () => {
        settings[key] = input.checked;
        saveSettings(key);
      });
      return input;
    };
    const touchSel = h('select', {});
    for (const v of ['auto', 'on', 'off'] as const) touchSel.append(h('option', { value: v, selected: settings.touchControls === v }, v));
    touchSel.addEventListener('change', () => {
      settings.touchControls = touchSel.value as typeof settings.touchControls;
      saveSettings('touchControls');
    });

    const [sens, sensV] = range('sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
    const [fov, fovV] = range('fov', 60, 100, 1, (v) => `${v}°`);
    const [vol, volV] = range('masterVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    const general = h(
      'div',
      { class: 'field' },
      ...field('Look sensitivity', sens, sensV),
      ...field('Field of view', fov, fovV),
      ...field('Volume', vol, volV),
      ...field('Head-bob', check('headBob')),
      ...field('Invert look Y', check('invertY')),
      ...field('Minimap', check('minimap')),
      ...field('Touch controls', touchSel),
    );

    const keys = h('div', { class: 'keys' });
    const renderKeys = () => {
      keys.replaceChildren();
      for (const a of ACTIONS) {
        const codes = settings.bindings[a.id];
        keys.append(h('span', {}, a.label));
        for (let slot = 0; slot < 2; slot++) {
          const code = codes[slot];
          const btn = h('button', { title: 'Click, then press a key (Backspace clears)' }, code ? keyLabel(code) : '—');
          btn.addEventListener('click', () => this.captureKey(a.id, slot, btn, renderKeys));
          keys.append(btn);
        }
      }
    };
    renderKeys();
    const controls = h(
      'div',
      { hidden: true, style: 'display:flex;flex-direction:column;gap:10px' },
      keys,
      h(
        'div',
        { class: 'row' },
        h('button', {
          onclick: () => {
            settings.bindings = structuredClone(DEFAULT_BINDINGS);
            saveSettings('bindings');
            renderKeys();
          },
        }, 'Default keys'),
      ),
    );
    const tabGeneral = h('button', { class: 'active' }, 'General');
    const tabKeys = h('button', {}, 'Keys');
    tabGeneral.onclick = () => {
      general.hidden = false;
      controls.hidden = true;
      tabGeneral.classList.add('active');
      tabKeys.classList.remove('active');
    };
    tabKeys.onclick = () => {
      general.hidden = true;
      controls.hidden = false;
      tabKeys.classList.add('active');
      tabGeneral.classList.remove('active');
    };
    return h(
      'div',
      { class: 'screen', hidden: true },
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Settings'),
        h('div', { class: 'tabs' }, tabGeneral, tabKeys),
        general,
        controls,
        h('p', {}, 'Graphics presets and Battery Saver arrive with the real assets (Phase 2).'),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'primary', onclick: () => this.show(this.settingsReturn ?? this.titleScreen) }, 'Done'),
          h('button', {
            onclick: () => {
              resetSettings();
              this.openSettings(this.settingsReturn ?? this.titleScreen);
            },
          }, 'Reset all'),
        ),
      ),
    );
  }

  private captureKey(action: Action, slot: number, btn: HTMLButtonElement, done: () => void) {
    const g = this.game;
    if (!g) return;
    btn.classList.add('listening');
    btn.textContent = 'press…';
    g.input.captureNext = (code) => {
      const list = [...settings.bindings[action]];
      if (code === 'Backspace' || code === 'Delete') list.splice(slot, 1);
      else if (code !== 'Escape') {
        // A key can only drive one action: remove it elsewhere.
        for (const a of Object.keys(settings.bindings) as Action[]) {
          settings.bindings[a] = settings.bindings[a].filter((c) => c !== code);
        }
        list[slot] = code;
      }
      settings.bindings[action] = list.filter(Boolean).slice(0, 2);
      saveSettings('bindings');
      done();
    };
  }

  // ───────── HUD ─────────

  private buildHud(game: Game) {
    this.timerEl = h('span', { class: 'timer' }, '0:00.0');
    this.hintEl = h('div', { class: 'hint' }, '');
    const pauseBtn = h('button', { class: 'hudbtn', onclick: () => game.setState('paused'), title: 'Pause' }, '❚❚');
    this.hud = h(
      'div',
      { class: 'hud', hidden: true },
      h('div', { class: 'crosshair' }),
      h('div', { class: 'topbar' }, h('span', { class: 'seedtag' }, `seed ${game.level.seed}`), this.timerEl, pauseBtn),
      this.hintEl,
    );
    this.root.insertBefore(this.hud, this.el);
  }

  get hudElement(): HTMLElement {
    return this.hud;
  }

  setHint(t: string) {
    this.hintEl.textContent = t;
  }

  private startTimer() {
    const loop = () => {
      if (this.game) this.timerEl.textContent = formatTime(this.game.elapsedMs);
      this.rafTimer = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.rafTimer);
    this.rafTimer = requestAnimationFrame(loop);
  }
}
