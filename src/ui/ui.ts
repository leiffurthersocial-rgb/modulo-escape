/**
 * DOM UI: loading, title, HUD, pause, settings (incl. key remapping), win and credits screens.
 * Pure DOM, no framework. All text is KZU-flavoured but plain.
 */
import licenses from '../../assets/LICENSES.json';
import { bus } from '../core/events.ts';
import type { Game, GameState } from '../game/game.ts';
import { ACTIONS, DEFAULT_BINDINGS, keyLabel, loadMaterialPicks, resetSettings, resolvedQuality, saveSettings, settings, type Action } from '../game/settings.ts';
import type { PresetName, Quality } from '../render/quality.ts';
import { surfaceUniforms } from '../render/surface.ts';
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
  private staminaEl!: HTMLElement;
  private staminaFill!: HTMLElement;
  private hintEl!: HTMLElement;
  private toastEl = h('div', { class: 'toast', style: 'opacity:0' });
  private game: Game | null = null;
  private settingsReturn: HTMLElement | null = null;

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
    bus.on('quality:autoLowered', ({ to }) => this.toast(`Running slow: graphics lowered to ${to}`, 3000));
    bus.on('perf:suggest', ({ reason }) => this.suggestBattery(reason));
    if (game.touch.enabled && game.input.pointerLockSupported === false) this.toast('Touch controls enabled (change in Settings)', 3500);
    else if (game.touch.enabled) this.toast('Touch device detected: touch controls on (change in Settings)', 3500);
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
    } else if (state === 'paused') {
      this.show(this.pauseScreen);
    } else if (state === 'won') {
      this.buildWin(game, true);
      this.show(this.winScreen);
    } else if (state === 'scare') {
      this.show(null);
      this.hud.hidden = true;
      this.playScareOverlay(game);
    } else if (state === 'caught') {
      this.buildWin(game, false);
      this.show(this.winScreen);
      this.scareEl?.remove();
      this.scareEl = null;
    }
  }

  private suggestBattery(reason: 'frametime' | 'battery') {
    if (settings.graphics.preset === 'battery') return;
    const box = h(
      'div',
      { class: 'panel suggest' },
      h('p', {}, reason === 'battery' ? 'Battery is low.' : 'Frame rate has been low for a while.'),
      h('p', {}, 'Switch to Battery Saver? (30 fps, lighter effects; change any time in Settings → Graphics)'),
    );
    const close = () => box.remove();
    box.append(
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'primary',
          onclick: () => {
            settings.graphics.preset = 'battery';
            saveSettings('graphics');
            close();
          },
        }, 'Battery Saver'),
        h('button', { onclick: close }, 'Not now'),
      ),
    );
    this.el.append(box);
    setTimeout(close, 15000);
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
    if (game.touch.enabled) {
      game.input.lookMode = 'touch';
      game.setState('playing');
      return;
    }
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
        h('p', {}, 'The east wing of the KZU school has been sealed for years. You wake up on the top floor. Find the way out.'),
        this.seedBox(game),
        h('p', {}, `WASD move · Shift sprint (stamina) · C crouch · F flashlight · F3 debug · F4 materials/mood. Find the stairs down; the way out is on the ground floor. ${lockNote}`),
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

  private buildWin(game: Game, escaped: boolean) {
    this.winScreen.replaceChildren(
      h(
        'div',
        { class: 'panel' },
        h('div', {}, h('span', { class: 'stencil' }, escaped ? 'KZU · EXIT' : 'KZU')),
        h('h2', {}, escaped ? 'You got out' : 'It found you'),
        this.seedBox(game),
        h('p', {}, escaped ? 'Share the link: same seed, same building.' : 'Same building, another try?'),
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
    const check = (key: 'headBob' | 'invertY' | 'monster') => {
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
      ...field('Monster (next building)', check('monster')),
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
    const graphics = this.buildGraphics();
    graphics.hidden = true;
    const materials = h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:10px' },
      h('p', {}, 'Compare surfaces live: ◀ / ▶ switch the texture in the building behind this menu. Your choice is remembered; "Copy my picks" puts them on the clipboard to send me.'),
      this.game ? this.materialPicker() : h('p', {}, 'Load a building first.'),
    );
    materials.hidden = true;
    const panes: [string, HTMLElement][] = [['General', general], ['Graphics', graphics], ['Materials', materials], ['Keys', controls]];
    const tabs = panes.map(([label], i) => {
      const b = h('button', { class: i === 0 ? 'active' : '' }, label);
      b.onclick = () => {
        panes.forEach(([, p], j) => (p.hidden = j !== i));
        tabs.forEach((t, j) => t.classList.toggle('active', j === i));
        // Materials: clear backdrop, panel to the side, so the building is visible while comparing.
        b.closest('.screen')?.classList.toggle('compare', label === 'Materials');
        if (label === 'Materials') this.game?.renderFrame(0);
      };
      return b;
    });
    return h(
      'div',
      { class: 'screen', hidden: true },
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Settings'),
        h('div', { class: 'tabs' }, ...tabs),
        general,
        graphics,
        materials,
        controls,
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

  private buildGraphics(): HTMLElement {
    const g = settings.graphics;
    const wrap = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
    const render = () => {
      const q = resolvedQuality();
      const preset = h('select', { id: 'preset-select' });
      for (const [v, label] of [['ultra', 'Ultra'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['battery', 'Battery Saver'], ['custom', 'Custom']] as const) {
        preset.append(h('option', { value: v, selected: g.preset === v }, label));
      }
      preset.onchange = () => {
        const v = preset.value as PresetName;
        if (v === 'custom') {
          g.customBase = g.preset === 'custom' ? g.customBase : (g.preset as Exclude<PresetName, 'custom'>);
          g.custom = {};
        }
        g.preset = v;
        saveSettings('graphics');
        render();
      };
      const custom = g.preset === 'custom';
      const set = <K extends keyof Quality>(k: K, v: Quality[K]) => {
        g.custom[k] = v;
        saveSettings('graphics');
        render();
      };
      const sel = <K extends keyof Quality>(k: K, opts: [Quality[K], string][]) => {
        const e = h('select', { disabled: !custom });
        for (const [v, label] of opts) e.append(h('option', { value: String(v), selected: q[k] === v }, label));
        e.onchange = () => set(k, opts.find(([v]) => String(v) === e.value)![0]);
        return e;
      };
      const tick = (k: keyof Quality) => {
        const e = h('input', { type: 'checkbox', checked: Boolean(q[k]), disabled: !custom, style: 'width:22px;height:22px;accent-color:var(--accent)' });
        e.onchange = () => set(k, e.checked as never);
        return e;
      };
      const wd = h('input', { type: 'checkbox', checked: g.watchdog, style: 'width:22px;height:22px;accent-color:var(--accent)' });
      wd.onchange = () => {
        g.watchdog = wd.checked;
        saveSettings('graphics');
      };
      const row = (label: string, el: HTMLElement) => [h('label', {}, label), el];
      wrap.replaceChildren(
        h('div', { class: 'field' }, ...row('Preset', preset), ...row('Auto-lower when slow (watchdog)', wd)),
        h('p', {}, custom ? 'Custom: every option below is yours.' : 'Pick Custom to change individual options.'),
        this.game && (this.game.quality.textureTier !== q.textureTier || this.game.quality.hdriRes !== q.hdriRes)
          ? h('div', { class: 'row' }, h('p', {}, 'Texture size / sky resolution change on reload.'), h('button', { onclick: () => location.reload() }, 'Restart to apply'))
          : '',
        h(
          'div',
          { class: 'field' },
          ...row('Render scale (max pixel ratio)', sel('pixelRatioCap', [[2, '2.0'], [1.5, '1.5'], [1.25, '1.25'], [1, '1.0'], [0.75, '0.75'], [0.6, '0.6']])),
          ...row('FPS cap', sel('fpsCap', [[0, 'none'], [60, '60'], [30, '30']])),
          ...row('Sun shadows', sel('shadowMapSize', [[4096, '4096'], [2048, '2048'], [1024, '1024'], [512, '512'], [0, 'off']])),
          ...row('Flashlight shadows', tick('flashlightShadows')),
          ...row('Post-processing', tick('post')),
          ...row('Ambient occlusion', sel('ao', [['full', 'full res'], ['half', 'half res'], ['off', 'off (baked only)']])),
          ...row('Bloom', tick('bloom')),
          ...row('Light shafts', sel('lightShafts', [['full', 'full'], ['cards', 'simple'], ['off', 'off']])),
          ...row('Anti-aliasing', sel('antialias', [['smaa', 'SMAA'], ['fxaa', 'FXAA'], ['none', 'off']])),
          ...row('Depth of field', tick('dof')),
          ...row('Textures', sel('textureTier', [['2k', '2k'], ['1k', '1k'], ['512', '512']])),
          ...row('Anisotropy', sel('anisotropy', [[16, '16×'], [8, '8×'], [4, '4×'], [2, '2×'], [1, 'off']])),
          ...row('Sky (HDRI)', sel('hdriRes', [['2k', '2k'], ['1k', '1k']])),
          ...row('Draw distance', sel('chunkRadius', [[3, 'far'], [2, 'medium'], [1, 'near']])),
          ...row('Vegetation', sel('vegetation', [[1, '100%'], [0.7, '70%'], [0.5, '50%'], [0.3, '30%']])),
          ...row('Decals', sel('decals', [[1, 'all'], [0.85, 'most'], [0.5, 'few']])),
          ...row('Particles', sel('particles', [[1, '100%'], [0.7, '70%'], [0.5, '50%'], [0.25, '25%'], [0, 'off']])),
          ...row('Ceiling lights', sel('lightPool', [[8, '8'], [6, '6'], [4, '4'], [3, '3'], [2, '2']])),
          ...row('Physics rate', sel('physicsHz', [[60, '60 Hz'], [30, '30 Hz']])),
        ),
      );
    };
    render();
    return wrap;
  }

  /** F4 debug menu: mood (moonlit ↔ dark night), wetness and moss overrides. */
  toggleDebugMenu() {
    if (this.debugMenu) {
      this.debugMenu.remove();
      this.debugMenu = null;
      return;
    }
    const slider = (label: string, value: number, on: (v: number) => void) => {
      const val = h('span', { class: 'val' }, value.toFixed(2));
      const input = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(value) });
      input.addEventListener('input', () => {
        val.textContent = Number(input.value).toFixed(2);
        on(Number(input.value));
      });
      return [h('label', {}, label), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, input, val)];
    };
    this.debugMenu = h(
      'div',
      { class: 'panel debug-menu' },
      h('h2', {}, 'Debug'),
      h(
        'div',
        { class: 'field' },
        ...slider('Mood: moonlit ↔ dark night', settings.graphics.mood, (v) => {
          settings.graphics.mood = v;
          saveSettings('mood');
        }),
        ...slider('Wetness override', surfaceUniforms.uWetness.value, (v) => (surfaceUniforms.uWetness.value = v)),
        ...slider('Moss amount', surfaceUniforms.uMoss.value, (v) => (surfaceUniforms.uMoss.value = v)),
      ),
      h('h2', {}, 'Materials'),
      h('p', {}, 'Swap any surface live; your choice is remembered. "Copy my picks" puts them on the clipboard to send me.'),
      this.materialPicker(),
      h('p', {}, 'F4 closes. Mood and materials are saved; wetness/moss reset on reload (mood drives wetness).'),
    );
    this.el.append(this.debugMenu);
  }

  private debugMenu: HTMLElement | null = null;
  private scareEl: HTMLElement | null = null;

  /** Flash → shake (game side) → cut to black, timed from the jump-scare config. */
  private playScareOverlay(game: Game) {
    this.scareEl?.remove();
    const c = game.scare.config;
    // The 3D Robin scare plays on the model; the 2D face is only for the other bodies.
    const img = game.scare.robin ? undefined : game.monsterImage?.url;
    // Robin's face rushes the screen: main image + red/cyan offset copies for a glitchy split.
    const face = img
      ? h(
          'div',
          { class: 'scare-face' },
          h('img', { src: img, className: 'f-red', alt: '' }),
          h('img', { src: img, className: 'f-cyan', alt: '' }),
          h('img', { src: img, className: 'f-main', alt: '' }),
        )
      : null;
    const el = h('div', { class: 'scare' }, face, h('div', { class: 'scare-flash' }), h('div', { class: 'scare-vignette' }), h('div', { class: 'scare-black' }));
    el.style.setProperty('--black-at', `${c.blackAt}s`);
    el.style.setProperty('--hit-at', `${c.hitAt}s`);
    el.classList.toggle('scare-3d', game.scare.robin);
    el.style.setProperty('--black-len', `${Math.max(0.1, c.duration - c.blackAt)}s`);
    this.el.append(el);
    this.scareEl = el;
  }

  /** Per-category texture switcher (walls, floor, plaster, metal, brick, rubble, moss). */
  private materialPicker(): HTMLElement {
    const game = this.game!;
    const cats: [string, string][] = [
      ['concrete_wall', 'Concrete walls'],
      ['concrete_floor', 'Floor'],
      ['plaster', 'Plaster (classrooms)'],
      ['rusted_metal', 'Metal (frames, gate)'],
      ['brick', 'Brick (broken walls)'],
      ['rubble', 'Rubble'],
      ['moss_ground', 'Moss / dirt'],
    ];
    const wrap = h('div', { class: 'field mat-picker' });
    for (const [cat, label] of cats) {
      const ids = game.textures.idsInCategory(cat);
      if (!ids.length) continue;
      const sel = h('select', {});
      const current = loadMaterialPicks().picks[cat];
      for (const id of ids) sel.append(h('option', { value: id, selected: id === current }, id));
      const apply = () => {
        settings.materialPicks[cat] = sel.value;
        saveSettings('materials');
        const scale = loadMaterialPicks().tuning[cat]?.scale ?? 0.5;
        void game.assets.swapCategory(cat, sel.value, game.quality.textureTier, scale).then(() => game.renderFrame(0));
      };
      sel.onchange = apply;
      const step = (d: number) => () => {
        sel.selectedIndex = (sel.selectedIndex + d + ids.length) % ids.length;
        apply();
      };
      wrap.append(h('label', {}, label), h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:6px' }, h('button', { onclick: step(-1) }, '◀'), sel, h('button', { onclick: step(1) }, '▶')));
    }
    const copy = h('button', {
      onclick: () => {
        const json = JSON.stringify(loadMaterialPicks().picks, null, 2);
        navigator.clipboard?.writeText(json).then(
          () => this.toast('Material picks copied: paste them to Claude'),
          () => prompt('Copy your picks:', json),
        );
      },
    }, 'Copy my picks');
    const reset = h('button', {
      onclick: () => {
        settings.materialPicks = {};
        saveSettings('materials');
        location.reload();
      },
    }, 'Reset to defaults');
    return h('div', {}, wrap, h('div', { class: 'row', style: 'margin-top:8px' }, copy, reset));
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
    this.staminaFill = h('div', { class: 'stamina-fill' });
    this.staminaEl = h('div', { class: 'stamina', title: 'Stamina' }, this.staminaFill);
    this.hintEl = h('div', { class: 'hint' }, '');
    const pauseBtn = h('button', { class: 'hudbtn', onclick: () => game.setState('paused'), title: 'Pause' }, '❚❚');
    this.hud = h(
      'div',
      { class: 'hud', hidden: true },
      h('div', { class: 'crosshair' }),
      h('div', { class: 'topbar' }, pauseBtn),
      this.staminaEl,
      this.hintEl,
    );
    this.root.insertBefore(this.hud, this.el);
    let shown = 1;
    bus.on('player:stamina', ({ value, exhausted }) => {
      if (Math.abs(value - shown) < 0.004 && !exhausted) return;
      shown = value;
      this.staminaFill.style.transform = `scaleX(${value.toFixed(3)})`;
      this.staminaEl.classList.toggle('full', value >= 0.999);
      this.staminaEl.classList.toggle('exhausted', exhausted);
    });
  }

  get hudElement(): HTMLElement {
    return this.hud;
  }

  setHint(t: string) {
    this.hintEl.textContent = t;
  }

}
