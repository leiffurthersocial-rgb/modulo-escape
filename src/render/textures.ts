/**
 * KTX2 texture library: loads PBR sets (albedo / normal / ORM) by asset id at a quality tier,
 * caches them, and shares them between every material that uses the same set.
 */
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { loadManifest, pickTier, type Manifest, type TexTierName } from './assetManifest.ts';

export interface PbrSet {
  id: string;
  tier: string;
  px: number;
  bytes: number;
  map: THREE.Texture;
  normalMap: THREE.Texture;
  orm: THREE.Texture;
}

let sharedLoader: KTX2Loader | null = null;
export function getKtx2Loader(renderer: THREE.WebGLRenderer): KTX2Loader {
  if (!sharedLoader) {
    sharedLoader = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  }
  return sharedLoader;
}

export class TextureLibrary {
  private sets = new Map<string, Promise<PbrSet | null>>();
  manifest!: Manifest;
  anisotropy = 4;

  constructor(
    private renderer: THREE.WebGLRenderer,
    public tier: TexTierName,
  ) {}

  async init(): Promise<this> {
    this.manifest = await loadManifest();
    return this;
  }

  get available(): boolean {
    return Object.keys(this.manifest.textures).length > 0;
  }

  idsInCategory(cat: string): string[] {
    return Object.entries(this.manifest.textures)
      .filter(([, t]) => t.category === cat)
      .map(([id]) => id);
  }

  load(id: string, tier: TexTierName = this.tier): Promise<PbrSet | null> {
    const entry = this.manifest.textures[id];
    if (!entry) return Promise.resolve(null);
    const t = pickTier(entry.tiers, tier);
    if (!t) return Promise.resolve(null);
    const key = `${id}@${t}`;
    let p = this.sets.get(key);
    if (!p) {
      const info = entry.tiers[t]!;
      const loader = getKtx2Loader(this.renderer);
      const tex = (url: string, srgb: boolean) =>
        loader.loadAsync(url).then((x) => {
          x.wrapS = x.wrapT = THREE.RepeatWrapping;
          x.anisotropy = this.anisotropy;
          x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          x.needsUpdate = true;
          return x;
        });
      p = Promise.all([tex(info.albedo, true), tex(info.normal, false), tex(info.orm, false)])
        .then(([map, normalMap, orm]) => ({ id, tier: t, px: info.px, bytes: info.bytes, map, normalMap, orm }))
        .catch((e: unknown) => {
          console.warn(`texture set ${id} failed`, e);
          return null;
        });
      this.sets.set(key, p);
    }
    return p;
  }

  setAnisotropy(a: number) {
    this.anisotropy = a;
    for (const p of this.sets.values()) {
      void p.then((s) => {
        if (!s) return;
        for (const t of [s.map, s.normalMap, s.orm]) {
          t.anisotropy = a;
          t.needsUpdate = true;
        }
      });
    }
  }

  /** Free every set not in `keep` (ids). */
  async prune(keep: Set<string>) {
    for (const [key, p] of this.sets) {
      if (keep.has(key.split('@')[0]!)) continue;
      const s = await p;
      s?.map.dispose();
      s?.normalMap.dispose();
      s?.orm.dispose();
      this.sets.delete(key);
    }
  }
}
