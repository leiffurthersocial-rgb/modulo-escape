/**
 * /bench: flies a fixed camera path (start → exit along the nav path) on a fixed seed,
 * once per preset, and reports avg / p95 frame time. Sim time is fixed per frame, so the
 * path is identical on every device; only the measured frame time differs.
 * URL: /bench/?seed=bench&size=medium&frames=600&presets=high,medium,low,battery
 */
import '../style.css';
import * as THREE from 'three';
import { createGame } from '../game/game.ts';
import { cellIndex } from '../gen/grid.ts';
import { isLevelSize } from '../gen/config.ts';
import { PRESETS, PRESET_ORDER, type Quality } from '../render/quality.ts';

interface Result {
  preset: string;
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  fps: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
}

async function main() {
  const root = document.getElementById('app')!;
  const url = new URL(location.href);
  const seed = url.searchParams.get('seed') ?? 'bench';
  const sizeP = url.searchParams.get('size');
  const size = isLevelSize(sizeP) ? sizeP : 'medium';
  const frames = Number(url.searchParams.get('frames') ?? 600);
  const names = (url.searchParams.get('presets') ?? PRESET_ORDER.join(',')).split(',');
  const presets = names.map((n) => PRESETS[n as keyof typeof PRESETS]).filter((p): p is Quality => !!p);

  const panel = document.createElement('div');
  panel.className = 'debug-overlay';
  panel.style.cssText += ';pointer-events:auto;white-space:pre;font-size:13px;max-width:calc(100% - 16px)';
  panel.textContent = 'Loading…';
  root.appendChild(panel);

  // Textures/HDRI load once at the tier of the first preset (tier changes need a reload in-game too).
  const game = await createGame(root, seed, size, { onState: () => {} }, (m) => (panel.textContent = m), presets[0]);
  game.overlay.toggle(false);
  const b = game.building;
  // Camera path: node centres along the shortest path across floors and stairs, eye height.
  const startNode = b.start.floor * game.nav.N + cellIndex(b, b.start.x, b.start.z);
  const exitNode = cellIndex(b, b.exit.x, b.exit.z);
  const path = game.nav.path(startNode, exitNode).map((n) => game.nav.nodePos(n).add(new THREE.Vector3(0, 1.6, 0)));
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal', 0.3);
  const length = curve.getLength();
  const cam = game.player.camera;
  const results: Result[] = [];
  const look = new THREE.Vector3();

  for (const q of presets) {
    game.applyQuality(q);
    panel.textContent = `Running ${q.name}…\n${table(results)}`;
    const times: number[] = [];
    let calls = 0;
    let tris = 0;
    // Warm-up: compile shaders, build chunks.
    for (let i = 0; i < 20; i++) await frame();
    let last = performance.now();
    for (let f = 0; f < frames; f++) {
      const u = Math.min(1, ((f / 60) * 3) / length); // 3 m/s of sim time
      curve.getPointAt(u, cam.position);
      curve.getPointAt(Math.min(1, u + 0.01), look);
      look.y -= 0.1;
      if (look.distanceToSquared(cam.position) > 1e-4) cam.lookAt(look);
      game.env.follow(cam.position);
      game.env.update();
      const feet = cam.position.clone().setY(cam.position.y - 1.6);
      game.updateFloors(false, feet);
      if (f % 30 === 0) game.director.lights.assignNear(feet.x, feet.y, feet.z);
      game.director.update(1 / 60);
      game.dust?.update(cam.position, 0.6, game.renderer.domElement.height);
      game.renderer.info.reset();
      game.post.render(1 / 60);
      calls += game.renderer.info.render.calls;
      tris += game.renderer.info.render.triangles;
      // Frames are capped like the game would (battery saver = 30).
      const now = await frame(q.fpsCap);
      times.push(now - last);
      last = now;
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((s, v) => s + v, 0) / times.length;
    results.push({
      preset: q.name,
      frames,
      avgMs: +avg.toFixed(2),
      p95Ms: +times[Math.floor(times.length * 0.95)]!.toFixed(2),
      maxMs: +times[times.length - 1]!.toFixed(2),
      fps: +(1000 / avg).toFixed(1),
      drawCalls: Math.round(calls / frames),
      triangles: Math.round(tris / frames),
      pixelRatio: game.renderer.getPixelRatio(),
    });
  }

  const ua = navigator.userAgent;
  const report = `Modulo: Escape bench  seed=${seed} size=${size} frames=${frames} textures=${presets[0]!.textureTier}\n${ua}\n${innerWidth}x${innerHeight} dpr=${devicePixelRatio}\n\n${table(results)}`;
  panel.textContent = report;
  const btn = document.createElement('button');
  btn.textContent = 'Copy results';
  btn.style.cssText = 'display:block;margin-top:8px';
  btn.onclick = () => void navigator.clipboard?.writeText(report).then(() => (btn.textContent = 'Copied'));
  panel.appendChild(btn);
  console.log(report);
  (window as unknown as { __bench: unknown }).__bench = { done: true, results, report };
}

/** Resolve on the next animation frame (or the next one after the cap interval). */
let lastFrame = 0;
function frame(cap = 0): Promise<number> {
  return new Promise((resolve) => {
    const tick = (t: number) => {
      if (cap > 0 && t - lastFrame < 1000 / cap - 2) return requestAnimationFrame(tick);
      lastFrame = t;
      resolve(t);
    };
    requestAnimationFrame(tick);
  });
}

function table(rs: Result[]): string {
  if (!rs.length) return '';
  const head = 'preset    avg ms  p95 ms  max ms    fps  calls   tris   pr';
  return [head, ...rs.map((r) => `${r.preset.padEnd(8)} ${r.avgMs.toFixed(1).padStart(7)} ${r.p95Ms.toFixed(1).padStart(7)} ${r.maxMs.toFixed(1).padStart(7)} ${r.fps.toFixed(1).padStart(6)} ${String(r.drawCalls).padStart(6)} ${String(r.triangles).padStart(6)} ${r.pixelRatio.toFixed(2).padStart(4)}`)].join('\n');
}

main().catch((e: unknown) => {
  console.error(e);
  document.body.append(String(e));
});
