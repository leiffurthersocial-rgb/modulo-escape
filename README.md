# Modulo: Escape

A first-person horror game in the browser. It's night, and you're trapped inside an abandoned,
procedurally generated building of the KZU school: several floors of raw-concrete corridors,
classrooms and stairwells. Flickering fluorescent tubes light the way. Find the exit gate on the
ground floor before Robin finds you.

Three.js + Rapier + Vite + TypeScript. Runs on desktop and iPad (touch controls, battery-saver preset).

## Play

```bash
npm install
```

```bash
npm run dev
```

Then open the URL it prints.

- `?seed=abc123&size=small|medium|large`: same seed, same building (the win screen has a share link)
- `?quality=ultra|high|medium|low|battery`: force a graphics preset for one load
- `?monster=off|on|billboard|model`: no monster / force it on / the old floating-image Robin / the zombie test model

**Controls:** WASD to move · Shift to sprint (stamina bar) · C/Z to crouch · F for the flashlight ·
Esc/P to pause · F3 for the debug overlay · F4 for the debug menu (mood, materials). Touch controls
turn on automatically on touch-only devices.

## The game

- **Building:** seeded generator (`src/gen`) with multiple floors linked by stairwells. Corridors
  form loops so you can circle away from the monster, with only a few deliberate dead ends.
  Classrooms have a blackboard, a teacher's desk and rows of desks. Small rooms are offices or
  store rooms. Only the exit opens outside, onto a moonlit night.
- **Robin:** the monster is a 3.1 m sculpted, skinned humanoid with `robin.png` as its face
  (`src/ai/robinBody.ts`).
  - **Senses:** it hears your footsteps (sprinting is loud, crouching is quiet) and chases you on
    sight.
  - **Escaping:** it loses you if you sprint out of view. If it hasn't seen you for a while, it
    stalks back, appearing a few rooms away out of your sight.
  - **Movement:** it ducks under doors and screams when it's near.
  - **Getting caught:** ends in a jump scare.
- **Sound:** procedural HVAC drone that tightens as the monster gets close, your footsteps, and
  positional monster steps and screams. No audio files.
- **Settings:** graphics presets, material comparison (Settings → Materials), monster on/off,
  key rebinding.

## Tools

| URL / command | What |
| --- | --- |
| `/robin/` | Robin viewer: orbit the model, switch idle / walk / run / attack / scream / duck |
| `/lab/` | Texture lab: compare material candidates |
| `/bench/` | Benchmark: fixed seed and camera path, frame times per preset |
| `npm run robin:build` | Re-sculpt Robin's body (`scripts/robin/anatomy.ts`) → `public/assets/monster/robin_body.glb` (~1 min) |
| `npm run gen:dump -- --seed kzu --size medium` | Print a generated building as ASCII floor plans |
| `npm run assets:fetch` / `assets:process` | Download CC0 assets and convert them to KTX2 / meshopt (see SETUP.md) |
| `npm test` | Generator tests (1000 seeds × 3 sizes, loops / dead ends, golden layouts) |
| `npm run e2e` | Playwright smoke test and screenshots |
| `npm run typecheck`, `npm run lint` | TypeScript strict, ESLint |

**Replacing Robin:** commit any `robin.png` (anywhere in the repo) and it becomes the face and the
jump-scare image. If the new photo frames the face differently, adjust the eye positions in
`ROBIN_PHOTO` (`src/ai/robinBody.ts`).

## Credits and docs

Textures, models and night skies are CC0 (Poly Haven, ambientCG); sound effects are CC0 (Kenney Impact Sounds + RPG Audio, `npm run sounds:fetch`). See `assets/LICENSES.json` and
the in-game Credits. Robin's body, all animation, the screams, the HVAC drone and the reverb are generated in code.

See [PLAN.md](PLAN.md) for the plan and phases, [DECISIONS.md](DECISIONS.md) for every design
decision and why, and [SETUP.md](SETUP.md) for setup and the asset pipeline.
