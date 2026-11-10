# Modulo: Escape — PLAN

First-person browser game. Escape a procedurally generated, derelict, overgrown,
wet-tropical brutalist wing of the **KZU** school. Horror comes later; this plan
prepares hooks for it but does not build it.

Status: **approved 2026-11-10** (hint system dropped). Phase 1 (M0–M6) done. **Phase 2 (M7–M13) done, awaiting review.** Sketchfab declined → Poly Haven/ambientCG only.

---

## 0. Environment status (verified 2026-11-10)

| Host | Status | Notes |
|---|---|---|
| api.polyhaven.com | ✅ reachable | asset list + `/files/{id}` tested (200) |
| dl.polyhaven.org | ✅ reachable | 1k JPG download tested |
| ambientcg.com (API v2) | ✅ reachable | `full_json` tested; downloads via acg-download.struffelproductions.com (allowed) |
| api.sketchfab.com / sketchfab.com | ✅ reachable | search API tested. **Downloads need a Sketchfab API token** (free account). I'll ask for it through the secure credential form when we reach the model milestone. You never paste it into chat. |
| sketchfab-prod-media.s3.amazonaws.com | ✅ allowed | the host Sketchfab's signed download URLs point to |
| GitHub release assets | ✅ reachable | needed for the `toktx` (KTX-Software) binary |
| registry.npmjs.org | ✅ reachable | |

At first every asset host was blocked. I moved this session onto your existing
`modulo-architect` cloud environment, which already allowed Poly Haven and
ambientCG, and added the Sketchfab and GitHub-release hosts to it with your
approval. You don't need to run anything on your iPad. If a host ever gets blocked
again, the scripts still exist, SETUP.md lists the exact commands, and the game
falls back to greybox/placeholder materials.

---

## 1. Architecture

```
src/
  core/        seed hashing, PRNG (sfc32), sub-streams, event bus, fixed-step clock, types
  gen/         PURE generator: no Three.js, no DOM. seed+config → LevelData (JSON-serialisable)
    layout.ts      rooms/halls/corridors on a grid, loops, dead ends
    connect.ts     MST + extra loop edges, door/window/wall assignment per cell edge
    route.ts       BFS start/exit, min path length, solvability
    props.ts       seeded prop slots (debris near corners, vegetation near windows/holes)
    nav.ts         navigation graph export (cells, portals, distances) for future AI
  kit/         kit registry: piece id → factory (greybox in P1, glTF + material in P2)
  world/       world builder: LevelData + kit → chunks (merged static geo + InstancedMesh)
    streaming.ts   chunk load/unload by radius around player, with hysteresis + dispose()
  render/      renderer setup, quality system, presets, post-processing, lighting/mood
  physics/     Rapier world, static colliders from LevelData, props bodies
  player/      character controller (capsule), sprint/crouch/head-bob, flashlight
  input/       action map (remappable), keyboard/mouse, pointer lock, touch controls
  ui/          HUD, pause, settings, win screen, credits, debug overlay (F3), minimap
  audio/       audio manager stub (WebAudio context unlock, bus/volume), no assets yet
  director/    ambience director stub: subscribes to events, owns light-flicker hooks,
               sound cue hooks, spawn points (horror layer plugs in here later)
  game/        game state machine: Boot → Loading → Playing ⇄ Paused → Won
  lab/         /lab texture lab (Phase 2), separate entry
  bench/       /bench benchmark route, separate entry
scripts/       fetch-assets.ts, process-assets.ts (Node, run with tsx)
tests/         vitest unit tests; e2e/ Playwright
```

**Hard boundaries**
- `gen/` is pure TypeScript with no imports from three, rapier or DOM. A lint rule
  (`no-restricted-imports`) enforces this. It runs in Node and in a Web Worker.
- `world/` is the only layer that turns LevelData into meshes, and `physics/` the
  only one that turns it into colliders. Both read the same LevelData, so the visible
  geometry and the collision always match.
- Systems talk through a typed **event bus** (`player:enteredCell`, `door:opened`,
  `level:won`, `light:flicker`, `quality:changed`, …), so the horror layer can listen
  in without touching existing code.

