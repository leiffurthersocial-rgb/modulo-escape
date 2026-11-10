/**
 * Chunked world: 4×4 cells per chunk. Each chunk merges its kit boxes into one mesh per surface
 * role (with baked AO / moss / wet masks per vertex), adds puddles, decals, vines and roots, and
 * draws props as InstancedMeshes per model part. Chunks are built when the player comes within
 * `radius` chunks and disposed beyond radius+1.
 */
import * as THREE from 'three';
import type { LevelData, PropSlot, PropType } from '../gen/types.ts';
import type { KitPiece } from '../gen/kit.ts';
import { cellIndex, getEdge, inBounds } from '../gen/grid.ts';
import type { DecalSlot } from '../gen/dressing.ts';
import { KIT, transformBox } from '../kit/greybox.ts';
import { boxesToSurfaceGeometry, type AABB, type SurfaceFn } from './boxMesh.ts';
import { propMatrix } from './props.ts';
import { ROLE_OF, type KitRole, type WorldAssets } from './worldAssets.ts';
import { buildRoots, buildVines } from './flora.ts';
import { tileUv } from '../render/decalAtlas.ts';
import { bus } from '../core/events.ts';
import { streamRng } from '../core/rng.ts';
import { computeOpenness } from './openness.ts';

export const CHUNK_CELLS = 6;

interface Chunk {
  key: string;
  group: THREE.Group;
}

export interface ChunkOptions {
  /** 0..1 fraction of decals kept. */
  decals: number;
  /** 0..1 vegetation density (vines, indoor plants). */
  vegetation: number;
}

type PropEntry = { p: PropSlot; i: number };

export class ChunkManager {
  readonly root = new THREE.Group();
  radius = 2;
  /** Chunk groups whose nearest point is farther than this are hidden (fog covers them). */
  viewDistance = 50;
  buildBudget = 1;
  opts: ChunkOptions = { decals: 1, vegetation: 1 };
  private chunks = new Map<string, Chunk>();
  private piecesByChunk = new Map<string, KitPiece[]>();
  private propsByChunk = new Map<string, PropEntry[]>();
  private decalsByChunk = new Map<string, DecalSlot[]>();
  private vinesByChunk = new Map<string, LevelData['dressing']['vines']>();
  private rootsByChunk = new Map<string, LevelData['dressing']['roots']>();
  /** Live instance slots for dynamic props (prop index → every instanced part). */
  readonly dynamicSlots = new Map<number, { mesh: THREE.InstancedMesh; index: number; fit: number }[]>();
  /** Current transform of a dynamic prop, or null to use its authored slot. */
  dynamicMatrix: (propIndex: number) => THREE.Matrix4 | null = () => null;
  private cx = Number.NaN;
  private cz = Number.NaN;
  readonly chunksX: number;
  readonly chunksZ: number;
  private surfaceFn: SurfaceFn;
  private plasterRooms: Set<number>;

