/** Robin viewer: /robin/ — orbit the model, switch animations. ?mode=walk&auto=0 for screenshots. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadMonsterImage } from '../ai/monsterImage.ts';
import { loadBody, RobinBody, type RobinMode, type Species } from '../ai/robinBody.ts';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080a);
scene.fog = new THREE.FogExp2(0x07080a, 0.06);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 100);
camera.position.set(1.8, 2.4, 5.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.7, 0);
controls.update();

const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.85 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
scene.add(new THREE.HemisphereLight(0x8090a0, 0x151210, 0.35));
const key = new THREE.SpotLight(0xffe6c8, 60, 20, 0.6, 0.5, 1.6);
key.position.set(2.5, 4.5, 3.5);
key.target.position.set(0, 1.6, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x9ab4ff, 1.4);
rim.position.set(-3, 3, -4);
scene.add(rim);
const fill = new THREE.PointLight(0xffd0a0, 2.5, 8);
fill.position.set(-1.5, 1.2, 2.5);
scene.add(fill);

const ui = document.getElementById('ui')!;
const who = (['robin', 'leo', 'jovan'].includes(q.get('who') ?? '') ? q.get('who') : 'robin') as Species;
const img = await loadMonsterImage(who);
const tpl = await loadBody(who, img);
if (q.get('ceiling')) {
  // A school ceiling at 3.6 m, to judge Jovan.
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.9, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.6;
  scene.add(ceil);
}
if (!tpl) {
  ui.textContent = `${who}_body.glb missing — run npm run robin:build`;
  throw new Error('no body');
}
const body = new RobinBody(tpl);
scene.add(body.object);
const look = new THREE.Vector3();
let mode: RobinMode = (q.get('mode') as RobinMode) ?? 'idle';
let speeds: Record<RobinMode, number> = { idle: 0, walk: 1.2, run: 3.6, attack: 0 };
const buttons: HTMLButtonElement[] = [];
const button = (label: string, fn: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  ui.appendChild(b);
  buttons.push(b);
  return b;
};
const setMode = (m: RobinMode) => {
  mode = m;
  body.mode = m;
  body.speed = speeds[m];
  buttons.forEach((b) => b.classList.toggle('on', b.textContent === m));
};
for (const m of ['idle', 'walk', 'run', 'attack'] as RobinMode[]) button(m, () => setMode(m));
button('scream', () => body.scream());
const duckB = button('duck', () => {
  body.duck = body.duck > 0.5 ? 0 : 1;
  duckB.classList.toggle('on', body.duck > 0.5);
});
setMode(mode);
if (q.get('duck')) body.duck = 1;
speeds = { ...speeds };

let last = performance.now();
const auto = q.get('auto') !== '0';
function frame(dt: number) {
  look.copy(camera.position);
  if (!q.get('rest')) body.update(dt, look);
  renderer.render(scene, camera);
}
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  controls.update();
  frame(dt);
  if (auto) requestAnimationFrame(loop);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
loop();
(window as unknown as { __robin: unknown }).__robin = {
  body,
  camera,
  controls,
  setMode,
  /** Advance the animation deterministically and render once. */
  step(t: number, n = 30) {
    for (let i = 0; i < n && !q.get('rest'); i++) {
      look.copy(camera.position);
      body.update(t / n, look);
    }
    controls.update();
    renderer.render(scene, camera);
  },
  ready: true,
};
