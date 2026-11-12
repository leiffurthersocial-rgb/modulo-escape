# Plan: one endless floor of the KZU (not implemented yet)

Status: **an idea only, not to be built (your decision, 2026-11-12).** Single-floor KZU parts of it
(wings, room numbers, German signs, room uses, halls, set dressing) were built on the normal finite map.

**What you asked for:**
- One floor instead of several, and much bigger.
- More like the KZU, with rooms named by wing plus number (E07, 307 …), not "C".
- A school that keeps going as you walk, instead of one fixed map per seed.
- Exits that appear and disappear depending on where you are.
- All of it done so well that the player never notices.

**Your answers:**
- Wings use E, 1, 2, 3, 4 as names.
- You want special rooms, big halls and German signs.
- You want an endless school where places you return to look exactly the same.
- An exit appears somewhere far ahead.

---

## 1. What it will feel like

You start somewhere inside the KZU at night. The school goes on in every direction:

- **Wings:** classrooms, corridors and stair-hall-like crossings, grouped into wings that are
  each signed at their entrance: "Trakt 3 · Zimmer 301–323".
- **Special rooms:** the Chemie lab, the Mediothek, the Lehrerzimmer and so on.
- **Big halls:** every few minutes of walking you come across one, such as the Mensa, the Aula,
  the Turnhalle or a Pausenhalle. You recognise them when you pass them again.
- **The exit:** green "Notausgang" signs point you towards an exit somewhere ahead. Robin hunts
  you on the way.

If you turn round and walk back, every corridor, room, plate, stain and pushed barrel is where you
left it. There is never a visible seam, pop-in or wall that shifts.

---

## 2. How the endless school works

### 2.1 Blocks with fixed borders

- **Blocks:** the world is an endless grid of **blocks** of 12 × 12 cells (48 × 48 m).
- **Inputs:** a block's content depends **only on `(seed, bx, bz)`**. It never depends on the
  order you visit blocks in, or on what happened in the run.
- **Re-generation:** that means the game can forget a block and later rebuild it exactly the same.
- **Borders:** each border between two blocks has a **contract**, derived only from
  `(seed, border id)`. The contract says where the openings are (1–3 corridor openings, never
  zero) and what kind each is: main corridor, side corridor, or hall continuation.
- **Seamless edges:** both neighbours read the same contract, so corridors always line up across
  borders.
- **Wall ownership:** each wall on a border belongs to one side only (the block to the −x/−z), so
  no wall is ever built twice and there is no z-fighting.
- **Inside a block:** a **spine** of corridors connects all of the block's border openings. Rooms,
  halls and loops are placed off the spine, using the generator we already have, adapted to work
  inside one block.
- **Reachability:**
  - Every opening is connected through the spine.
  - Every border has at least one opening.
  - So the whole infinite school is connected by construction. No search over infinity is needed.

### 2.2 Wings (E, 1, 2, 3, 4) and names

- **Wings:** blocks are grouped into **wings** of about 2 × 2 blocks; one wing is about 20–23
  rooms.
- **Wing names:**
  - Each wing gets a prefix: E, 1, 2, 3 or 4.
  - Neighbouring wings never share a prefix.
  - The prefix is decided by a deterministic colouring of the wing grid.
- **Room numbers:**
  - Rooms are numbered **01–23 in walking order along the wing's main corridor**.
  - Odd numbers are on one side and even numbers on the other, like real buildings.
  - So you get E07, E08, 307, 312 …
- **Plates:**
  - Every door gets a German plate: "Zimmer 307".
  - Special rooms also show their function: "E12 · Chemie", "214 · Informatik".
  - Plates replace today's "C 1.01".
- **Wing entrances:**
  - Wing entrances get a big sign: "Trakt E", with the room range.
  - Corridor crossings get direction signs: "← 301–312 | 313–323 →", "Mensa →".

### 2.3 Special rooms and big halls

Each wing has a deterministic mix:

| Kind | Examples | Furniture (built from code, like the blackboard) |
|---|---|---|
| Classrooms (most rooms) | Zimmer | rows of desks, teacher's desk, blackboard (already built) |
| Labs | Physik, Chemie, Biologie | long lab benches with sinks and gas taps, fume hood, lab stools, chemical shelves |
| Informatik | Informatik | desks with monitors, cable trays |
| Musik | Musik | piano, music stands, chairs in a half circle |
| BG / Werken | Bildnerisches Gestalten | easels, big tables, paint-stained sinks |
| Small rooms | WC Damen/Herren, Hauswart, Lager, Lehrerzimmer, Sekretariat | cubicles and sinks, shelves, a sofa and coffee table, a counter |

**Big halls** are multi-block landmarks. One sits in each 4 × 4-block area, at a deterministic
spot:

- **Pausenhalle:** a wide atrium with pillars and benches. It's the meeting point of several wings.
- **Mensa:** long tables, a food counter with a tray rail.
- **Aula:** sloped rows of seats and a stage with a curtain. It's double height, still on the same
  floor.
