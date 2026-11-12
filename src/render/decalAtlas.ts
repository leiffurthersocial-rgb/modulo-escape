/**
 * Procedural decal atlases, painted on a 2D canvas at startup (no download):
 * main atlas 4×4 tiles: cracks, stains, water streaks, KZU stencils, graffiti, moss, floor stain.
 * plate atlas 16×8 tiles: enamel KZU door plates ("E07", "E12 · Chemie", "Mensa").
 * sign atlas 8×4 tiles (+ glow map): Notausgang ← → ↑, Ausgang, Trakt E/1/2/3/4, hall directions.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function crack(ctx: Ctx, s: number, r: Rng) {
  ctx.strokeStyle = 'rgba(18,16,14,0.9)';
  ctx.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let cx = x;
    let cy = y;
    const steps = 8 + r.int(0, 6);
    for (let i = 0; i < steps; i++) {
      a += r.range(-0.6, 0.6);
      cx += Math.cos(a) * (len / steps);
      cy += Math.sin(a) * (len / steps);
      ctx.lineTo(cx, cy);
      if (depth > 0 && r.chance(0.18)) branch(cx, cy, a + r.range(-1.3, 1.3), len * 0.45, w * 0.6, depth - 1);
    }
    ctx.stroke();
  };
  for (let k = 0; k < 2; k++) branch(s / 2, s / 2, r.range(0, Math.PI * 2), s * 0.48, s * 0.012, 2);
}

function blotch(ctx: Ctx, s: number, r: Rng, rgb: [number, number, number], alpha: number, n = 40) {
  for (let i = 0; i < n; i++) {
    const x = s / 2 + r.range(-0.28, 0.28) * s;
    const y = s / 2 + r.range(-0.28, 0.28) * s;
    const rad = r.range(0.05, 0.2) * s;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha * r.range(0.4, 1)})`);
    g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

function streak(ctx: Ctx, s: number, r: Rng) {
  // Rust-brown / algae-green water runs from the top edge, fading down.
  const tint: [number, number, number] = r.chance(0.5) ? [52, 40, 28] : [38, 48, 30];
  for (let i = 0; i < 26; i++) {
    const x = s * r.range(0.12, 0.88);
    const w = s * r.range(0.01, 0.06);
    const len = s * r.range(0.35, 0.98);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},${r.range(0.25, 0.6)})`);
    g.addColorStop(1, `rgba(${tint[0]},${tint[1]},${tint[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, 0);
    ctx.bezierCurveTo(x - w, len * 0.4, x + r.range(-w, w), len * 0.8, x, len);
    ctx.bezierCurveTo(x + w, len * 0.6, x + w, len * 0.3, x + w / 2, 0);
    ctx.fill();
  }
  // A darker band at the very top where water collects.
  const g = ctx.createLinearGradient(0, 0, 0, s * 0.12);
  g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},0.5)`);
  g.addColorStop(1, `rgba(${tint[0]},${tint[1]},${tint[2]},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s * 0.12);
}

function stencil(ctx: Ctx, s: number, r: Rng, text: string, sub: string) {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  const color = r.chance(0.5) ? '20,20,18' : '150,40,30';
  // Overspray haze.
  ctx.fillStyle = `rgba(${color},0.08)`;
  ctx.fillRect(-s * 0.46, -s * 0.24, s * 0.92, s * 0.48);
  ctx.fillStyle = `rgba(${color},0.88)`;
  ctx.font = `900 ${s * 0.3}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, -s * 0.04);
  ctx.font = `700 ${s * 0.09}px Arial, sans-serif`;
  ctx.fillText(sub, 0, s * 0.17);
  // Stencil bridges: cut thin vertical gaps through the letters.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = -3; i <= 3; i++) ctx.fillRect(i * s * 0.11 - 1, -s * 0.2, s * 0.012, s * 0.08);
  // Weathering: speckle holes.
  for (let i = 0; i < 260; i++) ctx.fillRect(r.range(-0.5, 0.5) * s, r.range(-0.25, 0.25) * s, r.range(1, 4), r.range(1, 4));
  ctx.restore();
}

function graffiti(ctx: Ctx, s: number, r: Rng) {
  const hues = [r.int(0, 360), r.int(0, 360)];
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(r.range(-0.15, 0.15));
  ctx.lineJoin = 'round';
  ctx.font = `italic 900 ${s * 0.32}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const word = r.pick(['KZU', 'LAUF', 'AUSGANG?', 'HILFE', 'ROBIN']);
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = `hsla(${hues[1]},60%,15%,0.9)`;
  ctx.strokeText(word, 0, 0);
  ctx.fillStyle = `hsla(${hues[0]},70%,55%,0.85)`;
  ctx.fillText(word, 0, 0);
  // Drips.
  ctx.fillStyle = `hsla(${hues[0]},70%,45%,0.7)`;
  for (let i = 0; i < 8; i++) ctx.fillRect(r.range(-0.35, 0.35) * s, s * 0.1, s * 0.012, r.range(0.05, 0.25) * s);
  // Fade with the wall.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r.range(0.1, 0.6)})`;
    ctx.fillRect(r.range(-0.5, 0.5) * s, r.range(-0.5, 0.5) * s, r.range(2, 8), r.range(2, 8));
  }
  ctx.restore();
}

function moss(ctx: Ctx, s: number, r: Rng) {
  blotch(ctx, s, r, [46, 74, 28], 0.85, 70);
  blotch(ctx, s, r, [88, 112, 42], 0.5, 40);
  // Fine speckle for texture.
  for (let i = 0; i < 1500; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = Math.pow(r.next(), 0.7) * s * 0.36;
    ctx.fillStyle = `rgba(${r.int(30, 90)},${r.int(70, 130)},${r.int(20, 50)},${r.range(0.2, 0.7)})`;
    ctx.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 2, 2);
  }
}

export function buildMainAtlas(tile = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(tile * 4, tile * 4);
  const r = new Rng('kzu-decals-v1');
  const painters: ((c: Ctx, s: number) => void)[] = [
    (c, s) => crack(c, s, r),
    (c, s) => crack(c, s, r),
    (c, s) => crack(c, s, r),
    (c, s) => blotch(c, s, r, [40, 32, 22], 0.35),
    (c, s) => blotch(c, s, r, [30, 36, 24], 0.4),
    (c, s) => blotch(c, s, r, [60, 40, 25], 0.3),
    (c, s) => streak(c, s, r),
    (c, s) => streak(c, s, r),
    (c, s) => streak(c, s, r),
    (c, s) => stencil(c, s, r, 'KZU', 'KANTONSSCHULE ZÜRCHER UNTERLAND'),
    (c, s) => stencil(c, s, r, '!', 'KZU · ZUTRITT VERBOTEN'),
    (c, s) => graffiti(c, s, r),
    (c, s) => graffiti(c, s, r),
    (c, s) => moss(c, s, r),
    (c, s) => moss(c, s, r),
    (c, s) => blotch(c, s, r, [24, 26, 20], 0.45, 60),
  ];
  painters.forEach((p, i) => {
    ctx.save();
    ctx.translate((i % 4) * tile, Math.floor(i / 4) * tile);
    ctx.beginPath();
    ctx.rect(0, 0, tile, tile);
    ctx.clip();
    p(ctx, tile);
    ctx.restore();
  });
  return toTexture(canvas);
}

/** KZU door plates, 16 × 8 tiles: a number ("E07"), number + function ("E12" / "Chemie"), or a hall name. */
export function buildPlateAtlas(labels: string[], w = 256): THREE.CanvasTexture {
  const h = w / 2;
  const [canvas, ctx] = makeCanvas(w * 16, h * 8);
  const r = new Rng('kzu-plates-v2');
  const fit = (text: string, max: number, px: number, weight: number) => {
    let size = px;
    ctx.font = `${weight} ${size}px Arial, sans-serif`;
    while (size > 8 && ctx.measureText(text).width > max) {
      size -= 2;
      ctx.font = `${weight} ${size}px Arial, sans-serif`;
    }
  };
  for (let i = 0; i < 128; i++) {
    const label = labels[i] ?? '';
    if (!label) continue;
    const x = (i % 16) * w;
    const y = Math.floor(i / 16) * h;
    const [main, sub] = label.split('\n') as [string, string | undefined];
    ctx.save();
    ctx.translate(x, y);
    // Enamel plate: off-white with a dark border, chipped and rust-stained.
    ctx.fillStyle = '#e8e3d3';
    ctx.fillRect(4, 4, w - 8, h - 8);
    ctx.strokeStyle = '#1f2b3a';
    ctx.lineWidth = 5;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#1f2b3a';
    ctx.font = `700 ${h * 0.16}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('KZU', 22, h * 0.3);
    ctx.textAlign = 'center';
    if (sub) {
      fit(main, w - 60, h * 0.36, 900);
      ctx.fillText(main, w / 2, h * 0.6);
      fit(sub, w - 40, h * 0.2, 700);
      ctx.fillText(sub, w / 2, h * 0.84);
    } else {
      fit(main, w - 50, h * 0.42, 900);
      ctx.fillText(main, w / 2, h * 0.76);
    }
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = `rgba(${r.int(70, 110)},${r.int(40, 60)},20,${r.range(0.2, 0.5)})`;
      ctx.beginPath();
      ctx.arc(r.range(0, w), r.range(0, h), r.range(3, 14), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  return toTexture(canvas);
}

/** Sign tiles (8 × 4); keep in sync with SIGN_TILE in gen/dressing.ts. */
export const SIGN_LAYOUT = {
  notausgang: { left: 0, right: 1, up: 2 },
  ausgang: 3,
  trakt: { E: 4, '1': 5, '2': 6, '3': 7, '4': 8 } as Record<string, number>,
  hallBase: 9, // + hallIndex * 2 + (right ? 1 : 0)
  halls: ['Mensa', 'Aula', 'Turnhalle', 'Mediothek', 'Pausenhalle'],
};

/** German signs: glowing green emergency signs (colour + emissive maps), wing signs, hall arrows. */
export function buildSignAtlas(w = 256): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const h = w / 2;
  const [canvas, ctx] = makeCanvas(w * 8, h * 4);
  const [gc, gctx] = makeCanvas(w * 8, h * 4);
  gctx.fillStyle = '#000';
  gctx.fillRect(0, 0, w * 8, h * 4);
  const at = (i: number) => [(i % 8) * w, Math.floor(i / 8) * h] as const;
  const arrow = (c: Ctx, x: number, y: number, size: number, dir: 'left' | 'right' | 'up') => {
    c.save();
    c.translate(x, y);
    c.rotate(dir === 'left' ? Math.PI : dir === 'up' ? -Math.PI / 2 : 0);
    c.beginPath();
    c.moveTo(-size * 0.5, -size * 0.14);
    c.lineTo(size * 0.12, -size * 0.14);
    c.lineTo(size * 0.12, -size * 0.36);
    c.lineTo(size * 0.5, 0);
    c.lineTo(size * 0.12, size * 0.36);
    c.lineTo(size * 0.12, size * 0.14);
    c.lineTo(-size * 0.5, size * 0.14);
    c.closePath();
    c.fill();
    c.restore();
  };
  /** The ISO running figure, roughly: head, leaning body, limbs. */
  const runner = (c: Ctx, x: number, y: number, s2: number) => {
    c.save();
    c.translate(x, y);
    c.lineCap = 'round';
    c.lineWidth = s2 * 0.13;
    c.beginPath();
    c.arc(s2 * 0.12, -s2 * 0.42, s2 * 0.1, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(s2 * 0.05, -s2 * 0.25);
    c.lineTo(-s2 * 0.08, s2 * 0.08); // body
    c.moveTo(-s2 * 0.08, s2 * 0.08);
    c.lineTo(s2 * 0.18, s2 * 0.22);
    c.lineTo(s2 * 0.12, s2 * 0.45); // front leg
    c.moveTo(-s2 * 0.08, s2 * 0.08);
    c.lineTo(-s2 * 0.25, s2 * 0.3);
    c.lineTo(-s2 * 0.42, s2 * 0.3); // back leg
    c.moveTo(s2 * 0.02, -s2 * 0.17);
    c.lineTo(s2 * 0.25, -s2 * 0.05); // front arm
    c.moveTo(s2 * 0.02, -s2 * 0.17);
    c.lineTo(-s2 * 0.22, -s2 * 0.12); // back arm
    c.stroke();
    c.restore();
  };
  const green = (i: number, dir: 'left' | 'right' | 'up' | null, label: string) => {
    const [x, y] = at(i);
    for (const [c, glow] of [
      [ctx, false],
      [gctx, true],
    ] as const) {
      c.save();
      c.translate(x, y);
      c.fillStyle = glow ? '#3dff8a' : '#0d8f45';
      c.fillRect(6, 6, w - 12, h - 12);
      c.fillStyle = glow ? '#ffffff' : '#f2fff6';
      c.strokeStyle = c.fillStyle;
      runner(c, w * 0.2, h * 0.47, h * 0.62);
      if (dir) arrow(c, w * 0.43, h * 0.47, h * 0.5, dir);
      c.font = `900 ${h * (dir ? 0.2 : 0.3)}px Arial, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, dir ? w * 0.74 : w * 0.64, h * 0.5);
      c.restore();
    }
  };
  green(SIGN_LAYOUT.notausgang.left, 'left', 'NOTAUSGANG');
  green(SIGN_LAYOUT.notausgang.right, 'right', 'NOTAUSGANG');
  green(SIGN_LAYOUT.notausgang.up, 'up', 'NOTAUSGANG');
  green(SIGN_LAYOUT.ausgang, null, 'AUSGANG');
  // Wing signs: dark blue enamel, big prefix.
  for (const [prefix, i] of Object.entries(SIGN_LAYOUT.trakt)) {
    const [x, y] = at(i);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#1f3552';
    ctx.fillRect(6, 6, w - 12, h - 12);
    ctx.strokeStyle = '#e8e3d3';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#e8e3d3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${h * 0.2}px Arial, sans-serif`;
    ctx.fillText('TRAKT', w * 0.3, h * 0.5);
    ctx.font = `900 ${h * 0.62}px Arial, sans-serif`;
    ctx.fillText(prefix, w * 0.68, h * 0.54);
    ctx.restore();
  }
  // Hall direction signs: white with an arrow.
  SIGN_LAYOUT.halls.forEach((name, k) => {
    for (const right of [false, true]) {
      const [x, y] = at(SIGN_LAYOUT.hallBase + k * 2 + (right ? 1 : 0));
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#ece8dc';
      ctx.fillRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = '#1f2b3a';
      arrow(ctx, right ? w * 0.84 : w * 0.16, h * 0.5, h * 0.42, right ? 'right' : 'left');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = h * 0.34;
      ctx.font = `800 ${size}px Arial, sans-serif`;
      while (ctx.measureText(name).width > w * 0.62 && size > 10) ctx.font = `800 ${(size -= 2)}px Arial, sans-serif`;
      ctx.fillText(name, right ? w * 0.42 : w * 0.58, h * 0.52);
      ctx.restore();
    }
  });
  return { map: toTexture(canvas), glow: toTexture(gc) };
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** UV rect for tile index in an atlas of cols×rows. */
export function tileUv(tile: number, cols: number, rows: number): [number, number, number, number] {
  const u0 = (tile % cols) / cols;
  const v1 = 1 - Math.floor(tile / cols) / rows;
  return [u0, v1 - 1 / rows, u0 + 1 / cols, v1];
}
