/**
 * Game orchestration: loads the building, wires systems together and runs the loop.
 * State machine: loading → ready → playing ⇄ paused → won | caught.
 * Physics runs at a fixed step with render interpolation; the render loop stops
 * entirely while paused or when the tab is hidden.
 */
import * as THREE from 'three';
import { bus } from '../core/events.ts';
import { randomSeed } from '../core/rng.ts';
import { isLevelSize } from '../gen/config.ts';
import { cellCenter, cellIndex, SIDE_YAW } from '../gen/grid.ts';
import { kitPieces } from '../gen/kit.ts';
import { loadBuilding } from '../gen/load.ts';
import type { Building, LevelData, LevelSize } from '../gen/types.ts';
import { Input } from '../input/input.ts';
import { initPhysics, PhysicsWorld, propKey } from '../physics/physicsWorld.ts';
import { Player } from '../player/player.ts';
import { Atmosphere, INDOOR_ENV_COMP } from '../render/atmosphere.ts';
import { bindResize, createRenderer, DEFAULT_RENDER } from '../render/renderer.ts';
import { PostFX } from '../render/post.ts';
import { Dust } from '../render/shafts.ts';
import { surfaceUniforms } from '../render/surface.ts';
import { TextureLibrary } from '../render/textures.ts';
import { PerfMonitor } from '../render/perfMonitor.ts';
import { WorldAssets } from '../world/worldAssets.ts';
import { Outdoors } from '../world/outdoors.ts';
import { DebugOverlay } from '../ui/debugOverlay.ts';
import { ChunkManager } from '../world/chunks.ts';
import { ExitGate } from '../world/exitGate.ts';
import { buildStairsGeometry } from '../world/stairs.ts';
import { loadMaterialPicks, resolvedQuality, saveSettings, settings } from './settings.ts';
import { Autopilot } from './autopilot.ts';
import { JumpScare } from './jumpscare.ts';
import { lowerPreset, PRESETS, type Quality } from '../render/quality.ts';
import { AmbienceDirector } from '../director/director.ts';
import { AudioManager } from '../audio/audio.ts';
import { isTouchOnlyDevice, TouchControls } from '../input/touch.ts';
import { NavQuery } from '../ai/navQuery.ts';
import { Senses } from '../ai/senses.ts';
import { EntityManager, type EntityContext } from '../ai/entities.ts';
import { Monster } from '../ai/monster.ts';
import { loadMonsterModel, type MonsterModel } from '../ai/monsterModel.ts';
import { loadMonsterImage, type MonsterImage } from '../ai/monsterImage.ts';
import { loadRobinBody, type RobinTemplate } from '../ai/robinBody.ts';

export type GameState = 'ready' | 'playing' | 'paused' | 'won' | 'scare' | 'caught';

export interface GameHooks {
  onState(state: GameState, game: Game): void;
  onDebugMenu?(): void;
}

export class Game {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly input: Input;
  readonly player: Player;
  readonly physics: PhysicsWorld;
  /** One chunk manager per floor; its root sits at the floor's elevation. */
  readonly floorChunks: ChunkManager[];
  readonly gate: ExitGate;
  readonly env: Atmosphere;
  readonly overlay: DebugOverlay;
  readonly post: PostFX;
  readonly outdoors: Outdoors;
  readonly perf = new PerfMonitor();
  readonly nav: NavQuery;
  readonly senses: Senses;
  readonly entities: EntityManager;
  dust: Dust | null = null;
  private gateMat: THREE.MeshStandardMaterial;
  private stairsMesh: THREE.Mesh | null = null;
  state: GameState = 'ready';
  /** Play time in ms (not shown; kept for events/stats). */
  elapsedMs = 0;
  private acc = 0;
  private last = 0;
  private running = false;
  private cell = { floor: -1, x: -1, z: -1 };
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3(1, 1, 1);
  private tmpM2 = new THREE.Matrix4();
  private tmpM3 = new THREE.Matrix4();
  private unbindResize: () => void;
  stepHz = 60;
  quality: Quality;
  private lastRender = 0;
  readonly autopilot: Autopilot;
  readonly director: AmbienceDirector;
  readonly audio = new AudioManager();
  readonly touch: TouchControls;
  private offs: (() => void)[] = [];
  /** Nodes near a stairwell (both floors visible from there). */
  private nearStairs = new Set<number>();
  texVram = 0;
  /** Eye adaptation: current exposure multiplier, eased towards the target. */
  private adapt = 1;
  private time = 0;

