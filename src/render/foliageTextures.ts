/**
 * Procedural foliage atlas (2×2 tiles, alpha-tested), painted once at startup:
 * 0 ivy leaf cluster, 1 heart-shaped pothos leaf, 2 palm frond, 3 banana/monstera leaf.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';

type Ctx = CanvasRenderingContext2D;

function leafPath(ctx: Ctx, len: number, wid: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len);
  ctx.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid, -len * 0.25, 0, 0);
  ctx.closePath();
}

function shade(ctx: Ctx, r: Rng, light: number) {
  const h = r.range(88, 118);
  const s = r.range(45, 70);
  ctx.fillStyle = `hsl(${h}, ${s}%, ${light + r.range(-5, 5)}%)`;
}

function vein(ctx: Ctx, len: number) {
  ctx.strokeStyle = 'rgba(210,230,170,0.35)';
  ctx.lineWidth = Math.max(1, len * 0.015);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -len * 0.95);
  ctx.stroke();
}

export function buildFoliageAtlas(size = 1024): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const r = new Rng('kzu-foliage-v1');
  const t = size / 2;

  // 0: ivy cluster — many small leaves on a stem.
  ctx.save();
  ctx.translate(t / 2, t * 0.95);
  ctx.strokeStyle = '#3b3a22';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(10, -t * 0.4, 0, -t * 0.88);
  ctx.stroke();
  for (let i = 0; i < 22; i++) {
    ctx.save();
    const y = -r.range(0.05, 0.85) * t;
    ctx.translate(r.range(-0.12, 0.12) * t, y);
    ctx.rotate(r.range(-2.4, 2.4));
    shade(ctx, r, 26);
    leafPath(ctx, t * r.range(0.13, 0.2), t * r.range(0.08, 0.12));
    ctx.fill();
    vein(ctx, t * 0.15);
    ctx.restore();
  }
  ctx.restore();

  // 1: pothos heart leaf.
  ctx.save();
  ctx.translate(t * 1.5, t * 0.92);
  shade(ctx, r, 32);
  ctx.beginPath();
  const L = t * 0.82;
  ctx.moveTo(0, -L * 0.05);
  ctx.bezierCurveTo(t * 0.55, -L * 0.1, t * 0.4, -L * 0.7, 0, -L);
  ctx.bezierCurveTo(-t * 0.4, -L * 0.7, -t * 0.55, -L * 0.1, 0, -L * 0.05);
  ctx.fill();
  // variegation streaks
  ctx.fillStyle = 'rgba(230,230,150,0.25)';
  for (let i = 0; i < 9; i++) {
    ctx.save();
    ctx.rotate(r.range(-0.5, 0.5));
    ctx.fillRect(r.range(-0.15, 0.15) * t, -L * r.range(0.2, 0.8), t * 0.03, -L * 0.15);
    ctx.restore();
  }
  vein(ctx, L);
  ctx.restore();

  // 2: palm frond — central rib with many narrow leaflets.
  ctx.save();
  ctx.translate(t / 2, t * 1.98);
  ctx.strokeStyle = '#4c5a26';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -t * 0.96);
  ctx.stroke();
  for (let i = 0; i < 34; i++) {
    const y = -t * (0.05 + (i / 34) * 0.88);
    const lenL = t * 0.42 * Math.sin((i / 34) * Math.PI * 0.9 + 0.2);
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(0, y);
      ctx.rotate(s * (1.05 + r.range(-0.1, 0.1)));
      shade(ctx, r, 30);
      leafPath(ctx, lenL, t * 0.025);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();

  // 3: banana / monstera leaf — broad, torn edges.
  ctx.save();
  ctx.translate(t * 1.5, t * 1.98);
  shade(ctx, r, 30);
  const B = t * 0.95;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(t * 0.48, -B * 0.2, t * 0.42, -B * 0.85, 0, -B);
  ctx.bezierCurveTo(-t * 0.42, -B * 0.85, -t * 0.48, -B * 0.2, 0, 0);
  ctx.fill();
  vein(ctx, B);
  // Tears: wedge cuts from the edge towards the rib.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) {
    const y = -B * r.range(0.15, 0.85);
    const s = r.chance(0.5) ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(s * t * 0.5, y - 6);
    ctx.lineTo(s * t * r.range(0.04, 0.2), y + r.range(-4, 4));
    ctx.lineTo(s * t * 0.5, y + 6);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}

/** UV rect of a foliage tile (2×2 atlas). */
export function foliageUv(tile: number): [number, number, number, number] {
  const u0 = (tile % 2) / 2;
  const v1 = 1 - Math.floor(tile / 2) / 2;
  return [u0, v1 - 0.5, u0 + 0.5, v1];
}
