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