- **Turnhalle:** a big empty hall with wall bars, basketball hoops and gym mats. It's double height
  and echoes, which is great for sound.
- **Mediothek:** rows of shelves, reading tables.

Landmarks are what make it feel like a real school and not a maze. They also help you find your
way.

### 2.4 Signs are in German

The signs are all in German:
- "Ausgang"
- "Notausgang" (green, with the running figure)
- "Zimmer 307"
- "Trakt 2"
- "Mensa", "Aula", "Turnhalle", "Mediothek", "Lehrerzimmer", "WC"
- fire-escape plans: "Fluchtwegplan – Sie sind hier"
- a few notices on pinboards

The KZU logo plates stay. All sign text is drawn from code into the decal atlas, so there are no
new downloads.

### 2.5 Set dressing: many more models, small things on tables

Your answer: "add more models to the school, e.g. sometimes a chess board on the table". The
school should feel lived in, then abandoned.

**Surface slots:**
- Furniture declares the surfaces things can stand on: desk tops, lab benches, shelf levels,
  counters, window sills, the floor along walls.
- Small props are placed on those surfaces deterministically per block, never floating and never
  intersecting.
- Examples:
  - a chess set mid-game on a table
  - books and binders on desks
  - a clipboard and pens on the teacher's desk
  - a mug, an apple
  - books on Mediothek shelves
  - microscopes on Bio benches
  - a boombox in Musik

**Little scenes:**
- Rare, hand-made arrangements are mixed in: a chess game abandoned mid-move in the Lehrerzimmer,
  a knocked-over chair with a backpack, a wheelchair alone in a corridor, a mop bucket with a
  wet-floor sign, a wall clock stopped at the same time everywhere.
- They're rare on purpose, so they stay memorable.

**Corridor and wall props:**
- fire extinguishers
- fire-alarm buttons
- bins
- benches
- potted plants (dried out)
- wall clocks
- pinboards
- security cameras in corners

**Models are free CC0 ones from Poly Haven, checked available:**

| Where | Models |
|---|---|
| Classrooms | `standing_chalkboard_01`, `binder_notebook`, `clipboard`, `book_encyclopedia_set_01`, `decorative_book_set_01`, `alarm_clock_01`, `food_apple_01`, `wall_clock` |
| Lehrerzimmer / Sekretariat | `chess_set`, `Sofa_01`, `ArmChair_01`, `CoffeeTable_01`, `metal_office_desk`, `desk_lamp_arm_01`, `drawer_cabinet`, `dartboard` |
| Labs | `industrial_microscope`, `vintage_microscope`, `magnifying_glass_01`, `medical_box` |
| Informatik | `circuit_board`, `metal_office_desk` (plus monitors built from code) |
| Musik | `boombox`, `portable_cassette_player` |
| Mediothek | `wooden_bookshelf_worn`, book sets, `side_table_01` |
| Mensa | `dining_table`, `dining_chair_02`, `plastic_monobloc_chair_01`, `plastic_crate_01..03` |
| Turnhalle | `football`, `dirty_football`, `american_football`, `painted_wooden_bench` |
| Hauswart / Lager | `metal_toolbox`, `wooden_ladder`, `multi_cleaner_bottle`, `bleach_bottle`, `cardboard_box_01`, `wooden_crate_01`, `trashbag` |
| Corridors | `korean_fire_extinguisher_01`, `fire_alarm`, `metal_trash_can`, `WetFloorSign_01`, `potted_plant_01/02/04`, `security_camera_01`, `wheelchair_01` |

**Performance on the iPad:**
- Small props use low-resolution textures (1k, or 512 px for tiny ones), shared between copies,
  and are drawn in batches per type.
- Small props are only drawn within ~15 m. In the dark you don't see them further away anyway.
- There's a cap on small props per block.
- The battery preset halves the density.
- Small props have no physics, except a few bigger ones like the chair or the bin. They're only
  drawn while their block is loaded, and they always come back identical.

---

## 3. Streaming, so you never notice

| Radius around the player | What exists |
|---|---|
| ≤ 1 block | everything: render, physics, props, lights |
| ≤ 2 blocks | render meshes + physics; Robin can be here |
| ≤ 3 blocks | generated data + navigation only (cheap, made in the background) |
| > 4 blocks | forgotten, except a small memory of changes (see 3.3) |

- **Background generation:** blocks are generated in a **Web Worker** (we already have one), 3
  blocks ahead.
- **Spread over frames:** meshes and physics for a block are built a little at a time, at most
  ~2 ms per frame. Nearest blocks and blocks in front of you go first. So there are no frame
  hitches on the iPad.
- **Nothing pops in where you could see it:**
  - Straight sightlines are capped at about 40 m: long corridors bend, end at a crossing, or pass
    through doors.
  - That is shorter than the build radius (≥ 96 m).
  - Darkness and haze already hide anything past ~30 m.
  - Blocks are only unloaded when they are behind you, out of view and past the keep radius. A
    small extra margin stops them loading and unloading back and forth.
