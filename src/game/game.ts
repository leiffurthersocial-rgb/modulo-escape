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
import { Environment } from '../render/environment.ts';
import { GreyboxMaterials } from '../render/greyboxMaterials.ts';
import { bindResize, createRenderer, DEFAULT_RENDER } from '../render/renderer.ts';
import { DebugOverlay } from '../ui/debugOverlay.ts';
import { ChunkManager } from '../world/chunks.ts';
import { ExitGate } from '../world/exitGate.ts';
import { settings } from './settings.ts';
import { Autopilot } from './autopilot.ts';

export type GameState = 'ready' | 'playing' | 'paused' | 'won';

export interface GameHooks {
  onState(state: GameState, game: Game): void;
}


export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly input: Input;
  readonly player: Player;
  readonly physics: PhysicsWorld;
  readonly chunks: ChunkManager;
  readonly gate: ExitGate;
  readonly env: Environment;
  readonly overlay: DebugOverlay;
  readonly mats = new GreyboxMaterials();
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
  private unbindResize: () => void;
  stepHz = 60;
  readonly autopilot: Autopilot;

  constructor(
    readonly root: HTMLElement,
    readonly level: LevelData,
    private hooks: GameHooks,
  ) {
    this.renderer = createRenderer(root, DEFAULT_RENDER);
    const pieces = kitPieces(level);
    this.physics = new PhysicsWorld(level, pieces, this.stepHz);
    this.env = new Environment(this.scene, level, DEFAULT_RENDER.shadowMapSize);

    this.chunks = new ChunkManager(level, pieces, this.mats);
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

    this.gate = new ExitGate(level, this.mats.gate);
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
    this.unbindResize = bindResize(this.renderer, this.player.camera, root);

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
        seed: `${level.seed} (${level.size})`,
      };
    };

    this.player.updateCamera(1, 0);
    this.env.follow(this.player.camera.position);
    this.chunks.update(this.player.feet.x, this.player.feet.z, true);

    this.autopilot = new Autopilot(this);
    document.addEventListener('visibilitychange', this.onVisibility);
    bus.emit('level:loaded', { level });
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

  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.renderFrame(dt);
  };

  private update(dt: number) {
    const input = this.input;
    this.autopilot.update();
    // Edge-triggered actions.
    if (input.pressed('debug')) this.overlay.toggle();
    if (input.pressed('flashlight')) this.player.setFlashlight(!this.player.flashlightOn);
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
  }

  renderFrame(dt: number) {
    this.player.updateCamera(this.acc / (1 / this.stepHz), dt);
    const cam = this.player.camera.position;
    this.env.follow(cam);
    this.chunks.update(cam.x, cam.z);
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.player.camera);
    this.overlay.frame(this.renderer);
  }

  private syncDynamicProps() {
    for (const [i, body] of this.physics.dynamicProps) {
      if (body.isSleeping()) continue;
      const slot = this.chunks.dynamicSlots.get(i);
      const m = this.chunks.dynamicMatrix(i);
      if (slot && m) {
        slot.mesh.setMatrixAt(slot.index, m);
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
    this.unbindResize();
    this.input.dispose();
    this.chunks.dispose();
    this.physics.dispose();
    this.mats.dispose();
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

export async function createGame(root: HTMLElement, seed: string, size: LevelSize, hooks: GameHooks): Promise<Game> {
  const [, level] = await Promise.all([initPhysics(), loadLevel(seed, size)]);
  return new Game(root, level, hooks);
}
