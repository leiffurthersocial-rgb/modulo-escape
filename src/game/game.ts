/** M2 viewer: generates the level, builds the chunked greybox world, renders with an overview/inspect camera. */
import * as THREE from 'three';
import { randomSeed } from '../core/rng.ts';
import { isLevelSize } from '../gen/config.ts';
import { cellCenter, DIR, SIDE_YAW } from '../gen/grid.ts';
import { kitPieces } from '../gen/kit.ts';
import { loadLevel } from '../gen/load.ts';
import { GreyboxMaterials } from '../render/greyboxMaterials.ts';
import { createRenderer, bindResize, DEFAULT_RENDER } from '../render/renderer.ts';
import { Environment } from '../render/environment.ts';
import { ChunkManager } from '../world/chunks.ts';
import { ExitGate } from '../world/exitGate.ts';
import { DebugOverlay } from '../ui/debugOverlay.ts';

export async function startGame(root: HTMLElement) {
  const url = new URL(location.href);
  let seed = url.searchParams.get('seed');
  if (!seed) {
    seed = randomSeed();
    url.searchParams.set('seed', seed);
    history.replaceState(null, '', url);
  }
  const sizeParam = url.searchParams.get('size');
  const size = isLevelSize(sizeParam) ? sizeParam : 'medium';
  const level = await loadLevel(seed, size);

  const renderer = createRenderer(root, DEFAULT_RENDER);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
  bindResize(renderer, camera, root);

  const mats = new GreyboxMaterials();
  const env = new Environment(scene, level, DEFAULT_RENDER.shadowMapSize);
  const chunks = new ChunkManager(level, kitPieces(level), mats);
  scene.add(chunks.root);
  const gate = new ExitGate(level, mats.gate);
  scene.add(gate.object);

  const overlay = new DebugOverlay(root);
  overlay.extra = () => ({ chunks: chunks.loadedCount, seed: level.seed, size: level.size });
  if (url.searchParams.has('debug')) overlay.toggle(true);
  window.addEventListener('keydown', (e) => e.code === 'F3' && (e.preventDefault(), overlay.toggle()));

  const camMode = url.searchParams.get('cam') ?? 'start';
  const s = cellCenter(level, level.start.x, level.start.z);
  if (camMode === 'top') {
    const W = level.width * level.cellSize;
    const D = level.height * level.cellSize;
    camera.position.set(W / 2, Math.max(W, D) * 0.95, D * 1.05);
    camera.lookAt(W / 2, 0, D / 2);
    scene.fog = null;
    chunks.radius = 99;
    // Cut away ceilings so the layout is visible from above.
    renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 3.0)];
  } else if (camMode === 'exit') {
    const e = cellCenter(level, level.exit.x, level.exit.z);
    const d = DIR[level.exit.side];
    camera.position.set(e.x - d.dx * 1.5, 1.6, e.z - d.dz * 1.5);
    camera.lookAt(e.x + d.dx * 2, 1.4, e.z + d.dz * 2);
  } else {
    camera.position.set(s.x, 1.6, s.z);
    camera.rotation.set(0, SIDE_YAW[level.start.facing], 0, 'YXZ');
  }
  chunks.update(camera.position.x, camera.position.z, true);

  renderer.setAnimationLoop(() => {
    renderer.info.reset();
    env.follow(camera.position);
    chunks.update(camera.position.x, camera.position.z);
    renderer.render(scene, camera);
    overlay.frame(renderer);
  });
  (window as unknown as { __game: unknown }).__game = { level, ready: true };
}
