/**
 * Atmosphere: HDRI image-based lighting blended between two moods (sunlit decay ↔ overcast damp),
 * sun / hemisphere / fog / exposure following the mood, and the overgrown ground around the building.
 * The two equirect HDRIs are mixed on the GPU into one target and PMREM-filtered, so the mood slider
 * changes reflections and ambient light, not just the fog colour.
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { LevelData } from '../gen/types.ts';
import { streamRng } from '../core/rng.ts';
import type { Manifest } from './assetManifest.ts';
import { surfaceUniforms } from './surface.ts';
import type { PbrSet } from './textures.ts';

export interface MoodParams {
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fogColor: THREE.Color;
  fogDensity: number;
  exposure: number;
  envIntensity: number;
  wetness: number;
  shafts: number;
}

/**
 * Indoor look (tuned earlier against daylight skies; the user liked it): hemi fill, haze, exposure,
 * wetness. Outdoors it is night now, so the sky/moon parameters live in NIGHT_* below and the game
 * blends indoor → night by how far the player is out of the gate.
 */
const SUNLIT: MoodParams = {
  sunColor: new THREE.Color(0xffe2b8),
  sunIntensity: 3.6,
  hemiSky: new THREE.Color(0xd8ecd8),
  hemiGround: new THREE.Color(0x4a5a30),
  hemiIntensity: 0.35,
  fogColor: new THREE.Color(0xb9c9b0),
  fogDensity: 0.017,
  exposure: 0.95,
  envIntensity: 0.55,
  wetness: 0.3,
  shafts: 1,
};
const OVERCAST: MoodParams = {
  sunColor: new THREE.Color(0xc8d0d6),
  sunIntensity: 0.9,
  hemiSky: new THREE.Color(0xb6c0c4),
  hemiGround: new THREE.Color(0x3a4034),
  hemiIntensity: 0.5,
  fogColor: new THREE.Color(0x8f9893),
  fogDensity: 0.04,
  exposure: 1.15,
  envIntensity: 0.75,
  wetness: 0.85,
  shafts: 0.12,
};

/** Clear moonlit night. `sun` is the moon. */
const NIGHT_MOON: MoodParams = {
  sunColor: new THREE.Color(0x8fa6d6),
  sunIntensity: 0.55,
  hemiSky: new THREE.Color(0x34405e),
  hemiGround: new THREE.Color(0x0c0f12),
  hemiIntensity: 0.3,
  fogColor: new THREE.Color(0x151b28),
  fogDensity: 0.02,
  exposure: 0.95,
  envIntensity: 0.4,
  wetness: 0.3,
  shafts: 0,
};
/** Moonless, hazy night. */
const NIGHT_DARK: MoodParams = {
  sunColor: new THREE.Color(0x6a7a99),
  sunIntensity: 0.15,
  hemiSky: new THREE.Color(0x1c2232),
  hemiGround: new THREE.Color(0x08090b),
  hemiIntensity: 0.22,
  fogColor: new THREE.Color(0x0b0e14),
  fogDensity: 0.035,
  exposure: 1.15,
  envIntensity: 0.7,
  wetness: 0.85,
  shafts: 0,
};
/** Night HDRIs average ~2.3× darker than the day skies the indoor IBL was tuned with. */
export const INDOOR_ENV_COMP = 2.3;
/** How bright the night sky backdrop is drawn (stars and moonlit clouds, not a grey dome). */
const NIGHT_BACKGROUND = 0.35;

const cloneParams = (p: MoodParams): MoodParams => ({ ...p, sunColor: p.sunColor.clone(), hemiSky: p.hemiSky.clone(), hemiGround: p.hemiGround.clone(), fogColor: p.fogColor.clone() });

function lerpParams(out: MoodParams, a: MoodParams, b: MoodParams, t: number) {
  const L = THREE.MathUtils.lerp;
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  out.fogColor.copy(a.fogColor).lerp(b.fogColor, t);
  out.sunIntensity = L(a.sunIntensity, b.sunIntensity, t);
  out.hemiIntensity = L(a.hemiIntensity, b.hemiIntensity, t);
  out.fogDensity = L(a.fogDensity, b.fogDensity, t);
  out.exposure = L(a.exposure, b.exposure, t);
  out.envIntensity = L(a.envIntensity, b.envIntensity, t);
  out.wetness = L(a.wetness, b.wetness, t);
  out.shafts = L(a.shafts, b.shafts, t);
}

export class Atmosphere {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  /** 0 = sunlit, 1 = overcast. */
  mood = 0.35;
  readonly sunDir: THREE.Vector3;
  private sunOffset: THREE.Vector3;
  private shadowExtent = 22;
  private pmrem: THREE.PMREMGenerator;
  private hdrA: THREE.Texture | null = null;
  private hdrB: THREE.Texture | null = null;
  private blendRT: THREE.WebGLRenderTarget | null = null;
  private blendScene: THREE.Scene | null = null;
  private blendMat: THREE.ShaderMaterial | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private ground: THREE.Mesh;
  /** Outdoor (night) parameters. */
  readonly params: MoodParams = cloneParams(NIGHT_MOON);
  /** Indoor parameters (hemi fill, haze, exposure, wetness). */
  readonly indoor: MoodParams = cloneParams(SUNLIT);
  private pendingEnv = false;

