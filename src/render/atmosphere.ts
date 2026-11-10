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
  readonly params: MoodParams = { ...SUNLIT, sunColor: SUNLIT.sunColor.clone(), hemiSky: SUNLIT.hemiSky.clone(), hemiGround: SUNLIT.hemiGround.clone(), fogColor: SUNLIT.fogColor.clone() };
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
    const a = pick('hdri:sunlit');
    const b = pick('hdri:overcast');
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
    this.scene.backgroundIntensity = 1;
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
    p.sunColor.copy(SUNLIT.sunColor).lerp(OVERCAST.sunColor, t);
    p.hemiSky.copy(SUNLIT.hemiSky).lerp(OVERCAST.hemiSky, t);
    p.hemiGround.copy(SUNLIT.hemiGround).lerp(OVERCAST.hemiGround, t);
    p.fogColor.copy(SUNLIT.fogColor).lerp(OVERCAST.fogColor, t);
    const L = THREE.MathUtils.lerp;
    p.sunIntensity = L(SUNLIT.sunIntensity, OVERCAST.sunIntensity, t);
    p.hemiIntensity = L(SUNLIT.hemiIntensity, OVERCAST.hemiIntensity, t);
    p.fogDensity = L(SUNLIT.fogDensity, OVERCAST.fogDensity, t);
    p.exposure = L(SUNLIT.exposure, OVERCAST.exposure, t);
    p.envIntensity = L(SUNLIT.envIntensity, OVERCAST.envIntensity, t);
    p.wetness = L(SUNLIT.wetness, OVERCAST.wetness, t);
    p.shafts = L(SUNLIT.shafts, OVERCAST.shafts, t);
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
    if (!this.blendRT) this.scene.background = p.fogColor.clone().lerp(new THREE.Color(0xc8d8e0), 0.4);
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
