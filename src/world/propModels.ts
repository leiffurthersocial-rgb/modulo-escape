/**
 * Prop models per generator prop type. Real models are Poly Haven GLBs (KTX2 textures, meshopt
 * geometry) normalised so they stand on y = 0 centred on the origin; rubble, collapsed slabs and
 * pipes are procedural (they need to tile with the building materials). If a model is missing,
 * the greybox primitive stands in, so the game always runs.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng.ts';
import type { PropType } from '../gen/types.ts';
import type { Manifest } from '../render/assetManifest.ts';
import { getKtx2Loader } from '../render/textures.ts';
import { ensureSurfaceAttribute } from '../render/surface.ts';

export interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}
export interface PropModel {
  id: string;
  parts: PropPart[];
  /** Uniform scale applied on top of the slot scale (to fit the generator footprint). */
  fit: number;
}

/** Which Poly Haven models may stand in for which generator prop types. */
export const PROP_MODEL_IDS: Partial<Record<PropType, string[]>> = {
  chair: ['SchoolChair_01'],
  desk: ['SchoolDesk_01'],
  classroom_desk: ['SchoolDesk_01'],
  barrel: ['Barrel_01'],
  debris: ['cardboard_box_01', 'can_rusted', 'cardboard_box_01'],
  vegetation: ['fern_02'],
};
export const OUTDOOR_SHRUB_IDS = ['fern_02', 'shrub_sorrel_01'];
export const OUTDOOR_ROCK_IDS: string[] = [];

/** Target footprint radius per prop type (m); models are scaled down if larger. */
const MAX_RADIUS: Partial<Record<PropType, number>> = { debris: 0.4, barrel: 0.38, vegetation: 0.55, chair: 0.4, desk: 0.65, classroom_desk: 0.5 };

export class PropLibrary {
  readonly models = new Map<string, PropModel>();
  private loader: GLTFLoader;

  constructor(
    renderer: THREE.WebGLRenderer,
    private manifest: Manifest,
  ) {
    this.loader = new GLTFLoader().setKTX2Loader(getKtx2Loader(renderer)).setMeshoptDecoder(MeshoptDecoder);
  }

  /**
   * Load models by id. "file#part" picks only the nodes whose name contains `part` from a file
   * that bundles several objects (e.g. metal_trash_can#rust).
   */
  async load(ids: string[], maxRadius = 0, onProgress?: (done: number, total: number) => void): Promise<void> {
    const todo = ids.filter((id) => this.manifest.models[id.split('#')[0]!] && !this.models.has(id));
    const files = [...new Set(todo.map((id) => id.split('#')[0]!))];
    let done = 0;
    await Promise.all(
      files.map(async (file) => {
        try {
          const gltf = await this.loader.loadAsync(this.manifest.models[file]!.url);
          for (const id of todo.filter((x) => x.split('#')[0] === file)) {
            const part = id.split('#')[1];
            this.models.set(id, normalise(id, gltf.scene, maxRadius, part));
          }
        } catch (e) {
          console.warn(`model ${file} failed`, e);
        }
        onProgress?.(++done, files.length);
      }),
    );
  }

  /** Models available for a prop type (may be empty → greybox fallback). */
  forType(type: PropType): PropModel[] {
    return (PROP_MODEL_IDS[type] ?? []).map((id) => this.models.get(id)).filter((m): m is PropModel => !!m);
  }

  fitFor(type: PropType, m: PropModel): number {
    const max = MAX_RADIUS[type];
    if (!max) return 1;
    const r = radiusOf(m);
    return r > max ? max / r : 1;
  }
}

