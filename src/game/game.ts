/**
 * Game orchestration: loads the level, wires systems together and runs the loop.
 * State machine: loading → ready → playing ⇄ paused → won.
 * Physics runs at a fixed step with render interpolation; the render loop stops
 * entirely while paused or when the tab is hidden.
 */
import * as THREE from 'three';
import { bus } from '../core/events.ts';
import { randomSeed } from '../core/rng.ts';
import { isLevelSize } from '../gen/config.ts';
import { cellCenter, cellIndex, SIDE_YAW, worldToCell } from '../gen/grid.ts';
import { kitPieces } from '../gen/kit.ts';
import { loadLevel } from '../gen/load.ts';
import type { LevelData, LevelSize } from '../gen/types.ts';
import { Input } from '../input/input.ts';
import { initPhysics, PhysicsWorld } from '../physics/physicsWorld.ts';
import { Player } from '../player/player.ts';
import { Atmosphere } from '../render/atmosphere.ts';
import { bindResize, createRenderer, DEFAULT_RENDER } from '../render/renderer.ts';
import { PostFX } from '../render/post.ts';
import { Dust, LightShafts } from '../render/shafts.ts';
import { surfaceUniforms } from '../render/surface.ts';
import { TextureLibrary } from '../render/textures.ts';
import { PerfMonitor } from '../render/perfMonitor.ts';
import { WorldAssets } from '../world/worldAssets.ts';
import { Outdoors } from '../world/outdoors.ts';
import { computeOpenness } from '../world/openness.ts';
import { DebugOverlay } from '../ui/debugOverlay.ts';
import { ChunkManager } from '../world/chunks.ts';
import { ExitGate } from '../world/exitGate.ts';
import { resolvedQuality, saveSettings, settings } from './settings.ts';
import { Autopilot } from './autopilot.ts';
import { lowerPreset, PRESETS, type Quality } from '../render/quality.ts';
import { AmbienceDirector } from '../director/director.ts';
import { AudioManager } from '../audio/audio.ts';
import { Minimap } from '../ui/minimap.ts';
import { isTouchOnlyDevice, TouchControls } from '../input/touch.ts';

