# DECISIONS

Running log of technical decisions. Newest at the bottom.

| # | Date | Decision | Why |
|---|---|---|---|
| 1 | 2026-11-10 | Run in the `modulo-architect` cloud environment, with Sketchfab + GitHub release-asset hosts added | Default environment blocked every asset host. That environment already allowed Poly Haven/ambientCG, so no workaround was needed. |
| 2 | 2026-11-10 | WebGL2 `WebGLRenderer`, not WebGPU | Required by the brief; widest iPad coverage; mature post-processing ecosystem. |
| 3 | 2026-11-10 | `postprocessing` (pmndrs) instead of three's EffectComposer | Merges effects into fewer full-screen passes, which matters on iPad fill rate. |
| 4 | 2026-11-10 | sfc32 PRNG seeded with cyrb128, per-system sub-streams | Fast and good quality; sub-streams keep layouts stable when props/decals are added later. |
| 5 | 2026-11-10 | Generator is pure TS, runs in a Web Worker, lint-enforced boundary | Testable in Node at 1000+ seeds; keeps the UI responsive. |
| 6 | 2026-11-10 | Static colliders for the whole level are built once; only visuals stream | Cheap (cuboids), and the player can't fall through an unloaded chunk. |
| 7 | 2026-11-10 | Cell 4 m, storey 3.6 m, walls on cell edges, 4×4-cell chunks | Matches brutalist proportions; edges make door/window/wall assignment and overlap tests simple. |
| 8 | 2026-11-10 | KTX2: UASTC for normals, ETC1S/UASTC+RDO for albedo & ORM | Normal maps break badly under ETC1S; albedo/ORM tolerate it and download much smaller. |
| 9 | 2026-11-10 | Perf numbers come from real devices via `/bench`, not from the cloud container | Headless Chromium here renders on the CPU (SwiftShader). |
| 10 | 2026-11-10 | Hint system dropped | Your call at plan review. |
| 11 | 2026-11-10 | `@dimforge/rapier3d-compat` (WASM inlined as base64) instead of the bundler build | No separate .wasm fetch to break under Safari/Vercel/Vite; ~0.6 MB extra gzip is acceptable for now. Revisit if load time matters. |
| 12 | 2026-11-10 | Asset scripts use Node fetch with `NODE_USE_ENV_PROXY=1` | Node's built-in fetch ignores HTTPS_PROXY otherwise; harmless without a proxy. |
| 13 | 2026-11-10 | Poly Haven sources: JPG for albedo/ARM, PNG for normals, prefer packed ARM over separate maps | PNG everywhere was ~6× the download; JPG blocks only hurt normals. ARM is already our ORM layout. |
| 14 | 2026-11-10 | Hashed output names (`albedo_1k.<hash>.ktx2`) + manifest.json | Makes `/assets/*` safe to cache immutably. |
| 15 | 2026-11-10 | Models: `gltf-transform optimize` (meshopt default, `--draco` optional, KTX2 textures ≤ 1k) | One battle-tested pipeline; meshopt decodes faster and its decoder is smaller than Draco's. |
| 16 | 2026-11-10 | Kit pieces are lists of axis-aligned boxes; the same boxes build render geometry and physics colliders | Render and collision can never disagree; trivial to rotate by 90° steps. |
| 17 | 2026-11-10 | Greybox: one vertex-coloured material per chunk (+ puddles), props as InstancedMesh per type per chunk | Cut draw calls from 169 to 64 at a typical view. Phase 2 swaps to a handful of PBR materials per chunk. |
| 18 | 2026-11-10 | Level origin at the NW grid corner, +X east, +Z south, cell (x,z) centre at ((x+.5)·4, (z+.5)·4) | One convention for generator, builder, physics and minimap. |
| 19 | 2026-11-10 | Kinematic character controller (capsule r 0.32 m, 1.75 m / 1.1 m crouched), fixed 60 Hz step with camera interpolation | Stable collisions independent of frame rate; the step rate drops to 30 Hz for Battery Saver later. |
| 20 | 2026-11-10 | Changing seed/size or restarting does a full page navigation | Guarantees every GPU/WASM resource of the old level is freed (iPad memory), and the URL is always the share link. |
| 21 | 2026-11-10 | Pause stops `setAnimationLoop` entirely (one backdrop frame is rendered first); hidden tab auto-pauses | Zero GPU work while paused: battery. |
| 22 | 2026-11-10 | Pointer Lock first; on missing API or `pointerlockerror` fall back to click-drag look, with a toast | Never hard-fails on iPadOS Safari or locked-down browsers. |
| 23 | 2026-11-10 | Crouch defaults to C / Z, not Ctrl | Ctrl+W closes the browser tab. |
| 24 | 2026-11-10 | Autopilot that follows the generator's nav graph | Lets Playwright play every seed end to end and drives the /bench camera path. |
| 25 | 2026-11-10 | Touch controls auto-enable only for touch-only devices (`pointer: coarse` and no `any-pointer: fine`) | An iPad with a trackpad/mouse keeps Pointer Lock; anyone can force touch on/off in Settings. |
| 26 | 2026-11-10 | Minimap is fog-of-war (visited cells + one step of visibility) | A full map would trivialise the escape. |
| 27 | 2026-11-10 | Ceiling lights: instanced fixtures for every slot, plus a pool of 4 real PointLights reassigned to the nearest working fixtures on cell change | Real lights everywhere would blow the forward-rendering budget; pool size becomes a quality setting. |
| 28 | 2026-11-10 | Phase 1 quality presets (high/medium/low/battery) as a small `Quality` object applied at runtime; FPS cap by skipping vsyncs | Enough for the bench now; grows into the full preset system in Phase 2 without changing call sites. |
| 29 | 2026-11-10 | E2E full-run test uses a 640×400 viewport and 2 workers | CI renders on the CPU and sim time is capped per frame; a small canvas keeps the run under 2 minutes. |