function radiusOf(m: PropModel): number {
  let r = 0;
  for (const p of m.parts) {
    p.geometry.computeBoundingBox();
    const b = p.geometry.boundingBox!;
    r = Math.max(r, Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
  }
  return r;
}

/** Bake node transforms into geometry, merge per material, sit on y=0, centre in XZ. */
function normalise(id: string, root: THREE.Object3D, maxRadius: number, part?: string): PropModel {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const named = (o: THREE.Object3D | null): boolean => !!o && (o.name.includes(part!) || named(o.parent));
  const tmp = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (part && !named(mesh)) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    const list = byMat.get(mat) ?? [];
    // GPU-instanced parts (EXT_mesh_gpu_instancing, e.g. chess pieces): bake every instance.
    const inst = mesh as THREE.InstancedMesh;
    const n = inst.isInstancedMesh ? inst.count : 1;
    for (let k = 0; k < n; k++) {
      const g = toFloatGeometry(mesh.geometry);
      if (inst.isInstancedMesh) {
        inst.getMatrixAt(k, tmp);
        g.applyMatrix4(tmp.premultiply(mesh.matrixWorld));
      } else g.applyMatrix4(mesh.matrixWorld);
      list.push(g);
    }
    byMat.set(mat, list);
  });
  const parts: PropPart[] = [];
  const box = new THREE.Box3();
  for (const [mat, geos] of byMat) {
    const g = geos.length === 1 ? geos[0]! : mergeGeometries(geos.map((x) => (x.index ? x : x)), false) ?? geos[0]!;
    g.computeBoundingBox();
    box.union(g.boundingBox!);
    const m = mat as THREE.MeshStandardMaterial;
    if (m.alphaTest === 0 && m.transparent) {
      // Foliage often ships as alpha-blended; alpha-test sorts and shadows properly.
      m.transparent = false;
      m.alphaTest = 0.5;
    }
    parts.push({ geometry: g, material: m });
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geometry.translate(-cx, -box.min.y, -cz);
    p.geometry.computeBoundingSphere();
    p.geometry.computeBoundingBox();
  }
  const model: PropModel = { id, parts, fit: 1 };
  if (maxRadius > 0) {
    const r = radiusOf(model);
    if (r > maxRadius) model.fit = maxRadius / r;
  }
  return model;
}

/**
 * meshopt/quantized glTF stores positions as normalized int16 with the dequantization in the node
 * transform. Baking the transform into such an attribute would clamp to ±1, so expand to float first.
 */
function toFloatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'tangent']) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  return g;
}

// ───────── procedural props ─────────

/** Broken concrete chunks: jittered icosahedra, flattened, three variants merged into a pile. */
export function rubbleGeometry(seed: string): THREE.BufferGeometry {
  const r = new Rng(seed);
  const pieces: THREE.BufferGeometry[] = [];
  const n = r.int(4, 7);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(r.range(0.08, 0.22), 0);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      pos.setXYZ(k, pos.getX(k) * r.range(0.8, 1.25), pos.getY(k) * r.range(0.6, 1.0), pos.getZ(k) * r.range(0.8, 1.25));
    }
    g.rotateY(r.range(0, 6.28));
    g.rotateX(r.range(-0.4, 0.4));
    g.translate(r.range(-0.3, 0.3), r.range(0.03, 0.08), r.range(-0.3, 0.3));
    pieces.push(g.index ? g.toNonIndexed() : g);
  }
  const g = mergeGeometries(pieces)!;
  g.computeVertexNormals();
  planarUv(g, 1.2);
  ensureSurfaceAttribute(g, 0.85, 0.25, 0.2);
  return g;
}

/** A fallen ceiling slab with snapped rebar sticking out. */
export function slabGeometry(): { slab: THREE.BufferGeometry; rebar: THREE.BufferGeometry } {
  const slab = new THREE.BoxGeometry(1.1, 0.18, 0.8, 4, 1, 3);
  const pos = slab.getAttribute('position');
  const r = new Rng('slab');
  for (let i = 0; i < pos.count; i++) {
    // Ragged broken edges.
    if (Math.abs(pos.getX(i)) > 0.5) pos.setX(i, pos.getX(i) + r.range(-0.12, 0.05));
  }
  slab.rotateX(0.35);
  slab.rotateZ(0.18);
  slab.translate(0, 0.28, 0);
  slab.computeVertexNormals();
  planarUv(slab, 0.5);
  ensureSurfaceAttribute(slab, 0.85, 0.35, 0.2);
  const bars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.012, 0.012, r.range(0.4, 0.7), 5);
    b.rotateZ(Math.PI / 2 + r.range(-0.4, 0.4));
    b.translate(0.55 + r.range(0, 0.15), 0.3 + r.range(-0.05, 0.1), r.range(-0.3, 0.3));
    bars.push(b);
  }
  const rebar = mergeGeometries(bars)!;
  rebar.rotateX(0.35);
  rebar.rotateZ(0.18);
  ensureSurfaceAttribute(rebar, 1, 0, 0);
  return { slab, rebar };
}

export function pipeGeometry(height: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.08, 0.08, 4, 10, 1, true);
  g.rotateZ(Math.PI / 2);
  // Flanges every metre.
  const parts: THREE.BufferGeometry[] = [g];
  for (let i = -2; i <= 2; i++) {
    const f = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10);
    f.rotateZ(Math.PI / 2);
    f.translate(i * 1.0, 0, 0);
    parts.push(f);
  }
  const m = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  m.translate(0, height, 0);
  planarUv(m, 1.5);
  ensureSurfaceAttribute(m, 1, 0.1, 0.3);
  return m;
}

function planarUv(g: THREE.BufferGeometry, scale: number) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [pos.getX(i), pos.getZ(i)] : ax >= az ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getY(i)];
    uv.set([u * scale, v * scale], i * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
