/**
 * Robin: the monster as a floating image. Any `robin.png` committed anywhere in the repo (root is
 * fine) is bundled automatically via import.meta.glob; if there is none, the game falls back to the
 * procedural creature.
 */
import * as THREE from 'three';

const found = import.meta.glob(['/robin.png', '/**/robin.png', '/**/Robin.png', '/**/leo.png', '/**/Leo.png', '/**/jovan.png', '/**/Jovan.png', '/**/*_scream.png', '!**/node_modules/**', '!**/dist/**'], {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** URL of `<name>.png` (any folder, any capitalisation of the first letter), or null. */
export function imageUrl(name: string): string | null {
  const hit = Object.entries(found).find(([path]) => path.toLowerCase().endsWith(`/${name}.png`));
  return hit?.[1] ?? null;
}

/** URL of robin.png if one is in the repo, else null. */
export const ROBIN_URL: string | null = imageUrl('robin');

export interface MonsterImage {
  url: string;
  texture: THREE.Texture;
  /** width / height */
  aspect: number;
}

export async function loadMonsterImage(name = 'robin'): Promise<MonsterImage | null> {
  const url = imageUrl(name);
  if (!url) return null;
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const img = texture.image as { width: number; height: number };
    return { url, texture, aspect: img.width / Math.max(1, img.height) };
  } catch (e) {
    console.warn(`${name}.png failed to load`, e);
    return null;
  }
}

/**
 * Floating billboard body: turns to face the viewer around Y, bobs and sways, twitches now and
 * then. Lit by the scene (so the flashlight finds it) with a faint glow so it's never fully black.
 */
export class ImageBody {
  readonly object = new THREE.Group();
  readonly head = new THREE.Object3D();
  mode: 'idle' | 'walk' | 'run' | 'attack' = 'idle';
  private plane: THREE.Mesh;
  private t = Math.random() * 10;
  private jitter = 0;

  constructor(img: MonsterImage, height = 2.0) {
    const w = height * img.aspect;
    const mat = new THREE.MeshStandardMaterial({
      map: img.texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      roughness: 0.9,
      emissive: 0xffffff,
      emissiveMap: img.texture,
      emissiveIntensity: 0.12,
    });
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(w, height), mat);
    this.plane.position.y = 0.35 + height / 2;
    this.plane.castShadow = true;
    this.object.add(this.plane);
    this.head.name = 'head';
    this.head.position.y = 0.35 + height * 0.72;
    this.object.add(this.head);
  }

  /** `toward`: world position to face (the player's eye). */
  update(dt: number, toward: THREE.Vector3) {
    this.t += dt;
    const run = this.mode === 'run';
    // Float: slow bob; faster and lower when charging.
    this.plane.position.y = 0.35 + (this.plane.geometry as THREE.PlaneGeometry).parameters.height / 2 + Math.sin(this.t * (run ? 4 : 1.3)) * (run ? 0.05 : 0.12) - (run ? 0.1 : 0);
    // Twitch: rare sharp jumps sideways / tilts.
    if (Math.random() < dt * (run ? 2.5 : 0.4)) this.jitter = (Math.random() - 0.5) * (run ? 0.5 : 0.3);
    this.jitter *= Math.exp(-dt * 10);
    this.plane.position.x = this.jitter * 0.4;
    this.plane.rotation.z = this.jitter + Math.sin(this.t * 0.7) * 0.04;
    // Billboard around Y (the parent group carries the monster's heading; undo it).
    this.object.updateWorldMatrix(true, false);
    const p = this.object.getWorldPosition(new THREE.Vector3());
    const parentYaw = this.object.parent ? this.object.parent.rotation.y : 0;
    this.object.rotation.y = Math.atan2(toward.x - p.x, toward.z - p.z) - parentYaw;
  }

  dispose() {
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
  }
}