  constructor(
    private level: LevelData,
    pieces: KitPiece[],
    private assets: WorldAssets,
  ) {
    this.root.name = 'chunks';
    this.chunksX = Math.ceil(level.width / CHUNK_CELLS);
    this.chunksZ = Math.ceil(level.height / CHUNK_CELLS);
    for (const p of pieces) push(this.piecesByChunk, chunkKey(p.cx, p.cz), p);
    level.props.forEach((p, i) => push(this.propsByChunk, chunkKey(p.cx, p.cz), { p, i }));
    for (const d of level.dressing.decals) push(this.decalsByChunk, chunkKey(d.cx, d.cz), d);
    for (const v of level.dressing.vines) push(this.vinesByChunk, chunkKey(v.cx, v.cz), v);
    for (const r of level.dressing.roots) push(this.rootsByChunk, chunkKey(r.cx, r.cz), r);
    // About half the classrooms are plastered (seeded); corridors and halls stay raw concrete.
    const mr = streamRng(level.seed, 'materials');
    this.plasterRooms = new Set(level.rooms.filter((r) => r.kind === 'room' && mr.chance(0.5)).map((r) => r.id));
    this.surfaceFn = makeSurfaceFn(level);
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  /** Call every frame with the camera/player position in metres. */
  update(wx: number, wz: number, force = false): void {
    const S = this.level.cellSize * CHUNK_CELLS;
    const cx = Math.floor(wx / S);
    const cz = Math.floor(wz / S);
    const moved = cx !== this.cx || cz !== this.cz;
    this.cx = cx;
    this.cz = cz;
    if (moved || force) {
      for (const [key, ch] of this.chunks) {
        const [x, z] = key.split(',').map(Number) as [number, number];
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > this.radius + 1) this.unload(key, ch);
      }
    }
    const want: [number, number, number][] = [];
    for (let z = cz - this.radius; z <= cz + this.radius; z++) {
      for (let x = cx - this.radius; x <= cx + this.radius; x++) {
        if (x < 0 || z < 0 || x >= this.chunksX || z >= this.chunksZ) continue;
        if (!this.chunks.has(`${x},${z}`)) want.push([x, z, Math.hypot(x - cx, z - cz)]);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    const budget = force ? Infinity : this.buildBudget;
    for (const [x, z] of want.slice(0, budget)) this.build(x, z);
    // Distance cull against the chunk's footprint rectangle.
    const vd2 = this.viewDistance * this.viewDistance;
    for (const [key, ch] of this.chunks) {
      const [x, z] = key.split(',').map(Number) as [number, number];
      const dx = Math.max(x * S - wx, 0, wx - (x + 1) * S);
      const dz = Math.max(z * S - wz, 0, wz - (z + 1) * S);
      ch.group.visible = dx * dx + dz * dz < vd2;
    }
  }

  /** Rebuild everything (after quality changes that affect chunk content). */
  rebuildAll(wx: number, wz: number) {
    for (const [k, ch] of this.chunks) this.unload(k, ch);
    this.update(wx, wz, true);
  }

  private roleFor(p: KitPiece, mat: Exclude<keyof typeof ROLE_OF, never>): KitRole {
    const role = ROLE_OF[mat];
    const l = this.level;
    if (role === 'wall' && (p.id === 'wall' || p.id === 'wall_door' || p.id === 'wall_window')) {
      // Plaster if either side of this edge is a plastered room.
      for (const c of edgeCells(l, p)) if (c >= 0 && this.plasterRooms.has(l.cells[c]!.room)) return 'plaster';
    }
    // Pillars and skirtings reuse the wall material (one draw call fewer each per chunk).
    if (role === 'pillar' || role === 'trim') return 'wall';
    // One floor material everywhere: wetness and puddles come from the smooth surface field.
    return role;
  }

  private build(x: number, z: number): void {
    const key = `${x},${z}`;
    const group = new THREE.Group();
    group.name = `chunk ${key}`;
    const a = this.assets;

    // ── Kit surfaces, one mesh per role ──
    const byRole = new Map<KitRole, AABB[]>();
    for (const p of this.piecesByChunk.get(key) ?? []) {
      for (const b of KIT[p.id]) {
        const box = transformBox(b, p.x, p.z, p.yaw) as AABB;
        if (b.mat === 'puddle') continue; // water is drawn by the floor shader now
        push(byRole, this.roleFor(p, b.mat), box);
      }
    }
    for (const [role, boxes] of byRole) {
      const mesh = new THREE.Mesh(boxesToSurfaceGeometry(boxes, this.surfaceFn, 1.0), a.kit.get(role)!);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.kind = 'kit';
      mesh.userData.role = role;
      group.add(mesh);
    }
    // ── Decals ──
    const decals = (this.decalsByChunk.get(key) ?? []).filter((d, i) => d.atlas === 'plate' || hash01(d.x * 7.3 + d.z * 3.1 + i) < this.opts.decals);
    for (const atlas of ['main', 'plate'] as const) {
      const list = decals.filter((d) => d.atlas === atlas);
      if (!list.length) continue;
      const mesh = new THREE.Mesh(decalGeometry(list, atlas), atlas === 'main' ? a.decalMain : a.decalPlate);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 2;
      group.add(mesh);
    }

    // ── Vines and roots ──
    const vines = this.vinesByChunk.get(key) ?? [];
    if (vines.length && this.opts.vegetation > 0) {
      const g = buildVines(vines, this.opts.vegetation);
      if (g) {
        const mesh = new THREE.Mesh(g, a.leaf);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    const roots = this.rootsByChunk.get(key) ?? [];
    if (roots.length) {
      const g = buildRoots(roots);
      if (g) {
        const mesh = new THREE.Mesh(g, a.root);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }

    // ── Props ──
    this.buildProps(key, group);

    this.root.add(group);
    this.chunks.set(key, { key, group });
    bus.emit('chunk:loaded', { key });
  }

  private buildProps(key: string, group: THREE.Group) {
    const a = this.assets;
    const S = this.level.cellSize;
    // Bucket instances by (geometry, material) so each pair is one draw call.
    const buckets = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; items: { m: THREE.Matrix4; propIndex: number; fit: number }[]; shadow: boolean }>();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, propIndex: number, fit: number, shadow = false) => {
      const k = `${geo.uuid}|${mat.uuid}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { geo, mat, items: [], shadow }));
      b.items.push({ m: m.clone(), propIndex, fit });
    };
    const scaleM = new THREE.Matrix4();
    for (const { p, i } of this.propsByChunk.get(key) ?? []) {
      if (p.type === 'vegetation' && hash01(i * 1.618) > this.opts.vegetation) continue;
      const base = this.dynamicMatrix(i) ?? propMatrix(p, S);
      const models = a.props?.forType(p.type) ?? [];
      if (p.type === 'rubble') {
        add(a.rubble[p.variant % a.rubble.length]!, a.rubbleMat, base, i, 1);
      } else if (p.type === 'collapsed_slab') {
        add(a.slab.slab, a.kit.get('wall')!, base, i, 1, true);
        add(a.slab.rebar, a.kit.get('metal')!, base, i, 1);
      } else if (p.type === 'pipe') {
        add(a.pipe, a.kit.get('metal')!, base, i, 1);
      } else if (p.type === 'classroom_desk' && models.length) {
        // Desk with its chair pulled up behind it (same facing), like a classroom row.
        const desk = models[0]!;
        const fit = a.props.fitFor('classroom_desk', desk);
        const m = base.clone().multiply(scaleM.makeScale(fit, fit, fit));
        for (const part of desk.parts) add(part.geometry, part.material, m, i, fit, true);
        const chair = a.props.forType('chair')[0];
        if (chair) {
          const cm = base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.55)).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
          for (const part of chair.parts) add(part.geometry, part.material, cm, i, 1, true);
        }
      } else if (models.length) {
        const model = models[p.variant % models.length]!;
        const fit = a.props.fitFor(p.type, model);
        const m = base.clone().multiply(scaleM.makeScale(fit, fit, fit));
        // Only furniture-sized props cast sun shadows; small clutter would just add draw calls.
        const shadow = p.type === 'barrel' || p.type === 'chair' || p.type === 'desk';
        for (const part of model.parts) add(part.geometry, part.material, m, i, fit, shadow);
      } else {
        add(a.greyboxProps.get(p.type)!, a.greyboxPropMats.get(p.type)!, base, i, 1);
      }
    }
    for (const b of buckets.values()) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.items.length);
      b.items.forEach((it, k) => {
        im.setMatrixAt(k, it.m);
        if (this.isDynamic(it.propIndex)) {
          const list = this.dynamicSlots.get(it.propIndex) ?? [];
          list.push({ mesh: im, index: k, fit: it.fit });
          this.dynamicSlots.set(it.propIndex, list);
        }
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = b.shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.userData.chunk = key;
      group.add(im);
    }
  }

  private isDynamic(i: number): boolean {
    return this.dynamicMatrix(i) !== null;
  }

  private unload(key: string, ch: Chunk): void {
    for (const [i, slots] of this.dynamicSlots) {
      const keep = slots.filter((s) => s.mesh.userData.chunk !== key);
      if (keep.length) this.dynamicSlots.set(i, keep);
      else this.dynamicSlots.delete(i);
    }
    for (const o of ch.group.children) {
      // Chunk-owned geometry is disposed; shared prop geometry and all materials are kept.
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
    this.root.remove(ch.group);
    this.chunks.delete(key);
    bus.emit('chunk:unloaded', { key });
  }

  dispose(): void {
    for (const [k, ch] of this.chunks) this.unload(k, ch);
  }
}

// ───────── helpers ─────────

function chunkKey(cx: number, cz: number): string {
  return `${Math.floor(cx / CHUNK_CELLS)},${Math.floor(cz / CHUNK_CELLS)}`;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Cell indices on both sides of a wall piece's edge (-1 when outside). */
function edgeCells(l: LevelData, p: KitPiece): [number, number] {
  const S = l.cellSize;
  const idx = (x: number, z: number) => (inBounds(l, x, z) ? cellIndex(l, x, z) : -1);
  if (p.slot.startsWith('ez:')) {
    const x = Math.floor(p.x / S);
    const z = Math.round(p.z / S);
    return [idx(x, z - 1), idx(x, z)];
  }
  const x = Math.round(p.x / S);
  const z = Math.floor(p.z / S);
  return [idx(x - 1, z), idx(x, z)];
}

/**
 * Per-vertex surface masks: baked AO (contact darkening at floor/wall/ceiling junctions) × sky
 * openness, moss, wetness and a puddle field. Every input is a continuous field over world space
 * (bilinear across connected cells, distance to the nearest wall in a 3×3 neighbourhood), so two
 * cells that meet without a wall get identical values on their shared edge: no visible tile seams.
 */
function makeSurfaceFn(l: LevelData): SurfaceFn {
  const S = l.cellSize;
  const H = l.storeyHeight;
  const openness = computeOpenness(l);
  const damp = l.dressing.damp;
  const walk = (x: number, z: number) => inBounds(l, x, z) && l.cells[cellIndex(l, x, z)]!.kind !== 'void';
  const wallish = (e: string) => e !== 'open' && e !== 'none';

  /** Bilinear sample of a per-cell field around (x,z), only blending cells connected to `own`. */
  const smooth = (field: number[], x: number, z: number, own: number): number => {
    const fx = x / S - 0.5;
    const fz = z / S - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const ownV = field[own] ?? 0;
    const adj = l.nav.adj[own] ?? [];
    const near = (cx: number, cz: number): number => {
      if (!walk(cx, cz)) return ownV;
      const i = cellIndex(l, cx, cz);
      if (i === own || adj.includes(i)) return field[i]!;
      // Diagonal: connected through one of the two shared orthogonal neighbours.
      for (const j of adj) if ((l.nav.adj[j] ?? []).includes(i)) return field[i]!;
      return ownV;
    };
    const a = near(x0, z0);
    const b = near(x0 + 1, z0);
    const c = near(x0, z0 + 1);
    const d = near(x0 + 1, z0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  /** Distance (m) to the nearest wall face around (x,z), looking at the 3×3 cells around it. */
  const wallDist = (x: number, z: number): number => {
    const cx = Math.floor(x / S);
    const cz = Math.floor(z / S);
    let best = 9;
    for (let j = cz - 1; j <= cz + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        if (!walk(i, j)) continue;
        // Distance from (x,z) to each wall segment on this cell's four sides.
        for (const side of ['N', 'S', 'W', 'E'] as const) {
          if (!wallish(getEdge(l, i, j, side))) continue;
          if (side === 'N' || side === 'S') {
            const lz = (side === 'N' ? j : j + 1) * S;
            const dx = Math.max(i * S - x, 0, x - (i + 1) * S);
            best = Math.min(best, Math.hypot(dx, z - lz));
          } else {
            const lx = (side === 'W' ? i : i + 1) * S;
            const dz = Math.max(j * S - z, 0, z - (j + 1) * S);
            best = Math.min(best, Math.hypot(x - lx, dz));
          }
        }
      }
    }
    return Math.max(0, best - 0.15);
  };

  return (x, y, z, nx, ny, nz) => {
    // Sample the cell this face looks into.
    const px = x + nx * 0.2;
    const pz = z + nz * 0.2;
    const cx = Math.floor(px / S);
    const cz = Math.floor(pz / S);
    if (!walk(cx, cz)) {
      // Exterior faces and roof: weathered and mossy, no interior AO.
      const roof = ny > 0.5 && y > H;
      return [1, roof ? 0.9 : 0.55 + 0.3 * Math.exp(-y / 1.2), roof ? 0.6 : 0.35, 0];
    }
    const own = cellIndex(l, cx, cz);
    const dm = smooth(damp, px, pz, own);
    const open = smooth(openness, px, pz, own);
    const d = wallDist(px, pz);
    let ao = 1;
    let moss: number;
    let wet = dm;
    let puddle = 0;
    if (ny > 0.5) {
      ao *= 1 - 0.5 * Math.exp(-d / 0.45);
      moss = dm * (0.45 + 0.7 * Math.exp(-d / 0.7));
      // Water collects along wall bases and wherever it is damp.
      puddle = Math.min(1, Math.max(0.001, dm * 0.75 + Math.exp(-d / 0.8) * (0.15 + dm * 0.45) - 0.05));
    } else if (ny < -0.5) {
      ao *= 1 - 0.45 * Math.exp(-d / 0.55);
      moss = dm * 0.15;
      wet = dm * 0.3;
    } else {
      ao *= 1 - 0.45 * Math.exp(-Math.max(0, y) / 0.38);
      ao *= 1 - 0.35 * Math.exp(-Math.max(0, H - y) / 0.4);
      moss = dm * (0.35 + 0.65 * Math.exp(-y / 0.9));
      wet = dm * (0.25 + 0.5 * Math.exp(-y / 0.6));
    }
    // Floors face the (unoccluded) sky light the most; walls and ceilings less so.
    const sky = ny > 0.5 ? open : ny < -0.5 ? 0.6 + 0.4 * open : Math.min(1, 0.25 + open);
    return [Math.max(0.08, ao * sky), Math.min(1, moss), Math.min(1, wet), puddle];
  };
}

/** Merge decal quads (wall or floor) into one geometry with atlas UVs. */
function decalGeometry(list: DecalSlot[], atlas: 'main' | 'plate'): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  for (const d of list) {
    n.set(d.nx, d.ny, d.nz);
    if (d.ny > 0.5) {
      right.set(Math.cos(d.rot), 0, Math.sin(d.rot));
      up.set(-Math.sin(d.rot), 0, Math.cos(d.rot)).negate();
    } else {
      // In-plane basis for an axis-aligned wall: right = up × n.
      up.set(0, 1, 0);
      right.crossVectors(up, n).normalize();
      if (d.rot) {
        const c = Math.cos(d.rot);
        const s = Math.sin(d.rot);
        const r2 = right.clone().multiplyScalar(c).addScaledVector(up, s);
        const u2 = up.clone().multiplyScalar(c).addScaledVector(right, -s);
        right.copy(r2);
        up.copy(u2);
      }
    }
    const [u0, v0, u1, v1] = atlas === 'main' ? tileUv(d.tile, 4, 4) : tileUv(d.tile, 8, 4);
    const b = pos.length / 3;
    const hw = d.w / 2;
    const hh = d.h / 2;
    const corners: [number, number, number, number][] = [
      [-hw, -hh, u0, v0],
      [hw, -hh, u1, v0],
      [hw, hh, u1, v1],
      [-hw, hh, u0, v1],
    ];
    for (const [a, c, uu, vv] of corners) {
      pos.push(d.x + right.x * a + up.x * c, d.y + right.y * a + up.y * c, d.z + right.z * a + up.z * c);
      nor.push(n.x, n.y, n.z);
      uv.push(uu, vv);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export type { PropType };
