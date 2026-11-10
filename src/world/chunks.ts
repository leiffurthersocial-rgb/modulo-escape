/**
 * Chunked world: 4×4 cells per chunk. Each chunk merges its static kit pieces into one
 * mesh per material and draws its props as one InstancedMesh per prop type.
 * Chunks are built when the player comes within `radius` chunks and disposed beyond radius+1.
 */
import * as THREE from 'three';
import type { LevelData, PropType } from '../gen/types.ts';
import type { KitPiece } from '../gen/kit.ts';
import { KIT, transformBox } from '../kit/greybox.ts';
import { boxesToGeometry, type AABB } from './boxMesh.ts';
import { makePropGeometries, propMatrix } from './props.ts';
import type { GreyboxMaterials } from '../render/greyboxMaterials.ts';
import { bus } from '../core/events.ts';

export const CHUNK_CELLS = 4;

interface Chunk {
  key: string;
  group: THREE.Group;
}

export class ChunkManager {
  readonly root = new THREE.Group();
  radius = 2;
  /** Max chunks built per update (spreads the cost over frames). */
  buildBudget = 2;
  private chunks = new Map<string, Chunk>();
  private piecesByChunk = new Map<string, KitPiece[]>();
  private propsByChunk = new Map<string, LevelData['props']>();
  private propGeo = makePropGeometries();
  private cx = Number.NaN;
  private cz = Number.NaN;
  readonly chunksX: number;
  readonly chunksZ: number;

  constructor(
    private level: LevelData,
    pieces: KitPiece[],
    private mats: GreyboxMaterials,
  ) {
    this.root.name = 'chunks';
    this.chunksX = Math.ceil(level.width / CHUNK_CELLS);
    this.chunksZ = Math.ceil(level.height / CHUNK_CELLS);
    for (const p of pieces) push(this.piecesByChunk, chunkKey(p.cx, p.cz), p);
    for (const p of level.props) push(this.propsByChunk, chunkKey(p.cx, p.cz), p);
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
    // Unload far chunks (hysteresis: radius + 1).
    if (moved || force) {
      for (const [key, ch] of this.chunks) {
        const [x, z] = key.split(',').map(Number) as [number, number];
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > this.radius + 1) this.unload(key, ch);
      }
    }
    // Build missing chunks nearest-first within budget.
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
  }

  private build(x: number, z: number): void {
    const key = `${x},${z}`;
    const group = new THREE.Group();
    group.name = `chunk ${key}`;
    // Static kit: all opaque parts in one vertex-coloured mesh; puddles separately (glossy, transparent).
    const opaque: AABB[] = [];
    const puddles: AABB[] = [];
    for (const p of this.piecesByChunk.get(key) ?? []) {
      for (const b of KIT[p.id]) {
        const a = transformBox(b, p.x, p.z, p.yaw) as AABB;
        if (b.mat === 'puddle') puddles.push(a);
        else {
          a.color = this.mats.kitColor.get(b.mat);
          opaque.push(a);
        }
      }
    }
    if (opaque.length) {
      const mesh = new THREE.Mesh(boxesToGeometry(opaque), this.mats.opaque);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.kind = 'kit';
      group.add(mesh);
    }
    if (puddles.length) {
      const mesh = new THREE.Mesh(boxesToGeometry(puddles), this.mats.kit.get('puddle')!);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    // Props, instanced per type.
    const byType = new Map<PropType, LevelData['props']>();
    for (const p of this.propsByChunk.get(key) ?? []) push(byType, p.type, p);
    for (const [type, list] of byType) {
      const im = new THREE.InstancedMesh(this.propGeo.get(type)!, this.mats.props.get(type)!, list.length);
      list.forEach((p, i) => im.setMatrixAt(i, propMatrix(p, this.level.cellSize)));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.userData.instanced = true;
      group.add(im);
    }
    this.root.add(group);
    this.chunks.set(key, { key, group });
    bus.emit('chunk:loaded', { key });
  }

  private unload(key: string, ch: Chunk): void {
    for (const o of ch.group.children) {
      // Merged geometry is chunk-owned; prop geometry and materials are shared.
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
    this.root.remove(ch.group);
    this.chunks.delete(key);
    bus.emit('chunk:unloaded', { key });
  }

  dispose(): void {
    for (const [k, ch] of this.chunks) this.unload(k, ch);
    for (const g of this.propGeo.values()) g.dispose();
  }
}

function chunkKey(cx: number, cz: number): string {
  return `${Math.floor(cx / CHUNK_CELLS)},${Math.floor(cz / CHUNK_CELLS)}`;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}
