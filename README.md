# Modulo: Escape

A first-person horror game in the browser. It's night, and you're trapped inside an abandoned,
procedurally generated KZU school building: several floors of raw-concrete corridors,
classrooms, halls and stairwells. Flickering fluorescent tubes light the way. You wake up on a
random upper floor; the only way out is a gate on the ground floor. Find it before Robin finds you.

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
hold Q to look back (keep running forward) · left click or G to shoot (when you have a gun) ·
Esc/P to pause · F3 for the debug overlay · F4 for the debug menu (mood, materials). Touch controls
(joystick, Run, Duck, Light, Back, and Shoot while you carry a gun) are on by default; turn them off in Settings.

## The game

- **Building:**
  - Seeded generator (`src/gen`): 2–4 floors joined by U-shaped stairwells (two half flights
    with a landing between them).
  - You start on a random upper floor; the exit gate is always on the ground floor, far along
    the path, so you have to find your way down.
  - Corridors form loops so you can circle away from the monster, with only a few deliberate dead
    ends.
  - Classrooms have a blackboard, a teacher's desk and rows of desks; small rooms are offices or
    store rooms.
- **KZU:** rooms are numbered like the real school, with the floor as the prefix: E07 on the
  ground floor (Erdgeschoss), 112 on the first floor, 204 on the second. Each door has an enamel
  plate, and a green "Ausgang" sign hangs over the exit gate.
- **Robin:** the monster is a 3.1 m sculpted, skinned humanoid with `robin.png` as its face
  (`src/ai/robinBody.ts`).
  - **Senses:** it hears your footsteps (sprinting is loud, crouching is quiet) and chases you on
    sight.
  - **Escaping:** it loses you if you sprint out of view. If it hasn't seen you for a while, it
    stalks back, appearing a few rooms away out of your sight.
  - **Movement:** it ducks under doors and screams when it's near.
  - **Getting caught:** ends in a jump scare.
- **Leo** (wakes after ~18 s): a hulking, heavily muscled brute with his own sculpt, bare-chested: V-shaped torso, abs, a hump of
  muscle, a small head, arms as long as he is tall with huge fists, short bowed legs and ragged shorts. He walks on his knuckles like a gorilla and gallops on all fours when
  he charges. He hears best of all three. Spotting you from afar he creeps at you, staring; run or let him
  close and he rears up, roars and pounds his chest, then charges in a straight line much faster than you can run, but he can barely steer:
  dodge round a corner and he slams into the wall and staggers, clutching his head. Then he
  slams the floor (the lights stutter) and listens: keep walking and he knows exactly where you
  are; stand still or crouch and he has to search. As the hunter he sometimes waits for you in a
  doorway and lunges without a roar. Up close he hammers both fists down. You feel his stomps (camera shake) before you
  see him.
- **Jovan** (wakes after ~30 s): so tall (≈ 4.8 m, gaunt, black hollow eyes, in a ripped black shirt) that he walks
  stooped with his palms pressed flat against the ceiling, hand over hand. He sees furthest, and he only moves while you're not looking at him: keep him on
  screen and he freezes; look away (or look back with Q) and he comes, fast and almost silent.
  You hear his head dragging along the ceiling, and lights stutter around him.
- **Gun:** a pistol (Poly Haven, CC0) sometimes lies on the floor. Walk over it to pick it up
  (you carry one at most). It has one bullet: shoot a monster and it's stunned for 7–9 s, then
  slinks off and leaves you alone for a while before it comes back. The bang is loud: the others
  hear it. A hit monster bleeds and is knocked down (Jovan crumples), lies there twitching, then
  gets back up. The spent gun vanishes; another turns up somewhere else later.
- **Hiding:** crouch next to a classroom table or the teacher's desk ("HIDDEN" under the
  crosshair) and monsters that aren't already after you won't spot you unless they're right next
  to you.
- **Taking turns:** only one monster hunts you at a time; the others roam elsewhere, and one
  that spots you while you're already being chased just watches you, then backs off. When a
  monster is within ~14 m, tubes near you flicker red (and now and then one does with nothing
  there).
- **Faces:** each monster wears its photo (`robin.png`, `leo.png`, `jovan.png`); Leo's and Jovan's
  are made from the photos in `assets/leo/` and `assets/jovan/` by `python3 scripts/robin/make_faces.py`
  (aligned to robin.png's eye positions and cut out). A `<name>_scream.png` (Leo has one) replaces
  the face during that monster's jump scare. Without a photo a monster is faceless (hollow eyes
  and mouth).
  `?monsters=robin,leo` picks which ones spawn.
- **Sounds that warn you:** Robin giggling somewhere far off (muffled through the floors), Leo
  knocking on the walls while he searches, Jovan's ceiling scrape coming faster as he closes in,
  the building going quiet a moment before something rounds the corner, and very rarely your own
  footstep answered from behind.
- **Sound:** procedural HVAC drone that tightens as the monster gets close, your footsteps, and
  positional monster steps and screams. No audio files.
- **Debug mode:** press pause three times quickly (button, Esc, or tap "Paused") to unlock a
  Debug tab: invisible, can't be caught, freeze monsters, gun (give / drop here / go to nearest /
  infinite ammo), per-monster on/off / wake / bring to me / scare me, teleport to the exit.
- **Settings:** graphics presets, material comparison (Settings → Materials), monster on/off,
  key rebinding.

## Tools

| URL / command | What |
| --- | --- |
| `/robin/` | Monster viewer: orbit the model, switch idle / walk / run / attack / scream / roar / stunned / duck; `?who=leo` / `?who=jovan`, `?ceiling=1` |
| `/lab/` | Texture lab: compare material candidates |
| `/bench/` | Benchmark: fixed seed and camera path, frame times per preset |
| `npm run robin:build` | Re-sculpt Robin, Leo and Jovan (`scripts/robin/anatomy.ts` + `characters.ts`) → `public/assets/monster/*_body.glb` (~5 min) |
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
