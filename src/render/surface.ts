/**
 * Surface materials: MeshStandardMaterial + a small shader patch that reads a per-vertex
 * `surface` attribute (r = baked AO, g = moss mask, b = wet mask) and global uniforms for
 * wetness / moss amount / time. Moss blends a second (moss_ground) albedo in using world-space
 * noise; wetness darkens albedo and drops roughness. One patch serves every kit surface.
 */
import * as THREE from 'three';
import type { PbrSet } from './textures.ts';

/** Shared by every surface material: changing a value updates all of them. */
export const surfaceUniforms = {
  uTime: { value: 0 },
  uWetness: { value: 0.35 },
  uMoss: { value: 0 },
  uMossMap: { value: null as THREE.Texture | null },
  uMossScale: { value: 0.5 },
};

export interface SurfaceOptions {
  set: PbrSet | null;
  /** World metres → texture repeats (UVs are world-planar, 0.5 per metre baseline). */
  scale: number;
  /** Greybox fallback colour when no textures are available. */
  color: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  /** Multiplier on the moss contribution for this surface (e.g. 0 for metal). */
  mossFactor?: number;
  tint?: THREE.ColorRepresentation;
  normalScale?: number;
}

const NOISE = /* glsl */ `
float sHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1, 0)), f.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), f.x), f.y);
}
float sFbm(vec2 p) { return sNoise(p) * 0.55 + sNoise(p * 2.13 + 7.1) * 0.3 + sNoise(p * 4.7 + 1.3) * 0.15; }
`;

export function patchSurfaceShader(m: THREE.Material, mossFactor: number, uvScale: number) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = surfaceUniforms.uTime;
    shader.uniforms.uWetness = surfaceUniforms.uWetness;
    shader.uniforms.uMoss = surfaceUniforms.uMoss;
    shader.uniforms.uMossMap = surfaceUniforms.uMossMap;
    shader.uniforms.uMossScale = surfaceUniforms.uMossScale;
    shader.uniforms.uMossFactor = { value: mossFactor };
    shader.uniforms.uUvScale = { value: uvScale };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 surface;
varying vec4 vSurface;
varying vec3 vWPos;
varying vec3 vWNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSurface = surface;
vec4 sWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
sWp = instanceMatrix * sWp;
#endif
vWPos = (modelMatrix * sWp).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime; uniform float uWetness; uniform float uMoss; uniform float uMossScale;
uniform float uMossFactor; uniform float uUvScale;
uniform sampler2D uMossMap;
varying vec4 vSurface; varying vec3 vWPos; varying vec3 vWNormal;
${NOISE}
float sMossMask;
float sWet;
float sPuddle;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  // Planar projection matching the face: pick the dominant axis of the world normal.
  vec3 an = abs(vWNormal);
  vec2 wuv = an.y > 0.5 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
  float n = sFbm(wuv * 0.45);
  float up = clamp(vWNormal.y, 0.0, 1.0);
  float low = 1.0 - smoothstep(0.0, 0.9, vWPos.y);           // creeping up from the floor
  float m = vSurface.g * (0.55 + 0.9 * low) + up * 0.25 * vSurface.g;
  float n2 = sFbm(wuv * 1.7 + 3.1);
  sMossMask = smoothstep(0.5, 0.8, m * uMoss * uMossFactor * 1.4 + (n - 0.5) * 1.6 + (n2 - 0.5) * 0.6) * min(uMossFactor, 1.0) * 0.92;
  vec3 mossCol = texture2D(uMossMap, wuv * uMossScale).rgb;
  float ml = dot(mossCol, vec3(0.3, 0.59, 0.11));
  mossCol = mix(vec3(ml), mossCol, 0.75) * vec3(0.8, 0.92, 0.65);  // a little desaturated: damp, not neon
  diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, sMossMask);
  // Wetness: damp map + global wetness, broken up by noise; puddles handled separately.
  sWet = clamp(vSurface.b * (0.4 + uWetness * 1.2) + (sNoise(wuv * 0.9) - 0.6) * 0.5, 0.0, 1.0) * clamp(uWetness * 1.6, 0.0, 1.0);
  diffuseColor.rgb *= mix(1.0, 0.55, sWet);
  // Standing water: an organic mask over the smooth puddle field (pools along wall bases and in
  // damp areas). Continuous across cells, so it is never cut off at a tile edge.
  float thr = 0.6 - uWetness * 0.22;
  float pf = vSurface.a + (sFbm(vWPos.xz * 0.55 + 11.0) - 0.5) * 0.55 + (sNoise(vWPos.xz * 2.2) - 0.5) * 0.08;
  sPuddle = smoothstep(thr, thr + 0.05, pf) * step(0.0001, vSurface.a);
  sMossMask *= 1.0 - sPuddle;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.28 + vec3(0.004, 0.006, 0.007), sPuddle);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.38, sWet * 0.8);