export type GameState = 'ready' | 'playing' | 'paused' | 'won';

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
  readonly chunks: ChunkManager;
  readonly gate: ExitGate;
  readonly env: Atmosphere;
  readonly overlay: DebugOverlay;
  readonly post: PostFX;
  readonly outdoors: Outdoors;
  readonly perf = new PerfMonitor();
  shafts: LightShafts | null = null;
  dust: Dust | null = null;
  private gateMat: THREE.MeshStandardMaterial;
  state: GameState = 'ready';
  /** Elapsed play time in ms; starts on first movement. */
  elapsedMs = 0;
  timerRunning = false;
  private acc = 0;
  private last = 0;
  private running = false;
  private cell = { x: -1, z: -1 };
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
  readonly minimap: Minimap;
  readonly touch: TouchControls;
  private offs: (() => void)[] = [];
  private openness: number[];
  texVram = 0;
  /** Eye adaptation: current exposure multiplier, eased towards the target per cell. */
  private adapt = 1;

  constructor(
    readonly root: HTMLElement,
    readonly level: LevelData,
    private hooks: GameHooks,
    renderer: THREE.WebGLRenderer,
    readonly textures: TextureLibrary,
    readonly assets: WorldAssets,
    env: Atmosphere,
    quality: Quality,
    scene: THREE.Scene,
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.env = env;
    this.stepHz = quality.physicsHz;
    this.openness = computeOpenness(level);
    const pieces = kitPieces(level);
    this.physics = new PhysicsWorld(level, pieces, this.stepHz);

    this.chunks = new ChunkManager(level, pieces, assets);
    this.chunks.radius = quality.chunkRadius;
    this.chunks.opts = { decals: quality.decals, vegetation: quality.vegetation };
    this.chunks.dynamicMatrix = (i) => {
      const b = this.physics.dynamicProps.get(i);
      if (!b) return null;
      const t = b.translation();
      const r = b.rotation();
      const p = level.props[i]!;
      this.tmpQ.set(r.x, r.y, r.z, r.w);
      this.tmpV.set(t.x, t.y - 0.45 * p.scale, t.z);
      this.tmpS.setScalar(p.scale);
      return this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
    };
    this.scene.add(this.chunks.root);

    this.gateMat = assets.kit.get('metal')!.clone();
    this.gateMat.color.set(0xc08070);
    this.gate = new ExitGate(level, this.gateMat);
    this.outdoors = new Outdoors(level, assets, quality.vegetation);
    this.scene.add(this.outdoors.group);
    this.scene.add(this.gate.object);
    this.physics.setGateBlocker(
      { x: this.gate.position.x, z: this.gate.position.z },
      level.exit.side === 'N' || level.exit.side === 'S',
      this.gate.width,
      this.gate.height,
    );

    const s = cellCenter(level, level.start.x, level.start.z);
    this.player = new Player(this.physics, s, SIDE_YAW[level.start.facing], settings.fov);
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
      return {
        chunks: `${this.chunks.loadedCount} (r=${this.chunks.radius})`,
        colliders: this.physics.staticColliderCount,
        cell: `${this.cell.x},${this.cell.z} → exit ${this.level.nav.distToExit[cellIndex(this.level, this.cell.x, this.cell.z)] ?? '?'}`,
        pos: `${f.x.toFixed(1)}, ${f.y.toFixed(2)}, ${f.z.toFixed(1)}`,
        speed: `${this.player.speed.toFixed(1)} m/s${this.player.sprinting ? ' sprint' : ''}${this.player.crouching ? ' crouch' : ''}`,
        look: this.input.lookMode,
        quality: `${this.quality.name}${this.post.enabled ? ' +post' : ''} tex ${this.quality.textureTier}`,
        mood: this.env.mood.toFixed(2),
        assets: this.assets.textured ? `textured, tex VRAM ≈ ${(this.texVram / 1048576).toFixed(0)} MB` : 'greybox',
        seed: `${level.seed} (${level.size})`,
      };
    };

    this.player.updateCamera(1, 0);
    this.env.follow(this.player.camera.position);
    this.chunks.update(this.player.feet.x, this.player.feet.z, true);

    this.autopilot = new Autopilot(this);
    this.director = new AmbienceDirector(this.scene, level, quality.lightPool);
    this.applyQuality(quality, true);
    void textures.vramEstimate().then((v) => (this.texVram = v));
    this.minimap = new Minimap(root, level);
    this.minimap.setVisible(settings.minimap);
    this.touch = new TouchControls(root, this.input, () => this.setState('paused'));
    this.applyTouchSetting();
    this.offs.push(
      bus.on('player:enteredCell', (e) => this.minimap.reveal(e.x, e.z)),
      bus.on('settings:changed', ({ key }) => {
        if (key === 'minimap' || key === '*') this.minimap.setVisible(settings.minimap);
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
    bus.emit('level:loaded', { level });
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
    } else {
      this.input.enabled = false;
      if (s !== 'won') this.input.releaseLock();
      // Paused/won: render one last frame for the backdrop, then stop the loop to save power.
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

  /** Apply a quality preset at runtime. Texture tier / HDRI size take effect on the next level load. */
  applyQuality(q: Quality, initial = false) {
    const prev = this.quality;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioCap));
    this.renderer.shadowMap.enabled = q.shadowMapSize > 0 || q.flashlightShadows;
    this.env.setShadows(q.shadowMapSize, q.shadowDistance);
    this.player.setFlashlightShadows(q.flashlightShadows);
    this.textures.setAnisotropy(q.anisotropy);
    this.chunks.radius = q.chunkRadius;
    this.outdoors.viewDistance = q.viewDistance;
    this.chunks.viewDistance = q.viewDistance;
    const contentChanged = initial || prev.decals !== q.decals || prev.vegetation !== q.vegetation;
    this.chunks.opts = { decals: q.decals, vegetation: q.vegetation };
    if (contentChanged && !initial) this.chunks.rebuildAll(this.player.feet.x, this.player.feet.z);
    else this.chunks.update(this.player.feet.x, this.player.feet.z, true);
    this.director.lights.setPoolSize(this.scene, q.lightPool);
    this.director.lights.assignNear(this.player.feet.x, this.player.feet.z);
    this.stepHz = q.physicsHz;
    this.physics.world.timestep = 1 / q.physicsHz;
    if (initial || prev.lightShafts !== q.lightShafts) {
      this.shafts?.dispose();
      if (this.shafts) this.scene.remove(this.shafts.mesh);
      this.shafts = q.lightShafts === 'off' ? null : new LightShafts(this.level, this.env.sunDir, q.lightShafts);
      if (this.shafts) this.scene.add(this.shafts.mesh);
    }
    if (initial || prev.particles !== q.particles) {
      if (this.dust) {
        this.scene.remove(this.dust.points);
        this.dust.dispose();
      }
      this.dust = q.particles > 0 ? new Dust(Math.round(900 * q.particles)) : null;
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
    this.autopilot.update();
    // Edge-triggered actions.
    if (input.pressed('debug')) this.overlay.toggle();
    if (input.pressed('debugMenu')) this.hooks.onDebugMenu?.();
    if (input.pressed('flashlight')) this.player.setFlashlight(!this.player.flashlightOn);
    if (input.pressed('minimap')) {
      settings.minimap = !settings.minimap;
      saveSettings('minimap');
    }
    if (input.pressed('pause')) {
      // Esc normally releases pointer lock itself (→ pause via lock change); P or a
      // non-locked Esc gets here. setState('paused') releases the lock if still held.
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

    if (!this.timerRunning && this.player.speed > 0.2) this.timerRunning = true;
    if (this.timerRunning) this.elapsedMs += dt * 1000;

    this.syncDynamicProps();
    this.checkCell();
    this.checkExit();
    this.gate.update(dt);
    this.director.update(dt);
  }

  renderFrame(dt: number) {
    this.player.updateCamera(this.acc / (1 / this.stepHz), dt);
    const cam = this.player.camera.position;
    surfaceUniforms.uTime.value += dt;
    this.env.update();
    this.env.follow(cam);
    this.chunks.update(cam.x, cam.z);
    this.outdoors.update(cam);
    const shaftLevel = this.env.params.shafts;
    this.shafts?.setIntensity(shaftLevel);
    this.dust?.update(cam, 0.25 + shaftLevel * 0.75, this.renderer.domElement.height);
    // Eye adaptation: enclosed spaces open the "iris", open sky closes it.
    const pc = worldToCell(this.level, cam.x, cam.z);
    const inside = pc.x >= 0 && pc.z >= 0 && pc.x < this.level.width && pc.z < this.level.height && this.level.cells[cellIndex(this.level, pc.x, pc.z)]!.kind !== 'void';
    const open = inside ? this.openness[cellIndex(this.level, pc.x, pc.z)]! : 1.6;
    const target = THREE.MathUtils.clamp(1.45 - open * 0.6, 0.5, 1.4);
    this.adapt += (target - this.adapt) * Math.min(1, dt * 1.5);
    if (dt === 0) this.adapt = target;
    this.renderer.toneMappingExposure = this.env.params.exposure * this.adapt;
    // Indoor air is lit by what comes in: darken the fog in enclosed spaces.
    this.env.fog.color.copy(this.env.params.fogColor).multiplyScalar(THREE.MathUtils.clamp(0.12 + open * 0.75, 0.12, 1));
    this.renderer.info.reset();
    this.post.render(dt);
    this.overlay.frame(this.renderer);
    this.minimap.draw(this.player.feet.x, this.player.feet.z, this.player.yaw, performance.now());
  }

  private syncDynamicProps() {
    for (const [i, body] of this.physics.dynamicProps) {
      if (body.isSleeping()) continue;
      const slots = this.chunks.dynamicSlots.get(i);
      const m = this.chunks.dynamicMatrix(i);
      if (!slots || !m) continue;
      for (const slot of slots) {
        const mm = slot.fit !== 1 ? this.tmpM2.copy(m).multiply(this.tmpM3.makeScale(slot.fit, slot.fit, slot.fit)) : m;
        slot.mesh.setMatrixAt(slot.index, mm);
        slot.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private checkCell() {
    const c = worldToCell(this.level, this.player.feet.x, this.player.feet.z);
    if (c.x !== this.cell.x || c.z !== this.cell.z) {
      const prev = this.cell;
      this.cell = c;
      bus.emit('player:enteredCell', { x: c.x, z: c.z, prevX: prev.x, prevZ: prev.z });
    }
  }

  private checkExit() {
    const f = this.player.feet;
    const g = this.gate.position;
    const dx = f.x - g.x;
    const dz = f.z - g.z;
    if (!this.gate.opening && Math.hypot(dx, dz) < 2.6) {
      this.gate.open();
      this.physics.removeGateBlocker();
      bus.emit('exit:approached', { ...this.level.exit });
      bus.emit('exit:opened', {});
    }
    // Won once the player is through the gate.
    const out = dx * this.gate.outward.x + dz * this.gate.outward.z;
    if (this.gate.opening && out > 1.2 && this.state === 'playing') {
      this.timerRunning = false;
      bus.emit('level:won', { seed: this.level.seed, timeMs: this.elapsedMs });
      this.setState('won');
    }
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const off of this.offs) off();
    this.director.dispose();
    this.audio.dispose();
    this.unbindResize();
    this.input.dispose();
    this.chunks.dispose();
    this.outdoors.dispose();
    this.physics.dispose();
    this.post.dispose();
    this.shafts?.dispose();
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
  const [, level, lib] = await Promise.all([initPhysics(), loadLevel(seed, size), new TextureLibrary(renderer, quality.textureTier).init()]);
  lib.anisotropy = quality.anisotropy;
  const assets = await WorldAssets.create(lib, renderer, level.dressing.roomLabels, {
    tier: quality.textureTier,
    decalRes: quality.textureTier === '512' ? 128 : quality.textureTier === '1k' ? 256 : 512,
    onProgress,
  });
  const scene = new THREE.Scene();
  const env = new Atmosphere(scene, level, renderer, quality.shadowMapSize);
  env.setGroundSet(assets.sets.get('moss_ground') ?? null);
  onProgress('Lighting the sky…');
  await env.loadHdris(lib.manifest, quality.hdriRes);
  env.setMood(settings.graphics.mood);
  const game = new Game(root, level, hooks, renderer, lib, assets, env, quality, scene);
  onProgress('Compiling shaders…');
  await renderer.compileAsync(game.scene, game.player.camera).catch(() => {});
  renderer.domElement.style.visibility = '';
  return game;
}
