/**
 * The jungle around the building: procedural tropical trees and leafy bushes (instanced), plus a
 * few Poly Haven ferns/sorrel right against the facade. Instances are grouped into 16 m tiles so
 * frustum culling works and far tiles (hidden by fog anyway) are skipped entirely.
 */
import * as THREE from 'three';
import type { LevelData } from '../gen/types.ts';
import type { WorldAssets } from './worldAssets.ts';
import { OUTDOOR_SHRUB_IDS } from './propModels.ts';
import { cellIndex, inBounds } from '../gen/grid.ts';

const TILE = 32;

interface Item {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  m: THREE.Matrix4;
  shadow: boolean;
}

export class Outdoors {
  readonly group = new THREE.Group();
  private tiles: { group: THREE.Group; cx: number; cz: number }[] = [];
  /** Tiles farther than this (m, from the camera) are hidden. */
  viewDistance = 60;

  /**
   * @param footprints every floor of the building: upper floors can overhang the ground floor,
   *   so plants must keep clear of all of them (a palm grew through an upper floor once).
   */
  constructor(level: LevelData, assets: WorldAssets, density: number, footprints: LevelData[] = [level]) {
    this.group.name = 'outdoors';
    const S0 = level.cellSize;
    const built = (x: number, z: number) =>
      footprints.some((f) => {
        const cx = Math.floor(x / S0);
        const cz = Math.floor(z / S0);
        return inBounds(f, cx, cz) && f.cells[cellIndex(f, cx, cz)]!.kind !== 'void';
      });
    const clear = (x: number, z: number, r: number) => {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        if (built(x + Math.cos(ang) * r, z + Math.sin(ang) * r)) return false;
      }
      return !built(x, z);
    };
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const keep = (i: number) => density >= 1 || frac(i * 0.618034) < density;
    const byTile = new Map<string, Item[]>();
    const add = (x: number, z: number, item: Item) => {
      const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
      const list = byTile.get(key) ?? [];
      list.push(item);
      byTile.set(key, list);
    };
    const mat4 = (x: number, z: number, rot: number, s: number) => {
      q.setFromAxisAngle(Y, rot);
      return new THREE.Matrix4().compose(new THREE.Vector3(x, -0.26, z), q, new THREE.Vector3(s, s, s));
    };

    // Trees (variants 0–2).
    level.dressing.trees.forEach((t, i) => {
      if (!keep(i) || !clear(t.x, t.z, 3.5)) return;
      const v = assets.trees[t.variant]!;
      const m = mat4(t.x, t.z, t.rot, t.scale);
      add(t.x, t.z, { geo: v.trunk, mat: assets.bark, m, shadow: true });
      add(t.x, t.z, { geo: v.leaves, mat: assets.leaf, m, shadow: true });
    });

    // Shrub slots: real models only right against the facade (seen from windows), bushes elsewhere.
    const S = level.cellSize;
    const models = OUTDOOR_SHRUB_IDS.map((id) => assets.props?.models.get(id)).filter((m) => !!m);
    const nearFacade = (x: number, z: number) => {
      const cx = Math.floor(x / S);
      const cz = Math.floor(z / S);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (inBounds(level, nx, nz) && level.cells[cellIndex(level, nx, nz)]!.kind !== 'void') return true;
      }
      return false;
    };
    const bush = assets.trees[3]!;
    level.dressing.shrubs.forEach((s, i) => {
      if (!keep(i) || !clear(s.x, s.z, 0.8)) return;
      if (models.length && nearFacade(s.x, s.z) && i % 3 === 0) {
        const model = models[s.variant % models.length]!;
        const m = mat4(s.x, s.z, s.rot, s.scale);
        for (const part of model.parts) add(s.x, s.z, { geo: part.geometry, mat: part.material, m, shadow: false });
      } else if (i % 2 === 0) {
        add(s.x, s.z, { geo: bush.leaves, mat: assets.leaf, m: mat4(s.x, s.z, s.rot, s.scale * 1.1), shadow: false });
      }
    });

    for (const [key, items] of byTile) {
      const [tx, tz] = key.split(',').map(Number) as [number, number];
      const tile = new THREE.Group();
      const buckets = new Map<string, Item[]>();
      for (const it of items) {
        const k = `${it.geo.uuid}|${it.mat.uuid}`;
        const l = buckets.get(k) ?? [];
        l.push(it);
        buckets.set(k, l);
      }
      for (const list of buckets.values()) {
        const im = new THREE.InstancedMesh(list[0]!.geo, list[0]!.mat, list.length);
        list.forEach((it, k) => im.setMatrixAt(k, it.m));
        im.castShadow = list[0]!.shadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        tile.add(im);
      }
      this.group.add(tile);
      this.tiles.push({ group: tile, cx: (tx + 0.5) * TILE, cz: (tz + 0.5) * TILE });
    }
  }

  /** Hide tiles beyond the view distance (fog hides them anyway). */
  update(cam: THREE.Vector3) {
    const d2 = (this.viewDistance + TILE) ** 2;
    for (const t of this.tiles) t.group.visible = (t.cx - cam.x) ** 2 + (t.cz - cam.z) ** 2 < d2;
  }

  dispose() {
    for (const t of this.tiles) for (const o of t.group.children) if (o instanceof THREE.InstancedMesh) o.dispose();
  }
}

function frac(x: number): number {
  return x - Math.floor(x);
}
