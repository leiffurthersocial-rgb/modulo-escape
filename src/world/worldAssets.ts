/**
 * Everything the world builder needs to dress the level: kit materials per surface role,
 * puddle / decal / leaf / root / bark materials, prop models, procedural props and trees.
 * Built textured when processed assets exist, otherwise as coloured greybox (same code path).
 */
import * as THREE from 'three';
import materialsConfig from '../config/materials.json';
import type { MatKey } from '../kit/greybox.ts';
import type { PropType } from '../gen/types.ts';
import type { TexTierName } from '../render/assetManifest.ts';
import { buildFoliageAtlas } from '../render/foliageTextures.ts';
import { buildMainAtlas, buildPlateAtlas } from '../render/decalAtlas.ts';
import { createSurfaceMaterial, surfaceUniforms } from '../render/surface.ts';
import type { PbrSet, TextureLibrary } from '../render/textures.ts';
import { buildTreeVariants, createLeafMaterial, type TreeVariant } from './flora.ts';
import { makePropGeometries } from './props.ts';
import { OUTDOOR_ROCK_IDS, OUTDOOR_SHRUB_IDS, PROP_MODEL_IDS, PropLibrary, pipeGeometry, rubbleGeometry, slabGeometry } from './propModels.ts';
import { STOREY_HEIGHT } from '../gen/config.ts';

export type KitRole = 'wall' | 'plaster' | 'floor' | 'wetfloor' | 'ceiling' | 'metal' | 'brick' | 'pillar' | 'trim';

/** Default role for each greybox material key (the builder overrides wall→plaster, floor→wetfloor per cell). */
export const ROLE_OF: Record<Exclude<MatKey, 'puddle'>, KitRole> = {
  floor: 'floor',
  floor_cracked: 'floor',
  ceiling: 'ceiling',
  wall: 'wall',
  wall_trim: 'trim',
  window_frame: 'metal',
  door_frame: 'metal',
  exit_frame: 'metal',
  pillar: 'pillar',
  broken: 'brick',
};

export type MaterialCategory = keyof typeof materialsConfig.picks;

export interface MaterialsConfig {
  picks: Record<string, string>;
  tuning: Record<string, { scale: number }>;
}

/** Category + look for each role. */
const ROLE_SPEC: Record<KitRole, { cat: MaterialCategory; color: number; moss: number; tint?: number; scaleMul?: number; roughness?: number }> = {
  wall: { cat: 'concrete_wall', color: 0x8c8b84, moss: 1 },
  plaster: { cat: 'plaster', color: 0x9a978a, moss: 1 },
  floor: { cat: 'concrete_floor', color: 0x5d5f58, moss: 1 },
  wetfloor: { cat: 'wet_floor', color: 0x4b4f4a, moss: 1 },
  ceiling: { cat: 'concrete_wall', color: 0x6b6d68, moss: 0.4, tint: 0xb8b8b0, scaleMul: 0.8 },
  metal: { cat: 'rusted_metal', color: 0x6e4a33, moss: 0.15 },
  brick: { cat: 'brick', color: 0x7a5546, moss: 1 },
  pillar: { cat: 'concrete_wall', color: 0xa29f95, moss: 0.8, tint: 0xd8d6cc },
  trim: { cat: 'concrete_wall', color: 0x55564f, moss: 1, tint: 0x8a8a84 },
};

export class WorldAssets {
  textured = false;
  readonly kit = new Map<KitRole, THREE.MeshStandardMaterial>();
  puddle!: THREE.MeshStandardMaterial;
  decalMain!: THREE.MeshStandardMaterial;
  decalPlate!: THREE.MeshStandardMaterial;
  leaf!: THREE.MeshStandardMaterial;
  root!: THREE.MeshStandardMaterial;
  bark!: THREE.MeshStandardMaterial;
  rubbleMat!: THREE.MeshStandardMaterial;
  props!: PropLibrary;
  rubble: THREE.BufferGeometry[] = [];
  slab!: { slab: THREE.BufferGeometry; rebar: THREE.BufferGeometry };
  pipe!: THREE.BufferGeometry;
  trees: TreeVariant[] = [];
  greyboxProps = makePropGeometries();
  greyboxPropMats = new Map<PropType, THREE.Material>();
  /** Loaded PBR sets by category (for the lab / debug info). */
  readonly sets = new Map<string, PbrSet | null>();
  private owned: { dispose(): void }[] = [];

