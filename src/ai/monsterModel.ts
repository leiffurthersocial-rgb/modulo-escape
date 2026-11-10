/**
 * Loads the monster's skinned model (KTX2 + meshopt GLB) once; each Monster clones it with
 * SkeletonUtils so skeletons and animation mixers stay independent.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Manifest } from '../render/assetManifest.ts';
import { getKtx2Loader } from '../render/textures.ts';

export interface MonsterModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export const MONSTER_MODEL_ID = 'quaternius_zombie';

export async function loadMonsterModel(renderer: THREE.WebGLRenderer, manifest: Manifest): Promise<MonsterModel | null> {
  const entry = manifest.models[MONSTER_MODEL_ID];
  if (!entry) return null;
  try {
    const loader = new GLTFLoader().setKTX2Loader(getKtx2Loader(renderer)).setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(entry.url);
    // The file carries every clip twice ("Walk" and "CharacterArmature|Walk"): keep the short names.
    const animations = gltf.animations.filter((a) => !a.name.includes('|'));
    return { scene: gltf.scene, animations };
  } catch (e) {
    console.warn('monster model failed', e);
    return null;
  }
}
