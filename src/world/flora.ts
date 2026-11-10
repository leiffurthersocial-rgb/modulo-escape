/**
 * Procedural vegetation geometry: hanging vines (leaf cards on strands), floor roots (tubes),
 * and three tropical tree variants (palm, banana clump, broadleaf) built from leaf cards.
 * Leaf geometry carries a `sway` attribute (0 at the anchor → 1 at the tip) for wind.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng.ts';
import type { RootSlot, VineSlot } from '../gen/dressing.ts';
import { foliageUv } from '../render/foliageTextures.ts';
import { surfaceUniforms } from '../render/surface.ts';

class CardBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  sway: number[] = [];
  idx: number[] = [];

  /** Quad centred on its bottom edge at `base`, extending along `up` (length h) and `right` (width w). */
  card(base: THREE.Vector3, up: THREE.Vector3, right: THREE.Vector3, w: number, h: number, tile: number, sway0: number, sway1: number, bend = 0) {
    const [u0, v0, u1, v1] = foliageUv(tile);
    const n = new THREE.Vector3().crossVectors(right, up).normalize();
    const i0 = this.pos.length / 3;
    // Two segments along the card so it can bend (droop) towards -Y.
    const rows = 3;
    for (let j = 0; j < rows; j++) {
      const t = j / (rows - 1);
      const droop = bend * t * t;
      for (const s of [-0.5, 0.5]) {
        const p = base
          .clone()
          .addScaledVector(up, h * t)
          .addScaledVector(right, w * s)
          .add(new THREE.Vector3(0, -droop, 0));
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        this.uv.push(s < 0 ? u0 : u1, v0 + (v1 - v0) * t);
        this.sway.push(sway0 + (sway1 - sway0) * t);
      }
    }
    for (let j = 0; j < rows - 1; j++) {
      const a = i0 + j * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  get empty() {
    return this.pos.length === 0;
  }
}

export function buildVines(slots: VineSlot[], density = 1): THREE.BufferGeometry | null {
  const cb = new CardBuilder();
  const up = new THREE.Vector3(0, 1, 0);
  for (const v of slots) {
    const r = new Rng(`vine:${v.seed}`);
    const along = new THREE.Vector3(v.ax, 0, v.az);
    const out = new THREE.Vector3(v.nx, 0, v.nz);
    const strands = Math.max(1, Math.round(v.strands * density));
    for (let s = 0; s < strands; s++) {
      const off = (s / Math.max(1, strands - 1) - 0.5) * v.width + r.range(-0.1, 0.1);
      const len = v.length * r.range(0.5, 1);
      const top = new THREE.Vector3(v.x, v.y, v.z).addScaledVector(along, off).addScaledVector(out, 0.03);
      const n = Math.ceil(len / 0.16);
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const p = top.clone().add(new THREE.Vector3(0, -len * t, 0)).addScaledVector(out, 0.04 + Math.sin(t * 5 + s) * 0.05).addScaledVector(along, Math.sin(t * 3 + s * 1.7) * 0.08);
        const ang = r.range(-0.9, 0.9);
        const right = along.clone().multiplyScalar(Math.cos(ang)).addScaledVector(out, Math.sin(ang) * 0.6).normalize();
        const cardUp = up.clone().multiplyScalar(-1).addScaledVector(out, 0.5).normalize();
        const pothos = r.chance(0.15);
        const size = (pothos ? r.range(0.14, 0.22) : r.range(0.22, 0.34)) * (1 - t * 0.3);
        cb.card(p.clone().addScaledVector(cardUp, -size * 0.2), cardUp, right, size, size, pothos ? 1 : 0, t, Math.min(1, t + 0.15));
      }
    }
  }
  return cb.empty ? null : cb.build();
}

