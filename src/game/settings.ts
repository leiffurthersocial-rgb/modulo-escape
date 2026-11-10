/** Persistent player settings (localStorage). Every read/write is guarded: storage can be unavailable. */
import { bus } from '../core/events.ts';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'crouch'
  | 'flashlight'
  | 'interact'
  | 'pause'
  | 'minimap'
  | 'debug'
  | 'debugMenu';

export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'forward', label: 'Move forward' },
  { id: 'back', label: 'Move back' },
  { id: 'left', label: 'Strafe left' },
  { id: 'right', label: 'Strafe right' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'crouch', label: 'Crouch' },
  { id: 'flashlight', label: 'Flashlight' },
  { id: 'interact', label: 'Interact' },
  { id: 'minimap', label: 'Minimap' },
  { id: 'pause', label: 'Pause' },
  { id: 'debug', label: 'Debug overlay' },
  { id: 'debugMenu', label: 'Debug menu (mood)' },
];

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'KeyZ'],
  flashlight: ['KeyF'],
  interact: ['KeyE'],
  minimap: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  debug: ['F3', 'Backquote'],
  debugMenu: ['F4'],
};

import { PRESETS, defaultPreset, type PresetName, type Quality } from '../render/quality.ts';

export interface GraphicsSettings {
  preset: PresetName;
  /** Preset the custom values started from. */
  customBase: Exclude<PresetName, 'custom'>;
  custom: Partial<Quality>;
  /** Opt-in: step quality down automatically when frame time stays bad. */
  watchdog: boolean;
  /** 0 = sunlit, 1 = overcast. Debug menu slider. */
  mood: number;
}

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  headBob: boolean;
  touchControls: 'auto' | 'on' | 'off';
  minimap: boolean;
  masterVolume: number;
  bindings: Record<Action, string[]>;
  graphics: GraphicsSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  fov: 75,
  headBob: true,
  touchControls: 'auto',
  minimap: false,
  masterVolume: 0.8,
  bindings: DEFAULT_BINDINGS,
  graphics: { preset: defaultPreset(), customBase: 'high', custom: {}, watchdog: false, mood: 0.35 },
};

/** The quality settings currently in effect. */
export function resolvedQuality(): Quality {
  // ?quality=low etc. overrides for this page load only (tests, bench, screenshots).
  const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null;
  if (forced && forced in PRESETS) return PRESETS[forced as keyof typeof PRESETS];
  const g = settings.graphics;
  if (g.preset === 'custom') return { ...PRESETS[g.customBase], ...g.custom, name: 'custom' };
  return PRESETS[g.preset];
}

const KEY = 'modulo-escape.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      bindings: { ...structuredClone(DEFAULT_BINDINGS), ...(parsed.bindings ?? {}) },
      graphics: { ...structuredClone(DEFAULT_SETTINGS.graphics), ...(parsed.graphics ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export const settings: Settings = load();

export function saveSettings(changedKey = '*'): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode / blocked storage: settings just won't persist */
  }
  bus.emit('settings:changed', { key: changedKey });
}

export function resetSettings(): void {
  Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
  saveSettings();
}

/** Human-readable key name for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    Space: 'Space',
    Escape: 'Esc',
    Backquote: '`',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return map[code] ?? code;
}