  constructor(
    readonly root: HTMLElement,
    readonly building: Building,
    private hooks: GameHooks,
    renderer: THREE.WebGLRenderer,
    readonly textures: TextureLibrary,
    readonly assets: WorldAssets,
    env: Atmosphere,
    quality: Quality,
    scene: THREE.Scene,
    private monsterModel: MonsterModel | null = null,
    /** Robin (robin.png) if present: the monster's body and the face of the jump scare. */
    readonly monsterImage: MonsterImage | null = null,
    private robinBody: RobinTemplate | null = null,
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.env = env;
    this.stepHz = quality.physicsHz;
    this.nav = new NavQuery(building);
    this.physics = new PhysicsWorld(building, this.stepHz);

    this.floorChunks = building.floors.map((level) => {
      const cm = new ChunkManager(level, kitPieces(level), assets);
      cm.root.position.y = level.elevation;
      cm.root.updateMatrixWorld();
      cm.radius = quality.chunkRadius;
      cm.opts = { decals: quality.decals, vegetation: quality.vegetation };
      cm.dynamicMatrix = (i) => this.propMatrix(level, i);
      this.scene.add(cm.root);
      return cm;
    });
    const stairsGeo = buildStairsGeometry(building);
    if (stairsGeo) {
      this.stairsMesh = new THREE.Mesh(stairsGeo, assets.kit.get('floor')!);
      this.stairsMesh.castShadow = this.stairsMesh.receiveShadow = true;
      this.scene.add(this.stairsMesh);
    }
    this.computeNearStairs();

    const ground = building.floors[0]!;
    this.gateMat = assets.kit.get('metal')!.clone();
    this.gateMat.color.set(0xc08070);
    this.gate = new ExitGate(ground, this.gateMat);
    this.outdoors = new Outdoors(ground, assets, quality.vegetation, building.floors);
    this.scene.add(this.outdoors.group);
    this.scene.add(this.gate.object);
    this.physics.setGateBlocker(
      { x: this.gate.position.x, z: this.gate.position.z },
      building.exit.side === 'N' || building.exit.side === 'S',
      this.gate.width,
      this.gate.height,
    );

    const startLevel = building.floors[building.start.floor]!;
    const s = cellCenter(startLevel, building.start.x, building.start.z);
    this.player = new Player(this.physics, { ...s, y: startLevel.elevation }, SIDE_YAW[building.start.facing], settings.fov);
    this.player.floor = building.start.floor;
    this.scene.add(this.player.camera);
    this.post = new PostFX(this.renderer, this.scene, this.player.camera);
    this.unbindResize = bindResize(this.renderer, this.player.camera, root, (w, h) => this.post.setSize(w, h));

    this.input = new Input(this.renderer.domElement);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.setState('paused');
    };

    this.overlay = new DebugOverlay(root);
    this.overlay.extra = () => {
      const f = this.player.feet;
      const node = this.nav.nodeAt(f.x, f.y, f.z);
      return {
        chunks: this.floorChunks.map((c, i) => `${i}:${c.loadedCount}${c.root.visible ? '' : '(h)'}`).join(' '),
        colliders: this.physics.staticColliderCount,
        cell: `floor ${this.player.floor} · ${this.cell.x},${this.cell.z} → exit ${node >= 0 ? building.nav.distToExit[node] : '?'}`,
        pos: `${f.x.toFixed(1)}, ${f.y.toFixed(2)}, ${f.z.toFixed(1)}`,
        speed: `${this.player.speed.toFixed(1)} m/s${this.player.sprinting ? ' sprint' : ''}${this.player.crouching ? ' crouch' : ''} · stamina ${(this.player.stamina * 100).toFixed(0)}%`,
        look: this.input.lookMode,
        quality: `${this.quality.name}${this.post.enabled ? ' +post' : ''} tex ${this.quality.textureTier}`,
        entities: [...this.entities.entities.values()].map((e) => `${e.id}${'state' in e ? `:${String((e as Monster).state)}` : ''}`).join(', ') || 'none',
        assets: this.assets.textured ? `textured, tex VRAM ≈ ${(this.texVram / 1048576).toFixed(0)} MB` : 'greybox',
        seed: `${building.seed} (${building.size}, ${building.floors.length} floors)`,
      };
    };