  constructor(
    private scene: THREE.Scene,
    level: LevelData,
    private renderer: THREE.WebGLRenderer,
    shadowMapSize: number,
  ) {
    // Seeded sun azimuth so each building has its own light; high elevation for strong shafts.
    const r = streamRng(level.seed, 'sky');
    const az = r.range(0, Math.PI * 2);
    const el = r.range(0.85, 1.15);
    this.sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    this.sunOffset = this.sunDir.clone().multiplyScalar(40);

    scene.background = new THREE.Color(0xb9c8c2);
    this.fog = new THREE.FogExp2(0xa9b6ad, 0.028);
    scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xdfeee9, 0x5a5f4a, 1.0);
    this.group.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 3.2);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 100;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.setShadows(shadowMapSize, 22);
    this.group.add(this.sun, this.sun.target);

    const W = level.width * level.cellSize;
    const D = level.height * level.cellSize;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 300, D + 300), new THREE.MeshStandardMaterial({ color: 0x46612f, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(W / 2, -0.26, D / 2);
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.group.add(this.ground);
    scene.add(this.group);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.applyMood();
  }

  /** Texture the outdoor ground with the moss/ground set. */
  setGroundSet(set: PbrSet | null) {
    if (!set) return;
    const m = this.ground.material as THREE.MeshStandardMaterial;
    const rep = 300 / 3;
    for (const [k, t] of [['map', set.map], ['normalMap', set.normalMap], ['roughnessMap', set.orm], ['aoMap', set.orm]] as const) {
      const c = t.clone();
      c.repeat.set(rep, rep);
      c.needsUpdate = true;
      m[k] = c;
    }
    m.color.set(0xb8c4a8);
    m.needsUpdate = true;
  }

  async loadHdris(manifest: Manifest, res: '1k' | '2k') {
    const pick = (cat: string) => {
      const e = Object.values(manifest.hdris).find((h) => h.category === cat);
      return e?.tiers[res]?.url ?? Object.values(e?.tiers ?? {})[0]?.url;
    };
    const a = pick('hdri:night-moon');
    const b = pick('hdri:night-dark');
    if (!a || !b) return;
    const loader = new HDRLoader().setDataType(THREE.HalfFloatType);
    const [ta, tb] = await Promise.all([loader.loadAsync(a), loader.loadAsync(b)]);
    for (const t of [ta, tb]) {
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.LinearSRGBColorSpace;
    }
    this.hdrA = ta;
    this.hdrB = tb;
    const w = ta.image.width as number;
    this.blendRT = new THREE.WebGLRenderTarget(w, w / 2, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false });
    this.blendRT.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.blendMat = new THREE.ShaderMaterial({
      uniforms: { a: { value: ta }, b: { value: tb }, t: { value: 0 }, desat: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D a; uniform sampler2D b; uniform float t; uniform float desat; varying vec2 vUv;
        void main(){ vec3 c = mix(texture2D(a, vUv).rgb, texture2D(b, vUv).rgb, t);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(c, vec3(l), desat); gl_FragColor = vec4(c, 1.0); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blendScene = new THREE.Scene();
    this.blendScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blendMat));
    this.rebuildEnv();
  }

  /** Re-mix the HDRIs and PMREM them (tens of ms; debounced by callers). */
  rebuildEnv() {
    if (!this.blendRT || !this.blendScene || !this.blendMat) return;
    this.blendMat.uniforms.t!.value = THREE.MathUtils.smoothstep(this.mood, 0.15, 0.85);
    this.blendMat.uniforms.desat!.value = this.mood * 0.35;
    const prevTarget = this.renderer.getRenderTarget();
    const prevTone = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(this.blendRT);
    this.renderer.render(this.blendScene, new THREE.Camera());
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.toneMapping = prevTone;
    const old = this.envRT;
    this.envRT = this.pmrem.fromEquirectangular(this.blendRT.texture);
    this.scene.environment = this.envRT.texture;
    this.scene.background = this.blendRT.texture;
    this.scene.backgroundIntensity = NIGHT_BACKGROUND;
    old?.dispose();
    this.pendingEnv = false;
  }

  setMood(m: number) {
    this.mood = THREE.MathUtils.clamp(m, 0, 1);
    this.applyMood();
    this.pendingEnv = true;
  }

  /** Call per frame; rebuilds the environment at most once per frame after a mood change. */
  update() {
    if (this.pendingEnv) this.rebuildEnv();
  }

  private applyMood() {
    const t = this.mood;
    const p = this.params;
    lerpParams(this.indoor, SUNLIT, OVERCAST, t);
    lerpParams(p, NIGHT_MOON, NIGHT_DARK, t);
    p.exposure = this.indoor.exposure;
    p.wetness = this.indoor.wetness;
    this.sun.color.copy(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.fog.color.copy(p.fogColor);
    this.fog.density = p.fogDensity;
    this.scene.environmentIntensity = p.envIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    surfaceUniforms.uWetness.value = p.wetness;
    if (!this.blendRT) this.scene.background = p.fogColor.clone();
  }

  /** Keep the shadow frustum centred on the player, snapped to texels to avoid shimmering. */
  follow(p: THREE.Vector3) {
    const size = this.sun.shadow.mapSize.x || 1024;
    const texel = (this.shadowExtent * 2) / size;
    const x = Math.round(p.x / texel) * texel;
    const z = Math.round(p.z / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
    this.sun.target.updateMatrixWorld();
  }

  setShadows(size: number, extent: number) {
    this.sun.castShadow = size > 0;
    this.shadowExtent = Math.max(8, extent);
    const c = this.sun.shadow.camera;
    c.left = -this.shadowExtent;
    c.right = this.shadowExtent;
    c.top = this.shadowExtent;
    c.bottom = -this.shadowExtent;
    c.updateProjectionMatrix();
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  dispose() {
    this.hdrA?.dispose();
    this.hdrB?.dispose();
    this.blendRT?.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
  }
}