  constructor(private lib: TextureLibrary) {}

  static async create(
    lib: TextureLibrary,
    renderer: THREE.WebGLRenderer,
    labels: string[],
    opts: { tier: TexTierName; decalRes: number; config?: MaterialsConfig; onProgress?: (msg: string) => void },
  ): Promise<WorldAssets> {
    const a = new WorldAssets(lib);
    const cfg = opts.config ?? (materialsConfig as MaterialsConfig);
    a.textured = lib.available;
    opts.onProgress?.('Loading materials…');
    const cats = [...new Set(Object.values(ROLE_SPEC).map((r) => r.cat)), 'moss_ground', 'rubble'] as string[];
    await Promise.all(cats.map(async (cat) => a.sets.set(cat, a.textured ? await lib.load(cfg.picks[cat] ?? '', opts.tier) : null)));
    a.buildMaterials(cfg);

    opts.onProgress?.('Painting decals…');
    const main = buildMainAtlas(opts.decalRes);
    const plate = buildPlateAtlas(labels, Math.min(256, Math.max(128, opts.decalRes)));
    const foliage = buildFoliageAtlas(opts.decalRes * 4);
    a.owned.push(main, plate, foliage);
    const decal = (map: THREE.Texture) =>
      new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9, metalness: 0 });
    a.decalMain = decal(main);
    a.decalPlate = decal(plate);
    a.decalPlate.roughness = 0.35;
    a.leaf = createLeafMaterial(foliage);
    a.puddle = createPuddleMaterial();

    opts.onProgress?.('Loading props…');
    a.props = new PropLibrary(renderer, lib.manifest);
    const ids = [...new Set([...Object.values(PROP_MODEL_IDS).flat(), ...OUTDOOR_SHRUB_IDS, ...OUTDOOR_ROCK_IDS])];
    if (a.textured) await a.props.load(ids, 0, (d, t) => opts.onProgress?.(`Loading props ${d}/${t}…`));

    a.rubble = [0, 1, 2].map((i) => rubbleGeometry(`rubble-${i}`));
    a.slab = slabGeometry();
    a.pipe = pipeGeometry(STOREY_HEIGHT - 0.45);
    a.trees = buildTreeVariants();
    for (const [t, g] of a.greyboxProps) {
      a.greyboxPropMats.set(t, new THREE.MeshStandardMaterial({ color: GREY_PROP[t], roughness: 0.85, flatShading: true }));
      a.owned.push(g);
    }
    return a;
  }

  private buildMaterials(cfg: MaterialsConfig) {
    surfaceUniforms.uMossMap.value = this.sets.get('moss_ground')?.map ?? null;
    surfaceUniforms.uMossScale.value = cfg.tuning.moss_ground?.scale ?? 0.5;
    for (const [role, spec] of Object.entries(ROLE_SPEC) as [KitRole, (typeof ROLE_SPEC)[KitRole]][]) {
      const set = this.sets.get(spec.cat) ?? null;
      const m = createSurfaceMaterial({
        set,
        scale: (cfg.tuning[spec.cat]?.scale ?? 0.5) * (spec.scaleMul ?? 1),
        color: spec.color,
        mossFactor: spec.moss,
        tint: spec.tint,
      });
      m.name = `kit:${role}`;
      this.kit.set(role, m);
    }
    const rubbleSet = this.sets.get('rubble') ?? null;
    this.rubbleMat = createSurfaceMaterial({ set: rubbleSet, scale: cfg.tuning.rubble?.scale ?? 0.8, color: 0x7a7266, mossFactor: 1, tint: 0x8a857c });
    this.root = createSurfaceMaterial({ set: null, scale: 1, color: 0x4a3a2a, mossFactor: 1.4 });
    this.root.flatShading = false;
    this.root.roughness = 0.95;
    this.bark = createSurfaceMaterial({ set: null, scale: 1, color: 0x5b4c3b, mossFactor: 1.2 });
    this.bark.flatShading = false;
  }

  /** Replace one category's texture set at runtime (used by the lab). */
  async swapCategory(cat: string, id: string, tier: TexTierName, scale: number) {
    const set = await this.lib.load(id, tier);
    this.sets.set(cat, set);
    const cfg: MaterialsConfig = { picks: {}, tuning: {} };
    for (const [role, spec] of Object.entries(ROLE_SPEC) as [KitRole, (typeof ROLE_SPEC)[KitRole]][]) {
      if (spec.cat !== cat) continue;
      const old = this.kit.get(role)!;
      cfg.tuning[cat] = { scale };
      const m = createSurfaceMaterial({ set, scale: scale * (spec.scaleMul ?? 1), color: spec.color, mossFactor: spec.moss, tint: spec.tint });
      old.copy(m);
      old.onBeforeCompile = m.onBeforeCompile;
      old.customProgramCacheKey = m.customProgramCacheKey;
      old.needsUpdate = true;
    }
    if (cat === 'rubble') {
      const m = createSurfaceMaterial({ set, scale, color: 0x7a7266, mossFactor: 1, tint: 0x8a857c });
      this.rubbleMat.copy(m);
      this.rubbleMat.onBeforeCompile = m.onBeforeCompile;
      this.rubbleMat.customProgramCacheKey = m.customProgramCacheKey;
      this.rubbleMat.needsUpdate = true;
    }
    if (cat === 'moss_ground') surfaceUniforms.uMossMap.value = set?.map ?? null;
  }

  dispose() {
    for (const m of this.kit.values()) m.dispose();
    for (const o of this.owned) o.dispose();
    for (const m of this.greyboxPropMats.values()) m.dispose();
    this.puddle?.dispose();
    this.decalMain?.dispose();
    this.decalPlate?.dispose();
    this.leaf?.dispose();
  }
}

