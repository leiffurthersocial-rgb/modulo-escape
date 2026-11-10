/**
 * The jungle around the building: procedural tropical trees (3 variants, instanced), Poly Haven
 * shrubs/ferns/rocks (instanced per model part). Built once per level; density from quality.
 */
import * as THREE from 'three';
import type { LevelData } from '../gen/types.ts';
import type { WorldAssets } from './worldAssets.ts';
import { OUTDOOR_ROCK_IDS, OUTDOOR_SHRUB_IDS } from './propModels.ts';

export class Outdoors {
  readonly group = new THREE.Group();

  constructor(level: LevelData, assets: WorldAssets, density: number) {
    this.group.name = 'outdoors';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const keep = (i: number) => density >= 1 || frac(i * 0.618034) < density;

    // Trees (variants 0–2) and leafy bushes (variant 3, from half the shrub slots).
    const bushes = level.dressing.shrubs.filter((_, i) => i % 2 === 0 && keep(i)).map((s) => ({ ...s, variant: 3, scale: s.scale * 1.1 }));
    const trees = [...level.dressing.trees.filter((_, i) => keep(i)), ...bushes];
    assets.trees.forEach((variant, v) => {
      const list = trees.filter((t) => t.variant === v);
      if (!list.length) return;
      const trunk = new THREE.InstancedMesh(variant.trunk, assets.bark, list.length);
      const leaves = new THREE.InstancedMesh(variant.leaves, assets.leaf, list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(Y, t.rot);
        m.compose(new THREE.Vector3(t.x, -0.26, t.z), q, new THREE.Vector3(t.scale, t.scale, t.scale));
        trunk.setMatrixAt(i, m);
        leaves.setMatrixAt(i, m);
      });
      for (const im of [trunk, leaves]) {
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.group.add(im);
      }
    });

    // Shrubs and rocks (Poly Haven models when available).
    const ids = [...OUTDOOR_SHRUB_IDS, ...OUTDOOR_ROCK_IDS].filter((id) => assets.props?.models.has(id));
    if (ids.length) {
      const shrubs = level.dressing.shrubs.filter((_, i) => i % 2 === 1 && frac(i * 0.754877) < density);
      const byModel = new Map<string, THREE.Matrix4[]>();
      for (const s of shrubs) {
        const id = ids[s.variant % ids.length]!;
        q.setFromAxisAngle(Y, s.rot);
        const sc = s.scale * (OUTDOOR_ROCK_IDS.includes(id) ? 0.6 : 1.2);
        const mm = new THREE.Matrix4().compose(new THREE.Vector3(s.x, -0.26, s.z), q, new THREE.Vector3(sc, sc, sc));
        const list = byModel.get(id) ?? [];
        list.push(mm);
        byModel.set(id, list);
      }
      for (const [id, mats] of byModel) {
        const model = assets.props.models.get(id)!;
        for (const part of model.parts) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
          mats.forEach((mm, i) => im.setMatrixAt(i, mm));
          im.castShadow = true;
          im.receiveShadow = true;
          im.computeBoundingSphere();
          this.group.add(im);
        }
      }
    }
  }

  dispose() {
    for (const o of this.group.children) if (o instanceof THREE.InstancedMesh) o.dispose();
  }
}

function frac(x: number): number {
  return x - Math.floor(x);
}
