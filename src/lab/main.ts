/**
 * /lab — texture lab. A test room (walls with a window, floor, pillar, metal crate, rubble, a barrel)
 * lit by the game's own atmosphere (HDRI mood blend, sun, fog, post). Cycle candidates per category,
 * split-screen compare two of them, tune tiling / wetness / moss / mood, and pick favourites.
 *
 * Keys: ↑/↓ category · ←/→ candidate A · Shift+←/→ candidate B · C compare · P pick · H hide UI
 * Picks: saved to localStorage; under `npm run dev` also written to src/config/materials.json.
 * Playwright hook: window.__lab.show(cat, index) for screenshots.
 */
import '../style.css';
import * as THREE from 'three';
import materialsConfig from '../config/materials.json';
import type { LevelData } from '../gen/types.ts';
import { Atmosphere } from '../render/atmosphere.ts';
import { bindResize, createRenderer, DEFAULT_RENDER } from '../render/renderer.ts';
import { PostFX } from '../render/post.ts';
import { PRESETS } from '../render/quality.ts';
import { createSurfaceMaterial, surfaceUniforms } from '../render/surface.ts';
import { TextureLibrary, type PbrSet } from '../render/textures.ts';
import { vramEstimateBytes, type TexTierName } from '../render/assetManifest.ts';
import { boxesToSurfaceGeometry, type AABB } from '../world/boxMesh.ts';
import { PropLibrary, rubbleGeometry } from '../world/propModels.ts';
import { initPhysics } from '../physics/physicsWorld.ts';

const CATEGORIES = ['concrete_wall', 'concrete_floor', 'plaster', 'rusted_metal', 'wet_floor', 'moss_ground', 'brick', 'rubble'] as const;
type Cat = (typeof CATEGORIES)[number];
/** Which test-room surfaces show the candidate of each category. */
const TARGET: Record<Cat, Surface[]> = {
  concrete_wall: ['wall', 'pillar'],
  concrete_floor: ['floor'],
  plaster: ['wall'],
  rusted_metal: ['metal'],
  wet_floor: ['floor'],
  moss_ground: [],
  brick: ['wall'],
  rubble: ['rubble', 'floor'],
};
type Surface = 'wall' | 'floor' | 'pillar' | 'metal' | 'rubble';

const PICKS_KEY = 'modulo-escape.lab.picks.v1';

interface Picks {
  picks: Record<string, string>;
  tuning: Record<string, { scale: number }>;
}

function loadPicks(): Picks {
  const base = structuredClone(materialsConfig) as Picks;
  try {
    const saved = JSON.parse(localStorage.getItem(PICKS_KEY) ?? 'null') as Picks | null;
    if (saved) return { picks: { ...base.picks, ...saved.picks }, tuning: { ...base.tuning, ...saved.tuning } };
  } catch {
    /* ignore */
  }
  return base;
}