const GREY_PROP: Record<PropType, number> = {
  rubble: 0x7a7266,
  debris: 0x6a5d4c,
  barrel: 0x9c4a22,
  collapsed_slab: 0x8a8880,
  vegetation: 0x3f7a2f,
  chair: 0x3c6e9e,
  desk: 0x8a6a45,
  classroom_desk: 0x8a6a45,
  pipe: 0x5e6266,
};

/** Shallow puddles: mirror-smooth, organic noise outline, animated rain-drip ripples. */
export function createPuddleMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x141a1c, roughness: 0.03, metalness: 0.0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = surfaceUniforms.uTime;
    shader.uniforms.uWetness = surfaceUniforms.uWetness;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime; uniform float uWetness; varying vec3 vPW;
float pH(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float pN(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(pH(i), pH(i+vec2(1,0)), f.x), mix(pH(i+vec2(0,1)), pH(i+vec2(1,1)), f.x), f.y); }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec2 p = vPW.xz * 1.6;
  vec2 g = vec2(0.0);
  for (int k = 0; k < 3; k++) {
    vec2 q = p + float(k) * 0.37;
    vec2 cell = floor(q);
    float h = pH(cell + float(k) * 7.0);
    vec2 c = cell + vec2(pH(cell + 1.3), pH(cell + 2.7));
    float t = fract(uTime * (0.35 + h * 0.3) + h);
    vec2 d = q - c;
    float r = length(d);
    float w = sin((r - t * 0.9) * 42.0) * exp(-abs(r - t * 0.9) * 14.0) * (1.0 - t);
    g += (r > 1e-4 ? d / r : vec2(0.0)) * w;
  }
  vec3 rn = normalize(vec3(-g.x * 0.25, 1.0, -g.y * 0.25));
  normal = normalize((viewMatrix * vec4(rn, 0.0)).xyz);
}`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
{
  float n = pN(vPW.xz * 0.9) * 0.65 + pN(vPW.xz * 2.3) * 0.35;
  float grow = 0.62 - uWetness * 0.25;
  diffuseColor.a *= smoothstep(grow, grow + 0.06, n);
}`,
      );
  };
  m.customProgramCacheKey = () => 'puddle';
  return m;
}