- **Endless coordinates:** past ~1 km from the origin, the whole world (scene, physics, Robin)
  shifts back by whole blocks in one frame. This prevents floating-point jitter far out. It's
  invisible, because everything moves together.

### 3.1 Physics

- **One body per block:** each block's walls are one fixed physics body, added and removed with
  the block.
- **Never under someone:** a block is never removed while the player, Robin or a moving barrel is
  on it.

### 3.2 Navigation and Robin

- **Two-level navigation:**
  - Within a block, a cell graph.
  - Across blocks, a graph of the border openings.
  - Long chases use the block level; short ones use cells.
- **Robin's pathing:** Robin only paths through generated blocks.
- **Stalking still works:** the existing stalking (reappearing out of sight near you) stays the
  same. It just picks spots in loaded blocks.
- **Never out of reach:** if Robin ends up far away, he simply reappears near you later. He's
  never "lost" in an unloaded block.

### 3.3 Memory: what changes when you leave

- **What's remembered:** anything you changed is kept per block: pushed barrels, the exit gate,
  and which signs you have seen.
- **How long:** for the last ~64 visited blocks, which is several minutes of walking.
- **What it saves:** everything else is never stored, because it regenerates identically.
- **Old changes:** they fade only for blocks very far behind you, where you'd never notice.

---

## 4. Exits that come and go

There is always **one active exit**: an "Ausgang" vestibule with glass doors. They open onto a
small night courtyard with the gate (the current night sky and moonlight); walking out through
the gate wins.

**Placement:**
- The exit goes into a block **you have never seen**, 150–300 m away along the walkable path.
- Blocks have "exit-capable" spots: short dead-end corridors that normally end in a plain wall.
- Only for the chosen block, that wall becomes the exit vestibule.
- Since you never saw the block before, it was "always there".

**Despawning:**
- If you wander far away from an exit **you haven't seen yet**, it is quietly moved: its block is
  out of view, and a new spot is picked ahead of you.
- An exit **you have seen** never vanishes or moves. It stays in the block memory. The game can
  still offer a nearer unseen one if you have gone very far.

**Notausgang signs:**
- Signs at crossings point along the path to the active exit.
- An arrow only changes while it is out of view, so arrows never flip in front of you.
- Signs you have seen keep their direction until you're far away.

**Tension:** Robin's stalking gets more frequent the closer you are to the exit, so the last
100 m are the hardest. Otherwise Robin stays the same however long you play.

**Seeds:** a run still has a seed, and share links still work: the same seed gives the same
endless school. By default each new run gets a random seed.

---

## 5. Testing it so the player can't tell

These are automated tests, part of `npm test` and the Playwright run:

1. **Same everywhere:** generate blocks in random orders and on different "visits". The results
   must be byte-identical.
2. **Seamless borders:** for 10 000 random neighbouring block pairs, openings line up and there are
   no doubled or missing walls.
3. **Always connected:** in random 20 × 20-block windows, every walkable cell is reachable.
4. **No visible pop-in:** an autopilot walks for 10+ minutes and logs every block build, unload
   or exit change that happens in view or within 40 m. The test fails on any entry.
5. **Exits:** the exit is always reachable. It's never placed in a block you've seen, and a seen
   exit never moves.
6. **Endless running:** after a 30-minute soak test, memory and frame time stay flat, and there's
   no jitter after the world shifts back to the origin.
7. **Names:** room numbers are unique within a wing, neighbouring wings have different prefixes,
   and the odd/even sides are correct.

---

## 6. Order of work (each step playable and committed)

1. **One big floor + KZU names.** Remove the stairs and extra floors, make the single floor much
   bigger (finite for now), and add wing prefixes, room numbers and German plates and signs.
   *Quick and visible: you can judge the feel early.*
2. **Block generator:** blocks with border contracts, spines and wings, as pure code. Add tests
   1, 2, 3 and 7.
3. **Streaming:** background generation, building spread over frames, physics per block, the
   world shifting back to the origin, and block memory. Add tests 4 and 6.
4. **Robin in the endless school:** two-level navigation, stalking in loaded blocks.
5. **Exits:** exit-capable spots, placement and despawn rules, Notausgang signs, seen-tracking.
   Add test 5.
6. **KZU rooms, halls and set dressing:** furniture kits for labs, Informatik, Musik, BG, WCs and
   Lehrerzimmer; the landmark halls (Pausenhalle, Mensa, Aula, Turnhalle, Mediothek); and the
   Poly Haven props with surface slots and little scenes (section 2.5).
7. **QA on the iPad:** performance, battery preset, a long play session.

---

## 7. Decisions from your answers (2026-11-12)

- **Exact KZU likeness:** not important. Instead, many more models and small set dressing
  (section 2.5).
- **Robin:** stays the same however long you play. He doesn't ramp up over time; only the existing
  "more frequent near the exit" rule applies.
- **Seed:** a random seed for every run. Share links still reproduce a run.