async function main() {
  const root = document.getElementById('app')!;
  const quality = PRESETS[(new URLSearchParams(location.search).get('quality') as keyof typeof PRESETS) ?? 'high'] ?? PRESETS.high;
  const renderer = createRenderer(root, { ...DEFAULT_RENDER, pixelRatioCap: quality.pixelRatioCap, shadowMapSize: 2048 });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  const post = new PostFX(renderer, scene, camera);
  bindResize(renderer, camera, root, (w, h) => post.setSize(w, h));
  await initPhysics();
  let tier: TexTierName = '1k';
  const lib = await new TextureLibrary(renderer, tier).init();
  lib.anisotropy = 8;
  const fake = { seed: 'lab', width: 3, height: 3, cellSize: 4, storeyHeight: 3.6 } as LevelData;
  const env = new Atmosphere(scene, fake, renderer, 2048);
  env.setShadows(2048, 10);
  await env.loadHdris(lib.manifest, '2k');
  const picks = loadPicks();
  env.setGroundSet(await lib.load(picks.picks.moss_ground ?? '', tier));
  post.configure(quality);

  // ── Test room ──
  const H = 3.6;
  const surf = () => [1, 0.6, 0.6] as [number, number, number];
  const room: Record<Surface, AABB[]> = {
    floor: [{ min: [-4, -0.25, -4], max: [4, 0, 4] }],
    wall: [
      // Back wall with a window opening.
      { min: [-4, 0, -4.3], max: [-1.2, H, -4] },
      { min: [1.2, 0, -4.3], max: [4, H, -4] },
      { min: [-1.2, 0, -4.3], max: [1.2, 0.95, -4] },
      { min: [-1.2, 2.45, -4.3], max: [1.2, H, -4] },
      // Left wall.
      { min: [-4.3, 0, -4.3], max: [-4, H, 4] },
      // Low broken wall section (shows brick/plaster at an angle).
      { min: [1.5, 0, 1.0], max: [4, 1.1, 1.3] },
    ],
    pillar: [{ min: [-1.6, 0, -0.9], max: [-0.9, H, -0.2] }],
    metal: [
      { min: [-1.25, 0.9, -4.34], max: [-1.15, 2.5, -3.96] },
      { min: [1.15, 0.9, -4.34], max: [1.25, 2.5, -3.96] },
      { min: [-1.25, 2.42, -4.34], max: [1.25, 2.5, -3.96] },
      { min: [2.2, 0, -2.6], max: [3.0, 0.8, -1.8] },
    ],
    rubble: [],
  };
  const fn = (_x: number, y: number) => {
    const s = surf();
    s[0] = 1 - 0.45 * Math.exp(-Math.max(0, y) / 0.4);
    s[1] = 0.45 * Math.exp(-y / 0.8) + 0.05;
    return s;
  };
  const meshes: Record<Surface, THREE.Mesh> = {} as Record<Surface, THREE.Mesh>;
  for (const k of Object.keys(room) as Surface[]) {
    if (!room[k].length) continue;
    const m = new THREE.Mesh(boxesToSurfaceGeometry(room[k], fn, 0.75), new THREE.MeshStandardMaterial());
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    meshes[k] = m;
  }
  const rubbleMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(rubbleGeometry(`lab-r${i}`), new THREE.MeshStandardMaterial());
    m.position.set(1.2 + i * 0.5, 0, 2.6 - i * 0.3);
    m.scale.setScalar(1.4);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    rubbleMeshes.push(m);
  }
  const props = new PropLibrary(renderer, lib.manifest);
  await props.load(['Barrel_01', 'SchoolChair_01', 'fern_02']);
  const place = (id: string, x: number, z: number, ry: number) => {
    const model = props.models.get(id);
    if (!model) return;
    for (const p of model.parts) {
      const mesh = new THREE.Mesh(p.geometry, p.material);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = ry;
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
  };
  place('Barrel_01', -2.8, -2.8, 0.4);
  place('SchoolChair_01', 0.6, 0.2, 2.4);
  place('fern_02', -3.3, 2.5, 0);

  // ── State ──
  let catIdx = 0;
  const idxA: Record<string, number> = {};
  const idxB: Record<string, number> = {};
  let compare = false;
  let uiHidden = new URLSearchParams(location.search).has('shot');
  const scale: Record<string, number> = {};
  for (const c of CATEGORIES) {
    const ids = lib.idsInCategory(c);
    idxA[c] = Math.max(0, ids.indexOf(picks.picks[c] ?? ''));
    idxB[c] = (idxA[c]! + 1) % Math.max(1, ids.length);
    scale[c] = picks.tuning[c]?.scale ?? 0.5;
  }
  const cat = () => CATEGORIES[catIdx]!;
  const ids = (c: Cat = cat()) => lib.idsInCategory(c);

  // Materials per surface for side A and B (A = everything at picks except the active category).
  const matsA = new Map<Surface, THREE.MeshStandardMaterial>();
  const matsB = new Map<Surface, THREE.MeshStandardMaterial>();
  const surfaceCat = (s: Surface, active: Cat): Cat => {
    if (TARGET[active].includes(s)) return active;
    return s === 'wall' || s === 'pillar' ? 'concrete_wall' : s === 'floor' ? 'concrete_floor' : s === 'metal' ? 'rusted_metal' : 'rubble';
  };
  const setFor = async (c: Cat, side: 'A' | 'B'): Promise<PbrSet | null> => {
    const list = ids(c);
    const i = side === 'A' || c !== cat() ? idxA[c]! : idxB[c]!;
    const id = c === cat() ? list[i] : picks.picks[c];
    return lib.load(id ?? '', tier);
  };
  const rebuild = async () => {
    const active = cat();
    for (const side of ['A', 'B'] as const) {
      const target = side === 'A' ? matsA : matsB;
      for (const s of ['wall', 'floor', 'pillar', 'metal', 'rubble'] as Surface[]) {
        const c = surfaceCat(s, active);
        const set = await setFor(c, side);
        target.get(s)?.dispose();
        target.set(s, createSurfaceMaterial({ set, scale: scale[c] ?? 0.5, color: 0x888888, mossFactor: s === 'metal' ? 0.15 : 1, tint: s === 'pillar' ? 0xd8d6cc : undefined }));
      }
    }
    const mossSetA = await (active === 'moss_ground' ? lib.load(ids('moss_ground')[idxA.moss_ground!] ?? '', tier) : lib.load(picks.picks.moss_ground ?? '', tier));
    surfaceUniforms.uMossMap.value = mossSetA?.map ?? null;
    surfaceUniforms.uMossScale.value = scale.moss_ground ?? 0.5;
    if (active === 'moss_ground') env.setGroundSet(mossSetA);
    updateInfo();
  };
  const assign = (mats: Map<Surface, THREE.MeshStandardMaterial>) => {
    for (const [s, m] of Object.entries(meshes) as [Surface, THREE.Mesh][]) m.material = mats.get(s)!;
    for (const r of rubbleMeshes) r.material = mats.get('rubble')!;
  };

  // ── UI ──
  const panel = document.createElement('div');
  panel.className = 'panel lab-panel';
  root.appendChild(panel);
  const info = document.createElement('pre');
  info.className = 'lab-info';
  const fmt = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${(b / 1024).toFixed(0)} KB`);
  const describe = (id: string | undefined) => {
    if (!id) return 'none';
    const e = lib.manifest.textures[id];
    if (!e) return id;
    const t = e.tiers[tier] ?? Object.values(e.tiers)[0]!;
    const all = Object.entries(e.tiers).map(([k, v]) => `${k} ${fmt(v.bytes)}`).join(' · ');
    return `${id}  (${e.source})\n  ${t.px}px · download ${fmt(t.bytes)} · VRAM ≈ ${fmt(vramEstimateBytes(t.px))}\n  tiers: ${all}`;
  };
  function updateInfo() {
    const c = cat();
    const list = ids(c);
    const a = list[idxA[c]!];
    const b = list[idxB[c]!];
    const picked = picks.picks[c];
    info.textContent =
      `Category ${catIdx + 1}/${CATEGORIES.length}: ${c}   (${list.length} candidates)\n` +
      `A ${idxA[c]! + 1}/${list.length}${a === picked ? '  ★ picked' : ''}: ${describe(a)}\n` +
      (compare ? `B ${idxB[c]! + 1}/${list.length}${b === picked ? '  ★ picked' : ''}: ${describe(b)}\n` : '') +
      `Tier ${tier}`;
  }
  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
    const wrap = document.createElement('label');
    wrap.className = 'lab-slider';
    const span = document.createElement('span');
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) });
    const refresh = () => (span.textContent = `${label} ${Number(input.value).toFixed(2)}`);
    input.oninput = () => {
      set(Number(input.value));
      refresh();
    };
    refresh();
    wrap.append(span, input);
    return { wrap, input, refresh };
  };
  const tiling = slider('Tiling (repeats/m)', 0.1, 2, 0.01, () => scale[cat()] ?? 0.5, (v) => {
    scale[cat()] = v;
    void rebuild();
  });
  const wet = slider('Wetness', 0, 1, 0.01, () => surfaceUniforms.uWetness.value, (v) => (surfaceUniforms.uWetness.value = v));
  const moss = slider('Moss / dirt', 0, 1.5, 0.01, () => surfaceUniforms.uMoss.value, (v) => (surfaceUniforms.uMoss.value = v));
  const mood = slider('Mood: sunlit ↔ overcast', 0, 1, 0.01, () => env.mood, (v) => {
    env.setMood(v);
    wet.input.value = String(surfaceUniforms.uWetness.value);
    wet.refresh();
  });
  const btn = (label: string, fnc: () => void, primary = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.onclick = fnc;
    return b;
  };
  const status = document.createElement('p');
  const pick = async () => {
    const c = cat();
    const id = ids(c)[idxA[c]!];
    if (!id) return;
    picks.picks[c] = id;
    picks.tuning[c] = { scale: scale[c] ?? 0.5 };
    try {
      localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
    } catch {
      /* ignore */
    }
    let saved = 'saved in this browser';
    try {
      const r = await fetch('/__lab/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(picks) });
      if (r.ok) saved = 'written to src/config/materials.json';
    } catch {
      /* not on the dev server */
    }
    status.textContent = `Picked ${id} for ${c} (${saved}). Use "Export picks" to send them to me.`;
    updateInfo();
  };
  const exportPicks = async () => {
    const json = JSON.stringify(picks, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      status.textContent = 'Picks copied to the clipboard: paste them to Claude.';
    } catch {
      prompt('Copy your picks:', json);
    }
  };
  const nav = (d: number, side: 'A' | 'B') => {
    const c = cat();
    const n = ids(c).length || 1;
    const rec = side === 'A' ? idxA : idxB;
    rec[c] = (rec[c]! + d + n) % n;
    void rebuild();
  };
  const setCat = (d: number) => {
    catIdx = (catIdx + d + CATEGORIES.length) % CATEGORIES.length;
    tiling.input.value = String(scale[cat()] ?? 0.5);
    tiling.refresh();
    void rebuild();
  };
  const tierSel = document.createElement('select');
  for (const t of ['512', '1k', '2k']) tierSel.append(new Option(t, t, false, t === tier));
  tierSel.onchange = () => {
    tier = tierSel.value as TexTierName;
    void rebuild();
  };
  panel.append(
    Object.assign(document.createElement('h2'), { textContent: 'KZU texture lab' }),
    info,
    rowOf(btn('◀ cat', () => setCat(-1)), btn('cat ▶', () => setCat(1)), btn('◀ A', () => nav(-1, 'A')), btn('A ▶', () => nav(1, 'A'))),
    rowOf(btn('Compare (C)', () => {
      compare = !compare;
      updateInfo();
    }), btn('◀ B', () => nav(-1, 'B')), btn('B ▶', () => nav(1, 'B')), tierSel),
    tiling.wrap,
    wet.wrap,
    moss.wrap,
    mood.wrap,
    rowOf(btn('★ Pick A (P)', () => void pick(), true), btn('Export picks', () => void exportPicks()), btn('Hide UI (H)', () => toggleUi())),
    status,
    Object.assign(document.createElement('p'), { textContent: '↑/↓ category · ←/→ candidate A · Shift+←/→ candidate B · C compare · P pick · drag to orbit' }),
  );
  function rowOf(...els: HTMLElement[]) {
    const r = document.createElement('div');
    r.className = 'row';
    r.append(...els);
    return r;
  }
  const toggleUi = (force?: boolean) => {
    uiHidden = force ?? !uiHidden;
    panel.hidden = uiHidden;
  };
  toggleUi(uiHidden);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp') setCat(-1);
    else if (e.code === 'ArrowDown') setCat(1);
    else if (e.code === 'ArrowLeft') nav(-1, e.shiftKey ? 'B' : 'A');
    else if (e.code === 'ArrowRight') nav(1, e.shiftKey ? 'B' : 'A');
    else if (e.code === 'KeyC') {
      compare = !compare;
      updateInfo();
    } else if (e.code === 'KeyP') void pick();
    else if (e.code === 'KeyH') toggleUi();
    else return;
    e.preventDefault();
  });

  // ── Camera: slow orbit, drag to rotate ──
  let yaw = 0.6;
  let pitch = 0.12;
  let dragging = false;
  renderer.domElement.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw -= e.movementX * 0.005;
    pitch = Math.max(-0.2, Math.min(0.8, pitch + e.movementY * 0.004));
  });
  const placeCam = () => {
    const r = 6.2;
    camera.position.set(Math.sin(yaw) * r * Math.cos(pitch), 1.6 + Math.sin(pitch) * r, Math.cos(yaw) * r * Math.cos(pitch));
    camera.lookAt(0, 1.1, -1.2);
  };

  await rebuild();
  const size = new THREE.Vector2();
  renderer.setAnimationLoop(() => {
    surfaceUniforms.uTime.value += 1 / 60;
    env.update();
    env.follow(new THREE.Vector3(0, 0, 0));
    placeCam();
    renderer.getSize(size);
    if (!compare) {
      assign(matsA);
      post.render(1 / 60);
    } else {
      // Split screen: left = A, right = B (post runs per half via scissor on the final output).
      // Compare view renders directly (no post) so both halves match: tone-map in the renderer.
      const tm = renderer.toneMapping;
      renderer.toneMapping = THREE.AgXToneMapping;
      renderer.setScissorTest(true);
      for (const [mats, x] of [[matsA, 0], [matsB, size.x / 2]] as const) {
        assign(mats);
        renderer.setScissor(x, 0, size.x / 2, size.y);
        renderer.setViewport(0, 0, size.x, size.y);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);
      renderer.toneMapping = tm;
    }
  });

  (window as unknown as { __lab: unknown }).__lab = {
    ready: true,
    categories: CATEGORIES,
    candidates: (c: Cat) => ids(c),
    async show(c: Cat, i: number) {
      catIdx = CATEGORIES.indexOf(c);
      idxA[c] = i;
      compare = false;
      await rebuild();
      await new Promise((r) => setTimeout(r, 600));
    },
  };
}

main().catch((e: unknown) => {
  console.error(e);
  document.body.append(String(e));
});