roughnessFactor = mix(roughnessFactor, 0.85, sMossMask);
roughnessFactor = mix(roughnessFactor, 0.035, sPuddle);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (sPuddle > 0.001) {
  // Water is flat; drips make expanding rings.
  vec2 p = vWPos.xz * 1.6;
  vec2 gr = vec2(0.0);
  for (int k = 0; k < 3; k++) {
    vec2 q = p + float(k) * 0.37;
    vec2 cell = floor(q);
    float h = sHash(cell + float(k) * 7.0);
    vec2 c = cell + vec2(sHash(cell + 1.3), sHash(cell + 2.7));
    float t = fract(uTime * (0.35 + h * 0.3) + h);
    vec2 d = q - c;
    float r = length(d);
    float w = sin((r - t * 0.9) * 42.0) * exp(-abs(r - t * 0.9) * 14.0) * (1.0 - t);
    gr += (r > 1e-4 ? d / r : vec2(0.0)) * w;
  }
  vec3 rn = normalize((viewMatrix * vec4(normalize(vec3(-gr.x * 0.22, 1.0, -gr.y * 0.22)), 0.0)).xyz);
  normal = normalize(mix(normal, rn, sPuddle));
}`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= vSurface.r;
reflectedLight.indirectSpecular *= vSurface.r * vSurface.r;
reflectedLight.directDiffuse *= mix(1.0, vSurface.r, 0.35);`,
      );
  };
  // Separate program per (mossFactor, uvScale) combination.
  m.customProgramCacheKey = () => `surface-${mossFactor.toFixed(2)}-${uvScale.toFixed(3)}`;
}

export function createSurfaceMaterial(o: SurfaceOptions): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: o.set ? (o.tint ?? 0xffffff) : o.color,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? (o.set ? 1 : 0),
    flatShading: !o.set,
  });
  if (o.set) {
    // UVs are written at 0.5 repeats per metre; adjust via texture repeat per material.
    const rep = o.scale / 0.5;
    const tex = (t: THREE.Texture) => {
      const c = t.clone();
      c.repeat.set(rep, rep);
      c.needsUpdate = true;
      return c;
    };
    m.map = tex(o.set.map);
    m.normalMap = tex(o.set.normalMap);
    m.normalScale.setScalar(o.normalScale ?? 1);
    const orm = tex(o.set.orm);
    m.aoMap = orm;
    m.aoMapIntensity = 0.8;
    m.roughnessMap = orm;
    m.metalnessMap = orm;
  }
  patchSurfaceShader(m, o.mossFactor ?? 1, o.scale);
  return m;
}

/** Give a geometry a neutral `surface` attribute (AO 1, no moss, dry) if it lacks one. */
export function ensureSurfaceAttribute(g: THREE.BufferGeometry, ao = 1, moss = 0, wet = 0) {
  if (g.getAttribute('surface')) return;
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set([ao, moss, wet, 0], i * 4);
  g.setAttribute('surface', new THREE.BufferAttribute(a, 4));
}