export function buildRoots(slots: RootSlot[]): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of slots) {
    const r = new Rng(`root:${s.seed}`);
    const branches = r.int(1, 3);
    for (let b = 0; b < branches; b++) {
      const pts: THREE.Vector3[] = [];
      let a = s.angle + r.range(-0.5, 0.5) * b;
      let x = s.x;
      let z = s.z;
      const n = 6;
      // Starts slightly up the wall, dives into the floor crack.
      pts.push(new THREE.Vector3(x, 0.35, z));
      for (let i = 1; i <= n; i++) {
        a += r.range(-0.45, 0.45);
        x += (Math.cos(a) * s.length) / n;
        z += (Math.sin(a) * s.length) / n;
        pts.push(new THREE.Vector3(x, 0.03 + Math.max(0, 0.1 * Math.sin(i * 1.3)) - (i === n ? 0.06 : 0), z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, 18, 0.05 * (1 - b * 0.25), 5, false);
      // Taper: scale radius along the tube.
      const pos = tube.getAttribute('position');
      const centers = curve.getSpacedPoints(18);
      for (let i = 0; i < pos.count; i++) {
        const seg = Math.floor(i / 6);
        const c = centers[Math.min(seg, centers.length - 1)]!;
        const t = seg / 18;
        const k = 1 - t * 0.8;
        pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
      }
      tube.computeVertexNormals();
      tube.deleteAttribute('uv');
      parts.push(tube);
    }
  }
  if (!parts.length) return null;
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  // Neutral surface (some AO, lots of moss).
  const n = g.getAttribute('position').count;
  const surf = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < n; i++) {
    surf.set([0.8, 0.7, 0.3], i * 3);
    uv.set([pos.getX(i) * 2, pos.getZ(i) * 2], i * 2);
  }
  g.setAttribute('surface', new THREE.BufferAttribute(surf, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export interface TreeVariant {
  trunk: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

function trunk(points: THREE.Vector3[], r0: number, r1: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, 10, r0, 7, false);
  const pos = g.getAttribute('position');
  const centers = curve.getSpacedPoints(10);
  for (let i = 0; i < pos.count; i++) {
    const seg = Math.floor(i / 8);
    const c = centers[Math.min(seg, centers.length - 1)]!;
    const k = 1 + ((r1 / r0) - 1) * (seg / 10);
    pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
  }
  g.computeVertexNormals();
  const n = pos.count;
  const surf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) surf.set([0.9, 0.55, 0.2], i * 3);
  g.setAttribute('surface', new THREE.BufferAttribute(surf, 3));
  return g;
}

export function buildTreeVariants(): TreeVariant[] {
  const out: TreeVariant[] = [];
  const Y = new THREE.Vector3(0, 1, 0);
  // 0: palm — leaning curved trunk, crown of drooping fronds.
  {
    const r = new Rng('tree-palm');
    const top = new THREE.Vector3(0.9, 7.2, 0.3);
    const tr = trunk([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.1, 2.5, 0.05), new THREE.Vector3(0.5, 5, 0.15), top], 0.22, 0.13);
    const cb = new CardBuilder();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + r.range(-0.2, 0.2);
      const dir = new THREE.Vector3(Math.cos(a), r.range(0.1, 0.5), Math.sin(a)).normalize();
      const right = new THREE.Vector3().crossVectors(Y, dir).normalize();
      cb.card(top, dir, right, 1.3, r.range(2.6, 3.4), 2, 0.3, 1, r.range(0.8, 1.5));
    }
    out.push({ trunk: tr, leaves: cb.build() });
  }
  // 1: banana clump — three short stems with huge torn leaves.
  {
    const r = new Rng('tree-banana');
    const parts: THREE.BufferGeometry[] = [];
    const cb = new CardBuilder();
    for (let k = 0; k < 3; k++) {
      const bx = r.range(-0.6, 0.6);
      const bz = r.range(-0.6, 0.6);
      const h = r.range(2.0, 3.2);
      const top = new THREE.Vector3(bx, h, bz);
      parts.push(trunk([new THREE.Vector3(bx, -0.2, bz), new THREE.Vector3(bx, h * 0.5, bz), top], 0.14, 0.1));
      for (let i = 0; i < 6; i++) {
        const a = r.range(0, Math.PI * 2);
        const dir = new THREE.Vector3(Math.cos(a), r.range(0.6, 1.4), Math.sin(a)).normalize();
        const right = new THREE.Vector3().crossVectors(Y, dir).normalize();
        cb.card(top, dir, right, 0.9, r.range(1.6, 2.2), 3, 0.4, 1, r.range(0.3, 0.9));
      }
    }
    const tr = mergeGeometries(parts);
    out.push({ trunk: tr, leaves: cb.build() });
  }
  // 2: broadleaf — straight trunk, rounded crown of leaf clusters.
  {
    const r = new Rng('tree-broad');
    const tr = trunk([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.15, 2.5, 0), new THREE.Vector3(-0.1, 5.2, 0.1)], 0.28, 0.14);
    const cb = new CardBuilder();
    const c = new THREE.Vector3(0, 6.4, 0);
    for (let i = 0; i < 160; i++) {
      const d = new THREE.Vector3(r.range(-1, 1), r.range(-0.5, 0.8), r.range(-1, 1)).normalize();
      const p = c.clone().addScaledVector(d, r.range(0.8, 2.5));
      const up = d.clone().add(new THREE.Vector3(r.range(-0.4, 0.4), 0.5, r.range(-0.4, 0.4))).normalize();
      const right = new THREE.Vector3().crossVectors(up, new THREE.Vector3(r.range(-1, 1), 0.2, r.range(-1, 1)).normalize()).normalize();
      cb.card(p, up, right, r.range(0.8, 1.2), r.range(0.9, 1.3), 0, 0.5, 1);
    }
    out.push({ trunk: tr, leaves: cb.build() });
  }
  // 3: understorey bush — banana/pothos leaves fanning out from the ground.
  {
    const r = new Rng('bush');
    const cb = new CardBuilder();
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 14; i++) {
      const a = r.range(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.cos(a) * r.range(0.3, 0.9), r.range(0.6, 1.2), Math.sin(a) * r.range(0.3, 0.9)).normalize();
      const right = new THREE.Vector3().crossVectors(Y, dir).normalize();
      cb.card(new THREE.Vector3(r.range(-0.15, 0.15), 0, r.range(-0.15, 0.15)), dir, right, r.range(0.5, 0.8), r.range(0.9, 1.4), r.chance(0.7) ? 3 : 1, 0.2, 1, r.range(0.1, 0.4));
    }
    parts.push(trunk([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 0.1, 0)], 0.05, 0.04));
    out.push({ trunk: mergeGeometries(parts)!, leaves: cb.build() });
  }
  return out;
}

/** Alpha-tested, double-sided leaf material with wind sway driven by the shared uTime. */
export function createLeafMaterial(map: THREE.Texture | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map,
    color: map ? 0xffffff : 0x3f7a2f,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.65,
    metalness: 0,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = surfaceUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 lw = modelMatrix * vec4(transformed, 1.0);
#ifdef USE_INSTANCING
lw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#endif
float ph = lw.x * 0.31 + lw.z * 0.27;
transformed.x += sin(uTime * 1.3 + ph) * 0.06 * sway;
transformed.z += cos(uTime * 1.1 + ph * 1.3) * 0.05 * sway;
transformed.y += sin(uTime * 2.1 + ph * 2.0) * 0.02 * sway;`,
      )
      // Leaves are thin: light both sides by flipping the normal towards the viewer.
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      `// Cheap translucency: back-lit leaves glow a bit.
#include <lights_fragment_begin>`,
    );
  };
  m.customProgramCacheKey = () => 'leaf';
  return m;
}
