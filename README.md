# Modulo: Escape

A first-person browser game: escape a procedurally generated, derelict, overgrown
brutalist wing of the KZU school. Three.js + Rapier + Vite + TypeScript.

- Play: `npm install && npm run dev`, then open the printed URL. `?seed=abc123&size=small|medium|large`
- Benchmark: `/bench/` (fixed seed, fixed camera path, avg/p95 frame time per preset)
- Texture lab: `/lab/` (compare material candidates, pick favourites → `src/config/materials.json`)
- Force a preset for one load: `?quality=ultra|high|medium|low|battery`
- Tests: `npm test` (generator, 1000 seeds × 3 sizes), `npm run e2e` (Playwright smoke + screenshots)

Controls: WASD move · Shift sprint · C/Z crouch · F flashlight · M minimap · Esc/P pause · F3 debug overlay · F4 debug menu (mood).

All third-party assets are CC0 (Poly Haven, ambientCG); see `assets/LICENSES.json` and the in-game Credits.
Touch controls are enabled automatically on touch-only devices (Settings → Touch controls).

See [PLAN.md](PLAN.md), [DECISIONS.md](DECISIONS.md) and [SETUP.md](SETUP.md).