    this.player.updateCamera(1, 0);
    this.env.follow(this.player.camera.position);
    this.updateFloors(true);

    this.senses = new Senses(this.physics);
    this.entities = new EntityManager(this.scene);
    this.autopilot = new Autopilot(this);
    this.director = new AmbienceDirector(this.scene, building, quality.lightPool);
    this.applyQuality(quality, true);
    void textures.vramEstimate().then((v) => (this.texVram = v));
    this.touch = new TouchControls(root, this.input, () => this.setState('paused'));
    this.applyTouchSetting();
    this.maybeSpawnMonster();
    this.offs.push(
      bus.on('settings:changed', ({ key }) => {
        if (key === 'touchControls' || key === '*') this.applyTouchSetting();
        if (key === 'graphics' || key === '*') this.applyQuality(resolvedQuality());
        if (key === 'mood') this.setMood(settings.graphics.mood);
      }),
    );
    document.addEventListener('visibilitychange', this.onVisibility);
    // iPadOS may drop the WebGL context under memory pressure: rebuild the same seed.
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
      setTimeout(() => location.reload(), 300);
    });
    bus.emit('level:loaded', { building });
  }

  /** Floor 0 for compatibility with single-floor helpers. */
  get level(): LevelData {
    return this.building.floors[0]!;
  }

  /**
   * The monster spawns on the start floor, as far from the player as the nav graph allows, and
   * wakes after 6 s. Settings → Monster turns it off (exploring); ?monster=off/on overrides.
   */
  private maybeSpawnMonster() {
    const q = new URLSearchParams(location.search).get('monster');
    if (q === 'off' || (q !== 'on' && q !== 'model' && !settings.monster)) return;
    const b = this.building;
    const startNode = b.start.floor * this.nav.N + cellIndex(b, b.start.x, b.start.z);
    const dist = bfsFrom(b.nav.adj, startNode);
    const cands = this.director.spawnPoints
      .map((p) => p.floor * this.nav.N + cellIndex(b, p.x, p.z))
      .filter((n) => Math.floor(n / this.nav.N) === b.start.floor && (dist[n] ?? -1) > 0);
    const node = cands.sort((x, y) => dist[y]! - dist[x]!)[0] ?? dist.indexOf(Math.max(...dist));
    if (node < 0) return;
    const kind = this.monsterModel ? 'model' : this.robinBody ? 'robin' : this.monsterImage ? 'image' : 'creature';
    const m = new Monster(b.seed, this.nav.nodePos(node), this.monsterModel, undefined, kind, this.monsterImage, this.robinBody);
    this.entities.add(m);
    this.monsterWakeAt = 6;
    this.monster = m;
  }
  private monster: Monster | null = null;
  readonly scare = new JumpScare();
  private monsterWakeAt = Infinity;

  private computeNearStairs() {
    const b = this.building;
    const N = this.nav.N;
    for (const s of b.stairs) {
      const cells: [number, number, number][] = [
        [s.lower, s.x, s.z - 1],
        [s.lower, s.x, s.z],
        [s.lower, s.x, s.z + 1],
        [s.lower + 1, s.x, s.z + 2],
      ];
      for (const [f, x, z] of cells) {
        const node = f * N + cellIndex(b, x, z);
        this.nearStairs.add(node);
        for (const n of this.nav.neighbors(node)) this.nearStairs.add(n);
      }
    }
  }

  /** Physics transform of a dynamic prop, in its floor's local space (chunk roots carry the elevation). */
  private propMatrix(level: LevelData, i: number): THREE.Matrix4 | null {
    const b = this.physics.dynamicProps.get(propKey(level.floor, i));
    if (!b) return null;
    const t = b.translation();
    const r = b.rotation();
    const p = level.props[i]!;
    this.tmpQ.set(r.x, r.y, r.z, r.w);
    this.tmpV.set(t.x, t.y - level.elevation - 0.45 * p.scale, t.z);
    this.tmpS.setScalar(p.scale);
    return this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
  }

  /** Touch controls on when forced on, or on 'auto' for touch-only devices. */
  applyTouchSetting(): boolean {
    const on = settings.touchControls === 'on' || (settings.touchControls === 'auto' && isTouchOnlyDevice());
    this.touch.setEnabled(on);
    this.touch.setVisible(this.state === 'playing');
    return on;
  }

  setState(s: GameState) {
    if (this.state === s) return;
    this.state = s;
    if (s === 'playing') {
      this.input.enabled = true;
      this.input.clearTransient();
      this.start();
    } else if (s === 'scare') {
      // Keep rendering (the scare is animated) but freeze the player.
      this.input.enabled = false;
      this.input.clearTransient();
      this.input.virtualMove.x = this.input.virtualMove.y = 0;
      this.start();
    } else {
      this.input.enabled = false;
      if (s !== 'won') this.input.releaseLock();
      // Paused/ended: render one last frame for the backdrop, then stop the loop to save power.
      this.renderFrame(0);
      this.stop();
    }
    this.touch.setVisible(s === 'playing');
    if (s === 'paused' || s === 'playing') bus.emit('game:paused', { paused: s === 'paused' });
    this.hooks.onState(s, this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.renderer.setAnimationLoop(this.tick);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private onVisibility = () => {
    if (document.hidden) {
      if (this.state === 'playing') this.setState('paused');
      this.stop();
    }
  };

  /** Apply a quality preset at runtime. Texture tier / HDRI size take effect on the next load. */
  applyQuality(q: Quality, initial = false) {
    const prev = this.quality;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioCap));
    this.renderer.shadowMap.enabled = q.shadowMapSize > 0 || q.flashlightShadows;
    this.env.setShadows(q.shadowMapSize, q.shadowDistance);
    this.player.setFlashlightShadows(q.flashlightShadows);
    this.textures.setAnisotropy(q.anisotropy);
    this.outdoors.viewDistance = q.viewDistance;
    const contentChanged = !initial && (prev.decals !== q.decals || prev.vegetation !== q.vegetation);
    for (const cm of this.floorChunks) {
      cm.radius = q.chunkRadius;
      cm.viewDistance = q.viewDistance;
      cm.opts = { decals: q.decals, vegetation: q.vegetation };
      if (contentChanged) cm.rebuildAll(this.player.feet.x, this.player.feet.z);
    }
    this.updateFloors(true);
    this.director.lights.setPoolSize(this.scene, q.lightPool);
    this.director.lights.assignNear(this.player.feet.x, this.player.feet.y, this.player.feet.z);
    this.stepHz = q.physicsHz;
    this.physics.world.timestep = 1 / q.physicsHz;
    if (initial || prev.particles !== q.particles) {
      if (this.dust) {
        this.scene.remove(this.dust.points);
        this.dust.dispose();
      }
      this.dust = q.particles > 0 ? new Dust(Math.round(700 * q.particles)) : null;
      if (this.dust) this.scene.add(this.dust.points);
    }
    this.post.configure(q);
    this.perf.reset();
    // Light count / shadow changes recompile shaders; materials must be told.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    bus.emit('quality:changed', { preset: q.name });
  }

  setMood(m: number) {
    this.env.setMood(m);
    bus.emit('mood:changed', { mood: m });
    if (!this.running) this.renderFrame(0);
  }

  private tick = (now: number) => {
    // FPS cap: skip this vsync if we're early (2 ms slack for timer jitter).
    if (this.quality.fpsCap > 0 && now - this.lastRender < 1000 / this.quality.fpsCap - 2) return;
    const frameMs = now - this.lastRender;
    this.lastRender = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.renderFrame(dt);
    if (this.state === 'playing' && frameMs < 1000) {
      const target = 1000 / (this.quality.fpsCap || 60);
      if (this.perf.push(frameMs, target, now, this.quality.name === 'battery', settings.graphics.watchdog)) {
        const next = lowerPreset(this.quality.name);
        if (next) {
          settings.graphics.preset = next;
          saveSettings('graphics-auto');
          this.applyQuality(PRESETS[next]);
          bus.emit('quality:autoLowered', { to: next });
        }
      }
    }
  };

  private update(dt: number) {
    const input = this.input;
    this.time += dt;
    if (this.state === 'scare') {
      // Only the scare runs: monster animation + camera; then the caught screen.
      for (const e of this.entities.entities.values()) e.update(dt, this.entityContext());
      if (this.scare.update(dt, this.player)) this.setState('caught');
      return;
    }
    this.autopilot.update();
    if (input.pressed('debug')) this.overlay.toggle();
    if (input.pressed('debugMenu')) this.hooks.onDebugMenu?.();
    if (input.pressed('flashlight')) this.player.setFlashlight(!this.player.flashlightOn);
    if (input.pressed('pause')) {
      this.setState('paused');
      return;
    }
    const look = input.consumeLook();
    this.player.look(look.dx, look.dy);

    // Fixed-step physics.
    const step = 1 / this.stepHz;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= step && steps < 5) {
      this.player.step(step, input);
      this.physics.step();
      this.acc -= step;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    this.player.floor = this.nav.floorAt(this.player.feet.y);
    bus.emit('player:stamina', { value: this.player.stamina, exhausted: this.player.exhausted });
    this.elapsedMs += dt * 1000;

    this.syncDynamicProps();
    this.checkCell();
    this.checkExit();
    this.gate.update(dt);
    this.director.update(dt);
    this.senses.update(dt);
    if (this.monster && this.monster.state === 'dormant' && this.time > this.monsterWakeAt) this.monster.wake();
    if (this.monster) {
      // Tension for the ambience: chase = 1, otherwise rises as it gets close on the same floor.
      const m = this.monster;
      const sameFloor = m.floor === this.player.floor;
      const d = m.position.distanceTo(this.player.feet);
      const near = sameFloor ? Math.max(0, 1 - d / 22) * 0.6 : 0;
      this.audio.setTension(m.state === 'chase' ? 1 : m.state === 'investigate' ? Math.max(near, 0.4) : near);
    }
    if (this.entities.entities.size) this.entities.update(dt, this.entityContext());
  }

  private entityContext(): EntityContext {
    const p = this.player;
    return {
      building: this.building,
      nav: this.nav,
      senses: this.senses,
      time: this.time,
      player: {
        position: p.feet,
        eye: p.camera.position,
        floor: p.floor,
        crouching: p.crouching,
        sprinting: p.sprinting,
        flashlightOn: p.flashlightOn,
      },
      catchPlayer: (by) => {
        if (this.state !== 'playing') return;
        bus.emit('player:caught', { by });
        this.scare.start(by, this.monster, this.player, (dir, max) => {
          const from = this.player.camera.position.clone();
          for (let d = 0.3; d <= max; d += 0.2) {
            if (!this.senses.lineOfSight(from, from.clone().addScaledVector(dir, d + 0.6), this.player.collider)) return d;
          }
          return max;
        });
        this.setState('scare');
      },
    };
  }

  /** Stream + show the current floor; the adjacent floor too when standing near a stairwell. */
  updateFloors(force = false, at?: THREE.Vector3) {
    const f = at ?? this.player.feet;
    const node = this.nav.nodeAt(f.x, f.y, f.z);
    const cur = this.nav.floorAt(f.y);
    const near = node >= 0 && this.nearStairs.has(node);
    this.floorChunks.forEach((cm, i) => {
      const show = i === cur || (near && Math.abs(i - cur) === 1);
      cm.root.visible = show;
      if (show) cm.update(f.x, f.z, force);
    });
  }

  renderFrame(dt: number) {
    this.player.updateCamera(this.acc / (1 / this.stepHz), dt);
    this.scare.applyCamera(this.player.camera);
    const cam = this.player.camera.position;
    surfaceUniforms.uTime.value += dt;
    this.env.update();
    this.env.follow(cam);
    this.updateFloors();
    this.outdoors.update(cam);
    this.dust?.update(cam, 0.35, this.renderer.domElement.height);

    // Indoors the sky is shut out: sun, sky fill and reflections only matter near the open gate.
    const g = this.gate.position;
    const toGate = Math.hypot(cam.x - g.x, cam.z - g.z);
    const outdoor = this.gate.opening ? THREE.MathUtils.clamp(1 - (toGate - 2) / 10, 0, 1) * this.gate.openAmount : 0;
    const groundFloor = this.player.floor === 0 ? 1 : 0;
    const sky = outdoor * groundFloor;
    this.env.sun.intensity = this.env.params.sunIntensity * sky;
    this.env.sun.shadow.autoUpdate = sky > 0.01;
    // Inside keeps the tuned indoor fill; stepping out of the gate fades to the night outside.
    const ind = this.env.indoor;
    const out = this.env.params;
    this.env.hemi.intensity = THREE.MathUtils.lerp(ind.hemiIntensity * 0.55, out.hemiIntensity, sky);
    this.env.hemi.color.copy(ind.hemiSky).lerp(out.hemiSky, sky);
    this.env.hemi.groundColor.copy(ind.hemiGround).lerp(out.hemiGround, sky);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(ind.envIntensity * 0.5 * INDOOR_ENV_COMP, out.envIntensity, sky);
    // Eye adaptation: dark interiors open the "iris"; the night outside keeps it open.
    const target = THREE.MathUtils.lerp(1.35, 1.5, sky);
    this.adapt += (target - this.adapt) * Math.min(1, dt * 1.5);
    if (dt === 0) this.adapt = target;
    this.renderer.toneMappingExposure = ind.exposure * this.adapt * (this.scare.active ? Math.max(0.0001, this.scare.exposure) : 1);
    // Pale damp haze at the end of long corridors (the look you liked), blue night haze outside.
    this.env.fog.color.copy(ind.fogColor).multiplyScalar(0.3).lerp(out.fogColor, sky);
    this.env.fog.density = THREE.MathUtils.lerp(0.03, out.fogDensity, sky);

    for (const e of this.entities.entities.values()) e.object.visible = Math.abs(e.floor - this.player.floor) <= 1;
    const cfw = this.player.camera.getWorldDirection(this.tmpV);
    this.audio.updateListener(cam, cfw, this.player.floor);
    this.renderer.info.reset();
    this.post.render(dt);
    this.overlay.frame(this.renderer);
  }

  private barrelSpeed = new Map<number, number>();
  private barrelSound = 0;

  private syncDynamicProps() {
    for (const [key, body] of this.physics.dynamicProps) {
      if (body.isSleeping()) continue;
      // A shoved / toppling barrel knocks (sudden speed change), at most every 0.35 s.
      const v = body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      const prev = this.barrelSpeed.get(key) ?? 0;
      if (Math.abs(sp - prev) > 1.1 && this.time - this.barrelSound > 0.35) {
        this.barrelSound = this.time;
        bus.emit('audio:cue', { name: 'barrel' });
      }
      this.barrelSpeed.set(key, sp);
      const floor = Math.floor(key / 100000);
      const i = key % 100000;
      const level = this.building.floors[floor]!;
      const cm = this.floorChunks[floor]!;
      const slots = cm.dynamicSlots.get(i);
      const m = this.propMatrix(level, i);
      if (!slots || !m) continue;
      for (const slot of slots) {
        const mm = slot.fit !== 1 ? this.tmpM2.copy(m).multiply(this.tmpM3.makeScale(slot.fit, slot.fit, slot.fit)) : m;
        slot.mesh.setMatrixAt(slot.index, mm);
        slot.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private checkCell() {
    const f = this.player.feet;
    const S = this.building.cellSize;
    const c = { floor: this.player.floor, x: Math.floor(f.x / S), z: Math.floor(f.z / S) };
    if (c.x !== this.cell.x || c.z !== this.cell.z || c.floor !== this.cell.floor) {
      const prev = this.cell;
      this.cell = c;
      bus.emit('player:enteredCell', { floor: c.floor, x: c.x, z: c.z, prevFloor: prev.floor, prevX: prev.x, prevZ: prev.z });
    }
  }

  private checkExit() {
    if (this.player.floor !== 0) return;
    const f = this.player.feet;
    const g = this.gate.position;
    const dx = f.x - g.x;
    const dz = f.z - g.z;
    if (!this.gate.opening && Math.hypot(dx, dz) < 2.6) {
      this.gate.open();
      bus.emit('audio:cue', { name: 'gate' });
      this.physics.removeGateBlocker();
      bus.emit('exit:approached', { x: this.building.exit.x, z: this.building.exit.z, side: this.building.exit.side });
      bus.emit('exit:opened', {});
    }
    // Won once the player is through the gate.
    const out = dx * this.gate.outward.x + dz * this.gate.outward.z;
    if (this.gate.opening && out > 1.2 && this.state === 'playing') {
      bus.emit('level:won', { seed: this.building.seed, timeMs: this.elapsedMs });
      this.setState('won');
    }
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const off of this.offs) off();
    this.entities.dispose();
    this.senses.dispose();
    this.director.dispose();
    this.audio.dispose();
    this.unbindResize();
    this.input.dispose();
    for (const cm of this.floorChunks) cm.dispose();
    this.outdoors.dispose();
    this.physics.dispose();
    this.post.dispose();
    this.dust?.dispose();
    this.assets.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.el.remove();
  }
}

export function readUrlParams(): { seed: string; size: LevelSize } {
  const url = new URL(location.href);
  let seed = url.searchParams.get('seed')?.trim().slice(0, 64);
  if (!seed) {
    seed = randomSeed();
    url.searchParams.set('seed', seed);
    history.replaceState(null, '', url);
  }
  const sizeParam = url.searchParams.get('size');
  return { seed, size: isLevelSize(sizeParam) ? sizeParam : 'medium' };
}

export async function createGame(
  root: HTMLElement,
  seed: string,
  size: LevelSize,
  hooks: GameHooks,
  onProgress: (msg: string) => void = () => {},
  qualityOverride?: Quality,
): Promise<Game> {
  const quality = qualityOverride ?? resolvedQuality();
  if (import.meta.env.DEV) Object.assign(window, { THREE }); // devtools / Playwright probes
  const renderer = createRenderer(root, { ...DEFAULT_RENDER, pixelRatioCap: quality.pixelRatioCap, shadowMapSize: quality.shadowMapSize });
  renderer.domElement.style.visibility = 'hidden';
  onProgress('Generating building…');
  const [, building, lib] = await Promise.all([initPhysics(), loadBuilding(seed, size), new TextureLibrary(renderer, quality.textureTier).init()]);
  lib.anisotropy = quality.anisotropy;
  const labels = building.floors.flatMap((f) => f.dressing.roomLabels);
  const assets = await WorldAssets.create(lib, renderer, labels, {
    tier: quality.textureTier,
    decalRes: quality.textureTier === '512' ? 128 : quality.textureTier === '1k' ? 256 : 512,
    config: loadMaterialPicks(),
    onProgress,
  });
  const scene = new THREE.Scene();
  const env = new Atmosphere(scene, building.floors[0]!, renderer, quality.shadowMapSize);
  env.setGroundSet(assets.sets.get('moss_ground') ?? null);
  onProgress('Lighting the sky…');
  await env.loadHdris(lib.manifest, quality.hdriRes);
  env.setMood(settings.graphics.mood);
  onProgress('Waking something up…');
  // Default body is procedural; ?monster=model uses the skinned GLB instead.
  const monsterModel = new URLSearchParams(location.search).get('monster') === 'model' ? await loadMonsterModel(renderer, lib.manifest) : null;
  const monsterImage = await loadMonsterImage();
  // Robin's sculpted body (?monster=billboard keeps the old floating image).
  const robinBody = monsterImage && !monsterModel && new URLSearchParams(location.search).get('monster') !== 'billboard' ? await loadRobinBody(monsterImage) : null;
  const game = new Game(root, building, hooks, renderer, lib, assets, env, quality, scene, monsterModel, monsterImage, robinBody);
  onProgress('Compiling shaders…');
  await renderer.compileAsync(game.scene, game.player.camera).catch(() => {});
  renderer.domElement.style.visibility = '';
  return game;
}

function bfsFrom(adj: number[][], from: number): number[] {
  const dist = new Array<number>(adj.length).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!;
    for (const n of adj[c] ?? []) {
      if (dist[n] === -1) {
        dist[n] = dist[c]! + 1;
        q.push(n);
      }
    }
  }
  return dist;
}
