/** F3 overlay: FPS, frame time, draw calls, triangles, GPU resources, JS heap, streaming state. */
import type * as THREE from 'three';

export class DebugOverlay {
  readonly el = document.createElement('div');
  private frames: number[] = [];
  private last = performance.now();
  private nextUpdate = 0;
  visible = false;
  extra: () => Record<string, string | number> = () => ({});

  constructor(parent: HTMLElement) {
    this.el.className = 'debug-overlay';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  toggle(force?: boolean) {
    this.visible = force ?? !this.visible;
    this.el.hidden = !this.visible;
  }

  /** Call once per rendered frame, after render. */
  frame(renderer: THREE.WebGLRenderer) {
    const now = performance.now();
    this.frames.push(now - this.last);
    this.last = now;
    if (this.frames.length > 120) this.frames.shift();
    if (!this.visible || now < this.nextUpdate) return;
    this.nextUpdate = now + 250;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
    const info = renderer.info;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const rows: Record<string, string | number> = {
      fps: (1000 / avg).toFixed(0),
      'frame ms': `${avg.toFixed(1)} (p95 ${p95.toFixed(1)})`,
      'draw calls': info.render.calls,
      triangles: info.render.triangles.toLocaleString(),
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      'js heap': mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'n/a',
      'pixel ratio': renderer.getPixelRatio().toFixed(2),
      ...this.extra(),
    };
    this.el.textContent = Object.entries(rows)
      .map(([k, v]) => `${k.padEnd(12)} ${v}`)
      .join('\n');
  }
}