**Main entry points (Vite multi-page):** `/` game, `/lab` texture lab, `/bench` benchmark.

### Seeds and determinism
- Seed string → `cyrb128` hash → `sfc32` PRNG.
- **Sub-streams per system**: `rng("layout")`, `rng("props")`, `rng("materials")`,
  `rng("decals")`. Each one is derived as hash(seed + ":" + name). Adding props or
  decals in Phase 2 therefore never changes the layout of an existing seed.
- `?seed=abc123&size=medium` in the URL. The pause menu shows the seed and has
  "copy share link" and "new random seed" buttons.
- Generation runs in a Web Worker (it's pure), so the UI never stalls on large maps.

### Grid and kit
- Cell = 4 m × 4 m, storey height 3.6 m, walls 0.3 m thick on cell edges.
- Sizes: small 12×12, medium 20×20, large 30×30 cells (configurable).
- Each cell edge holds one of `solid | door | window | open | broken`. Each cell holds
  floor/ceiling variants (`intact | hole | collapsed`) and a pillar flag at corners.
- Kit piece ids: `wall`, `wall_door`, `wall_window`, `wall_broken`, `floor`,
  `floor_hole`, `ceiling`, `ceiling_hole`, `pillar`, `stair`, `ramp`, `exit_gate`.
  Phase 2 replaces these by id with textured glTF modules. Nothing else changes.

### Generation algorithm
1. Place rooms (random rectangles, 1×1 up to 4×6 cells; some large multi-cell
   "halls" with pillar grids). Placement uses rejection sampling with a spacing margin.
2. Build a room-adjacency graph and take a minimum spanning tree, so everything is
   connected. Then add back about 10–25% of the remaining edges as **loops**.
3. Carve corridors (1 cell wide, sometimes 2) between connected rooms with grid A*,
   which creates junctions naturally. Add a few spur corridors as **dead ends**.
4. Assign edges: door between room and corridor, window on some exterior walls,
   occasional `broken` openings.
5. Start = a boundary cell. Exit = the cell farthest from the start by BFS
   (preferably on the opposite side). If the path is shorter than the minimum, retry
   with `attempt+1` in the seed derivation, which keeps it deterministic.
6. Stretch: a stairwell (2×2 cells) with stairs/ramp to a mezzanine level.
   LevelData supports `floors[]` from day one, so this is additive.
7. Export a nav graph: nodes = cells, edges = passable edges, plus precomputed
   distance-to-exit (for future AI).

**Tests (vitest, 1000+ seeds × 3 sizes):** solvable, fully connected (every
walkable cell is reachable), deterministic (same seed → deep-equal LevelData and the
same hash), no overlapping geometry (no two pieces claim the same edge or cell slot,
rooms don't overlap), minimum path length met, generation time under budget.

### Rendering and streaming
- Three.js `WebGLRenderer` (WebGL2), `three` pinned. Post-processing uses `postprocessing`
  (pmndrs), whose merged effect passes are cheaper than three's EffectComposer chain.
- Chunks = 4×4 cells. Per chunk: one merged `BufferGeometry` per material for static
  pieces, plus `InstancedMesh` for repeated props. Load radius R (quality-dependent),
  unload at R+1 with `dispose()`. Chunk bounds are tight, so frustum culling works.
- Physics colliders: all static cuboids for the whole level are built once. That's
  cheap (a few thousand cuboids for large maps), and the player can't fall through a
  chunk that hasn't loaded yet.
- Phase 1 lighting: hemisphere light, one directional sun with one shadow map that
  follows the player, exponential fog, flashlight SpotLight.

### Player and input
- Rapier `KinematicCharacterController` with a capsule (r 0.35 m, h 1.75 m; crouch
  1.1 m with a headroom check before standing). Fixed 60 Hz step, 30 Hz in Battery
  Saver, with render interpolation.
- Input action map: `moveF/B/L/R, sprint, crouch, flashlight, interact, pause,
  minimap, debug`. Remappable, persisted in localStorage.
- **Pointer Lock** on desktop and iPadOS Safari with trackpad/mouse. If
  `requestPointerLock` is missing, rejects, or fires `pointerlockerror`, the game
  falls back to click-drag look with a small notice, and never hard-fails.
- Touch controls: left virtual joystick, right look pad, sprint/flashlight/crouch/
  pause buttons, safe-area aware. Suggested automatically when
  `matchMedia('(pointer: coarse)')` matches and no fine pointer is present.

---

## 2. Milestones

Each milestone ends with a commit and a short summary. Playwright screenshots are
taken and checked by me after every visual change.

### Phase 0: Setup
- **M0 Scaffold and asset tooling.** Vite + TS strict, ESLint, Vitest, Playwright,
  `vercel.json` (immutable cache on `/assets/*`, `application/wasm`, `image/ktx2`),
  `.gitignore` (incl. `.asset-cache/`). `scripts/fetch-assets.ts` (Poly Haven,
  ambientCG v2, Sketchfab CC0/CC-BY only; rate-limited, at most 2 requests/s with
  backoff; descriptive User-Agent; cache in `.asset-cache/`; writes
  `assets/LICENSES.json`). `scripts/process-assets.ts` (toktx/KTX-Software →
  KTX2: UASTC for normal maps, ETC1S or UASTC+RDO for albedo/ORM; 512/1k/2k/4k
  tiers; ORM packing via sharp; glTF via gltf-transform with meshopt + Draco;
  outputs to `public/assets/`, prints size per tier). SETUP.md, DECISIONS.md.
  The scripts get a dry run in M0 with 2–3 assets each. The full fetch happens in M7.

### Phase 1: Core game, greybox
- **M1 Generator + tests.** PRNG, layout, connect, route, props slots, nav graph, the
  1000-seed vitest suite, and an ASCII dump CLI for debugging.
- **M2 World builder + greybox kit.** Flat-shaded, colour-coded pieces, chunk
  streaming, instancing, fog + sun, F3 overlay (FPS, frame ms, draw calls,
  triangles, geometries/textures, JS heap where available).
- **M3 Player and physics.** Rapier capsule, sprint, crouch, head-bob toggle,
  flashlight, pointer lock + fallback.
- **M4 Game loop and UI.** Seed in URL/HUD, copy link, new seed, exit gate that opens
  on approach, win screen (time + seed), pause/settings (sensitivity, FOV, head-bob,
  key remap), localStorage persistence, credits page stub.
- **M5 Extras and hooks.** Touch controls, minimap (off by default), placeholder
  props from the seeded slots, event bus, ambience director stub, audio stub.
  (No hint system: dropped at review.)
- **M6 QA and deploy.** Playwright smoke (fixed seed, desktop 1920×1080 and iPad
  1180×820 / 1366×1024, fails on console errors), `/bench` route (fixed seed,
  fixed spline camera, avg/p95 per preset), deploy check.
- **⏸ STOP: Phase 1 review.** Summary, screenshots, perf numbers, open issues,
  Phase 2 proposal.

### Phase 2: Real assets, quality, Battery Saver
- **M7 Asset fetch and processing.** Run the fetch for all categories, process all
  tiers, report sizes, write LICENSES.json, and add the in-game CREDITS page.
- **M8 Texture lab `/lab`.** Test room under the game's actual lighting; cycle
  candidates (≥ 8 concrete, plus plaster, rusted metal, wet floor, moss/ground,
  brick, rubble); split-screen compare; tiling/scale, wetness, moss/dirt sliders;
  show asset id, resolution, file size and VRAM estimate. Screenshots of every
  candidate go to `docs/texture-candidates/`. **Saving picks:** under `npm run dev`
  a small Vite dev-server endpoint writes `src/config/materials.json` directly. On
  the deployed site (your iPad), picks are stored in localStorage and an "Export
  picks" button copies the JSON, which you paste to me (or open as a prefilled
  GitHub issue) and I commit it.
- **M9 Textured kit.** PBR (albedo, normal, ORM) modules, triplanar for large
  slabs and UVs for trims, decals (cracks, stains, water streaks, KZU stencils,
  graffiti), vertex-colour dirt/moss blend, puddles with ripples, wet roughness.
- **M10 Lighting and mood.** AgX tone mapping, 1k–2k HDRI → PMREM at startup, a
  sunlit↔overcast mood slider (debug menu), fog/humidity, cheap light shafts
  (additive cone cards + fog-scattering approximation), GTAO/N8AO, bloom, SMAA,
  DoF (off by default), cascaded shadows on Ultra/High, baked per-module AO,
  SSR only on wet floors and only on Ultra (evaluated, dropped if too costly).
- **M11 Props and vegetation.** Rubble, debris, barrels, broken school chairs/desks,
  pipes, trash, ferns, vines, moss, trees at windows, roots through floors.
  Seeded placement, instanced, alpha-tested cards with dithered LOD fade.
- **M12 Quality presets and Battery Saver.** Ultra/High/Medium/Low/Battery
  Saver/Custom as below; the render loop pauses when the tab is hidden or the game
  is paused; auto-suggest on bad sustained frame time (or Battery API where it
  exists); opt-in thermal/FPS watchdog that steps down one notch at a time.
- **M13 iPad pass and perf.** `100dvh`, safe areas, viewport meta, touch and
  keyboard layouts, memory checks, bench numbers per preset.
- **⏸ STOP: Phase 2 review.**

---

## 3. Quality presets (as built — `src/render/quality.ts`)

| Setting | Ultra | High | Medium | Low | Battery Saver |
|---|---|---|---|---|---|
| Pixel ratio cap | 2.0 | 1.5 | 1.25 | 1.0 | 0.75 |
| FPS cap | none | 60 | 60 | 60 | 30 |
| Sun shadow map / extent | 4096 / 34 m | 2048 / 20 m | 1024 / 20 m | 512 / 20 m | off |
| Flashlight shadows | yes | yes | no | no | no |
| Post-processing | yes | yes | yes | yes | **off** (renderer AgX only) |
| AO | N8AO full | N8AO half | N8AO half | baked only | baked only |
| Bloom / light shafts | yes / full | yes / full | yes / simple | no / simple | no / off |
| AA | SMAA | SMAA | SMAA | FXAA | none |
| SSR | not implemented (see DECISIONS #39) | | | | |
| Texture tier | 2k | 2k | 1k | 1k | 512 |
| HDRI | 2k | 2k | 2k | 1k | 1k |
| Anisotropy | 16 | 8 | 4 | 2 | 1 |
| Chunk radius (6×6-cell chunks) / view distance | 2 / 72 m | 2 / 56 m | 2 / 40 m | 1 / 30 m | 1 / 20 m |
| Vegetation density | 100% | 100% | 70% | 50% | 30% |
| Decals | all | all | 85% | 50% | 50% |
| Dust particles | 100% | 70% | 50% | 25% | 0 |
| Ceiling point lights | 8 | 6 | 4 | 3 | 2 |
| Physics step | 60 Hz | 60 Hz | 60 Hz | 60 Hz | 30 Hz |

Default: High on desktop, Medium on touch devices / iPad. Battery Saver is suggested
after ~10 s of bad frame time (or a low Battery API reading where it exists; Safari has
none). The opt-in watchdog steps down one preset at a time. The render loop stops while
paused or hidden.
All settings persist in localStorage. "Custom" exposes every row.

---

## 4. Budgets

### iPad memory budget (target: under ~900 MB total, hard cap 1 GB)
iPadOS Safari kills tabs at around 1–1.5 GB on 4–8 GB devices, and WebGL memory
counts toward that limit.

| Bucket | High (iPad default) | Battery Saver |
|---|---|---|
| Textures (KTX2 → ASTC 4×4 on Apple GPUs, ≈1 B/px + 33% mips) | ≤ 300 MB | ≤ 100 MB |
| Geometry (VBO/IBO, loaded chunks + instanced props) | ≤ 80 MB | ≤ 40 MB |
| Render targets (post chain at capped resolution) | ≤ 150 MB | ≤ 40 MB |
| Shadow maps + PMREM/env | ≤ 40 MB | ≤ 10 MB |
| JS heap (incl. Rapier WASM, LevelData, decoders) | ≤ 200 MB | ≤ 150 MB |
| Audio buffers (later) | ≤ 50 MB | ≤ 30 MB |
| **Total** | **≤ ~820 MB** | **≤ ~370 MB** |

Rough math: one 2k PBR set (3 maps) ≈ 16 MB in ASTC; at 1k ≈ 4 MB. That allows
~12 unique 2k material sets plus 1k props/decals at High. Materials are shared
across all instances, and chunk unload disposes geometry, not shared materials.
Render scale is capped so the internal resolution stays ≤ ~3.2 MP on iPad.

### Asset budgets
| Asset | Triangles | Textures |
|---|---|---|
| Kit module (wall, floor, …) | ≤ 2k | shared tiling sets, no unique maps |
| Small prop (trash, can, brick) | ≤ 1.5k | ≤ 512 (atlas preferred) |
| Medium prop (chair, desk, barrel, pipe) | ≤ 5k | ≤ 1k |
| Large prop (collapsed slab, rubble pile) | ≤ 12k | ≤ 2k |
| Plant / fern / vine clump | ≤ 3k (alpha cards) | ≤ 1k atlas |
| Tree at window (seen through openings) | ≤ 15k | ≤ 2k |
| HDRI | — | 1k (Battery/Low), 2k (others), PMREM'd at startup |
| **Visible scene** | ≤ 1.5M tris High / ≤ 400k Battery | draw calls ≤ 300 High / ≤ 120 Battery |
| **Download (shipped tiers)** | — | initial load ≤ 40 MB at 1k, ≤ 90 MB at 2k |

---

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| iPad Safari tab kill / WebGL context loss under memory pressure | budgets above; KTX2 everywhere; dispose on chunk unload; `webglcontextlost` handler that reloads the level from the seed and keeps the timer |
| Headless Chromium in this cloud renders with SwiftShader (CPU), so **perf numbers from here aren't representative** | the `/bench` route shows results on screen with a "copy results" button; real numbers come from you running it on your iPad/desktop via the Vercel URL. CI numbers are only for relative comparison |
| Pointer Lock on iPadOS Safari is inconsistent | feature-detect, handle `pointerlockerror`, drag-look fallback, touch controls |
| Rapier WASM / KTX2 transcoder loading and MIME types on Vercel | non-`compat` Rapier build with `vite-plugin-wasm`; basis transcoder copied to `/assets/basis/`; explicit `Content-Type` in `vercel.json` |
| SSR / volumetrics too expensive | SSR only on Ultra and wet floors; light shafts as cheap cards; dropped if they cost > 2 ms on the High preset |
| Sketchfab licence ambiguity | API filter `license=cc0` / `by` only; licence re-checked per model at download; author + URL recorded; CC-BY → attribution in CREDITS |
| Sketchfab download needs your token | asked for through the secure credential form at M11; Poly Haven models cover most categories anyway |
| Generator edge cases (unsolvable or overlapping) | 1000+ seed property tests × 3 sizes in CI; deterministic retry with attempt counter |
| Vercel auto-deploy needs a one-time link to the GitHub repo | I add `vercel.json`; you connect the repo once in the Vercel dashboard (works from iPad Safari). I'll give the exact steps in M6 |
| Lab "save picks" cannot write to the repo from the deployed site | dev-server endpoint locally, export/paste flow on iPad (see M8) |
| Seed stability across phases | per-system PRNG sub-streams; a "golden seeds" snapshot test locks the layout hashes |

---

## 6. Horror hooks prepared (not built)
- Event bus with typed events, plus the ambience director stub that subscribes to
  them.
- Light registry: every placed light has an id, cell and a `flicker(intensity, ms)`
  API (no-op behaviour for now).
- Nav graph + distance fields from the generator (enemy pathing later).
- Spawn-point slots in LevelData (dark corners, dead ends, behind doors).
- Audio manager with buses (ambience / sfx / music / stingers), currently silent.
- Game-state machine with room for `Caught` / `GameOver` states.

---

## 7. Answered questions
1. Default map size: **medium**.
2. Timer counts from first movement: **yes**.
3. Hint system: **dropped**.
4. Vercel: not linked yet; steps given in M6.
