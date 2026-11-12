/**
 * Robin's sculpted body (scripts/robin → public/assets/monster/robin_body.glb): one continuous
 * skinned mesh, 53 bones, animated procedurally here:
 *
 *  - legs: analytic two-bone IK on a gait cycle sized to the actual speed, so feet plant without
 *    sliding; heel-toe roll; footsteps fire on contact
 *  - spine: hunch / lean / crouch blended per mode; breathing; ducks under door lintels
 *  - arms: dangle with spring lag and swing against the legs (walk), reach forward (run), spread
 *    and grab (attack); fingers curl, splay and twitch
 *  - head: looks at you (clamped), tilts like the photo, twitches; screams throw it back and shake
 *
 * Material: robin.png projected onto the face (and the T-shirt print onto the chest), mottled skin
 * with veins, dirty shirt, torn trousers, claws — all from the rest pose, so it sticks to the body.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { MonsterImage } from './monsterImage.ts';

export type RobinMode = 'idle' | 'walk' | 'run' | 'attack';

export type Species = 'robin' | 'leo' | 'jovan';

/** How a sculpted monster carries itself (all share one rig; see scripts/robin/characters.ts). */
export interface BodyStyle {
  idleHunch: number;
  walkHunch: number;
  runHunch: number;
  runLean: number;
  /** Metres per full gait cycle, walking / running. */
  walkStride: number;
  runStride: number;
  armSwing: number;
  /** Arms held away from the body (rad). */
  armOut: number;
  footLift: number;
  /** Skin tint mixed over the photo's tone (Leo: sick green). */
  tint: number;
  tintAmount: number;
  /** Highest the top of the head may go when not ducking (the ceiling is at 3.6 m). */
  headroom: number;
  shirtColor: number;
  pantsColor: number;
  /** The photo printed on the shirt (Robin's T-shirt). */
  print: boolean;
  /** How the arms work while moving: hanging (biped), on the knuckles (Leo), on the ceiling (Jovan). */
  gait: 'biped' | 'knuckle' | 'ceiling';
}

export const BODY_STYLES: Record<Species, BodyStyle> = {
  robin: { idleHunch: 0.45, walkHunch: 0.55, runHunch: 0.35, runLean: 0.55, walkStride: 1.55, runStride: 2.5, armSwing: 0.38, armOut: 0.12, footLift: 0.14, tint: 0x8a9096, tintAmount: 0, headroom: 3.45, shirtColor: 0xc8c5bd, pantsColor: 0x4a4c54, print: true, gait: 'biped' },
  leo: { idleHunch: 1.0, walkHunch: 1.05, runHunch: 1.15, runLean: 0.5, walkStride: 2.0, runStride: 3.6, armSwing: 0.5, armOut: 0.2, footLift: 0.12, tint: 0x6f8a5e, tintAmount: 0.75, headroom: 3.45, shirtColor: 0x66777c, pantsColor: 0x4a443c, print: false, gait: 'knuckle' },
  jovan: { idleHunch: 0.2, walkHunch: 0.25, runHunch: 0.3, runLean: 0.3, walkStride: 2.3, runStride: 3.4, armSwing: 0.22, armOut: 0.05, footLift: 0.12, tint: 0xa9b3ba, tintAmount: 0.45, headroom: 3.5, shirtColor: 0x5c272c, pantsColor: 0x34465e, print: false, gait: 'ceiling' },
};

/** Measured on the sculpt (public/assets/monster/<name>_body.json). */
export interface BodyMeta {
  eyeY: number;
  eyeHalf: number;
  collarY: number;
  shirtHalfWidth: number;
  hipsY: number;
  height: number;
  /** Where the shirt hem sits (grime collects there). */
  hemY?: number;
  /** Below this the trousers are shoes (Jovan's sneakers); -1 = barefoot. */
  shoeY?: number;
}

export const bodyUrl = (s: Species) => `/assets/monster/${s}_body.glb?v=5`;
export const ROBIN_BODY_URL = bodyUrl('robin');

/** Photo layout (pixels in robin.png): eye centres, and where the shirt collar sits. */
export const ROBIN_PHOTO = {
  eyeL: [145, 352] as const, // left in the image (his right eye)
  eyeR: [232, 345] as const,
  /** Model-space y of the eye line and half the distance between the eyes (m), head scale 1.32. */
  eyeY: 2.84 + (2.957 - 2.84) * 1.32,
  eyeHalf: 0.043 * 1.32,
  collar: [195, 485] as const,
  collarY: 2.49,
  shirtHalfWidthPx: 180,
  shirtHalfWidth: 0.3,
};

export interface RobinTemplate {
  scene: THREE.Group;
  mesh: THREE.SkinnedMesh;
  species: Species;
  meta: BodyMeta;
}

/** Robin's body (compatibility). */
export const loadRobinBody = (photo: MonsterImage | null) => loadBody('robin', photo);

/** Load a sculpted body and build its material (null if the GLB is missing). No photo = faceless. */
export async function loadBody(species: Species, photo: MonsterImage | null): Promise<RobinTemplate | null> {
  try {
    const [gltf, meta] = await Promise.all([
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(bodyUrl(species)),
      fetch(`/assets/monster/${species}_body.json?v=5`).then((r) => r.json() as Promise<BodyMeta>),
    ]);
    let mesh: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    if (!mesh) return null;
    const m = mesh as THREE.SkinnedMesh;
    const geo = m.geometry;
    // Our masks travel in COLOR_0 / TEXCOORD_0; rename so three doesn't treat them as colour/uv.
    geo.setAttribute('aMask', geo.getAttribute('color'));
    geo.setAttribute('aMask2', geo.getAttribute('uv'));
    geo.deleteAttribute('color');
    geo.deleteAttribute('uv');
    m.material = createRobinMaterial(photo, meta, BODY_STYLES[species]);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return { scene: gltf.scene, mesh: m, species, meta };
  } catch (e) {
    console.warn(`${species} body failed to load`, e);
    return null;
  }
}

/** Average colour of a photo region (linear), used to match the body's skin and hair to the photo. */
function sampleColor(img: CanvasImageSource & { width: number; height: number }, x0: number, y0: number, x1: number, y1: number, fallback: number): THREE.Color {
  try {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 200) continue;
      r += d[i]!;
      gg += d[i + 1]!;
      b += d[i + 2]!;
      n++;
    }
    if (!n) return new THREE.Color(fallback);
    return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    return new THREE.Color(fallback);
  }
}

export function createRobinMaterial(photo: MonsterImage | null, meta?: BodyMeta, style: BodyStyle = BODY_STYLES.robin): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  const img = photo?.texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const W = img?.width ?? 379;
  const Hh = img?.height ?? 658;
  const P = ROBIN_PHOTO;
  const ang = Math.atan2(P.eyeR[1] - P.eyeL[1], P.eyeR[0] - P.eyeL[0]);
  const skin = img ? sampleColor(img, 150, 380, 178, 405, 0xd9a58a) : new THREE.Color(0xd9a58a);
  const hair = img ? sampleColor(img, 150, 180, 250, 230, 0x5a3b28) : new THREE.Color(0x5a3b28);
  const uniforms = {
    uPhoto: { value: photo?.texture ?? null },
    uHasPhoto: { value: photo ? 1 : 0 },
    uPhotoSize: { value: new THREE.Vector2(W, Hh) },
    uFaceC: { value: new THREE.Vector2((P.eyeL[0] + P.eyeR[0]) / 2, (P.eyeL[1] + P.eyeR[1]) / 2) },
    uFaceY: { value: meta?.eyeY ?? P.eyeY },
    uFaceS: { value: (2 * (meta?.eyeHalf ?? P.eyeHalf)) / Math.hypot(P.eyeR[0] - P.eyeL[0], P.eyeR[1] - P.eyeL[1]) },
    uFaceRot: { value: ang },
    uShirtC: { value: new THREE.Vector2(P.collar[0], P.collar[1]) },
    uShirtY: { value: meta?.collarY ?? P.collarY },
    uShirtS: { value: (meta?.shirtHalfWidth ?? P.shirtHalfWidth) / P.shirtHalfWidthPx },
    uTint: { value: new THREE.Color(style.tint) },
    uShirtCol: { value: new THREE.Color(style.shirtColor) },
    uPantsCol: { value: new THREE.Color(style.pantsColor) },
    uPrint: { value: style.print ? 1 : 0 },
    uHemY: { value: meta?.hemY ?? 1.97 },
    uShoeY: { value: meta?.shoeY ?? -1 },
    uTintAmt: { value: style.tintAmount },
    uEyeHalf: { value: meta?.eyeHalf ?? P.eyeHalf },
    uSkin: { value: skin },
    uHair: { value: hair },
    uGlow: { value: 0.035 },
    /** Jump scare: 0..1 face warp (mouth tears open, eyes bulge and bleed), and its clock. */
    uWarp: { value: 0 },
    uScareTime: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aMask;
        attribute vec2 aMask2;
        varying vec3 vRest;
        varying vec3 vRestN;
        varying vec4 vMask;
        varying vec2 vMask2;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRest = position;
        vRestN = normal;
        vMask = aMask;
        vMask2 = aMask2;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uPhoto;
        uniform float uHasPhoto;
        uniform vec2 uPhotoSize;
        uniform vec2 uFaceC;
        uniform float uFaceY;
        uniform float uFaceS;
        uniform float uFaceRot;
        uniform vec2 uShirtC;
        uniform float uShirtY;
        uniform float uShirtS;
        uniform vec3 uSkin;
        uniform vec3 uHair;
        uniform float uGlow;
        uniform vec3 uTint;
        uniform float uTintAmt;
        uniform vec3 uShirtCol;
        uniform vec3 uPantsCol;
        uniform float uPrint;
        uniform float uHemY;
        uniform float uShoeY;
        uniform float uEyeHalf;
        uniform float uWarp;
        uniform float uScareTime;
        varying vec3 vRest;
        varying vec3 vRestN;
        varying vec4 vMask;
        varying vec2 vMask2;
        float rHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float rNoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(rHash(i), rHash(i + vec3(1,0,0)), f.x), mix(rHash(i + vec3(0,1,0)), rHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(rHash(i + vec3(0,0,1)), rHash(i + vec3(1,0,1)), f.x), mix(rHash(i + vec3(0,1,1)), rHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float rFbm(vec3 p) { float a = 0.0, w = 0.5; for (int i = 0; i < 4; i++) { a += w * rNoise(p); p *= 2.03; w *= 0.5; } return a; }
        vec2 faceUV(vec3 p) {
          vec2 q = vec2(p.x, -(p.y - uFaceY)) / uFaceS;
          float c = cos(uFaceRot), s = sin(uFaceRot);
          vec2 px = uFaceC + vec2(q.x * c - q.y * s, q.x * s + q.y * c);
          return vec2(px.x / uPhotoSize.x, 1.0 - px.y / uPhotoSize.y); // textures are flipY
        }
        vec2 shirtUV(vec3 p) { vec2 px = uShirtC + vec2(p.x, -(p.y - uShirtY)) / uShirtS; return vec2(px.x / uPhotoSize.x, 1.0 - px.y / uPhotoSize.y); }
        float inside01(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
        vec3 bumpN(vec3 pos, vec3 n, float h) {
          vec3 sx = dFdx(pos), sy = dFdy(pos);
          vec3 r1 = cross(sy, n), r2 = cross(n, sx);
          float det = dot(sx, r1);
          vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
          return normalize(abs(det) * n - g);
        }
        float gRough = 0.6;
        float gH = 0.0;
        vec3 gEmis = vec3(0.0);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 p = vRest;
          float shirt = vMask.y, pants = vMask.z, hairM = vMask.w, nail = vMask2.x;
          float skinM = clamp(1.0 - shirt - pants - hairM - nail, 0.0, 1.0);
          // Skin: the photo's tone, drained and bruised; veins and blotches.
          float mott = rFbm(p * 7.0);
          // Sickly grey-pale on the body, warming to the photo's own tone towards the head so the
          // face doesn't sit on the neck like a mask.
          float headward = smoothstep(uFaceY - 0.55, uFaceY - 0.15, p.y);
          vec3 grey = vec3(dot(uSkin, vec3(0.3, 0.55, 0.15))) * vec3(0.9, 0.95, 0.97);
          vec3 sk = mix(mix(uSkin, grey, 0.5), uSkin * 0.92, headward) * mix(0.68 + 0.4 * mott, 0.9 + 0.15 * mott, headward);
          sk = mix(sk, uTint * (0.62 + 0.45 * mott), uTintAmt * (1.0 - 0.6 * headward * uHasPhoto));
          float vein = pow(1.0 - abs(rNoise(p * vec3(16.0, 5.0, 16.0)) * 2.0 - 1.0), 14.0);
          sk = mix(sk, vec3(0.22, 0.24, 0.36), vein * 0.4);
          sk = mix(sk, vec3(0.32, 0.18, 0.2), smoothstep(0.58, 0.8, rFbm(p * 3.1 + 4.0)) * 0.55);
          // Grime collects low on the body and in creases.
          sk *= mix(0.65, 1.0, smoothstep(0.1, 1.2, p.y));
          // Shirt: off-white, sweat-yellowed, filthy hem, old blood.
          float dirt = rFbm(p * 5.0 + 9.0);
          vec3 sh = uShirtCol * 1.4 * (0.62 + 0.45 * dirt);
          sh = mix(sh, vec3(0.55, 0.46, 0.3) * 0.7, smoothstep(uHemY + 0.18, uHemY - 0.02, p.y) * 0.6 * (1.0 - smoothstep(0.4, 0.55, abs(p.x))));
          sh = mix(sh, vec3(0.22, 0.05, 0.04), smoothstep(0.62, 0.78, rFbm(p * 4.0 + 2.0)) * 0.85);
          // Print from the photo on the chest.
          vec2 su = shirtUV(p);
          vec4 pr = texture2D(uPhoto, su);
          float prW = uPrint * uHasPhoto * inside01(su) * pr.a * smoothstep(0.0, 0.06, p.z) * smoothstep(0.1, 0.5, vRestN.z);
          sh = mix(sh, pr.rgb * (0.65 + 0.35 * dirt), prW);
          // Trousers: dark, worn, torn.
          vec3 pa = uPantsCol * (0.62 + 0.75 * rFbm(p * vec3(9.0, 3.0, 9.0)));
          // Sneakers: dark canvas on a scuffed off-white sole.
          vec3 shoeC = mix(vec3(0.03, 0.03, 0.035) * (0.7 + 0.6 * rNoise(p * 80.0)), vec3(0.5, 0.48, 0.44) * (0.75 + 0.3 * rNoise(p * 50.0)), smoothstep(0.034, 0.024, p.y));
          pa = mix(pa, shoeC, step(p.y, uShoeY));
          vec3 ha = uHair * (0.55 + 0.7 * rNoise(p * vec3(60.0, 18.0, 60.0)));
          vec3 na = vec3(0.32, 0.27, 0.17) * (0.6 + 0.5 * rNoise(p * 120.0));
          vec3 col = sk * skinM + sh * shirt + pa * pants + ha * hairM + na * nail;
          // Face: the photo, projected from the front, faded out towards the sides.
          vec2 fu0 = faceUV(p);
          vec2 fu = fu0;
          float mouthHole = 0.0;
          float blood = 0.0;
          if (uWarp > 0.001) {
            // Work in photo pixels (y down).
            vec2 P = vec2(fu.x * uPhotoSize.x, (1.0 - fu.y) * uPhotoSize.y);
            vec2 M = vec2(205.0, 430.0);
            vec2 E1 = vec2(145.0, 352.0), E2 = vec2(232.0, 345.0);
            // Mouth tears open: a smooth vertical stretch around the smile.
            vec2 d = P - M;
            float mw = exp(-pow(d.x / 75.0, 2.0)) * exp(-pow(d.y / 90.0, 2.0));
            P.y = M.y + d.y / (1.0 + 0.9 * uWarp * mw);
            // Eyes widen a little.
            for (int k = 0; k < 2; k++) {
              vec2 E = k == 0 ? E1 : E2;
              vec2 de = P - E;
              P = E + de * (1.0 - 0.25 * uWarp * exp(-dot(de, de) / 500.0));
              // A thin dark-red tear running down from each eye.
              float run = 40.0 + 110.0 * uWarp;
              float tear = exp(-pow((P.x - E.x) / 4.0, 2.0)) * smoothstep(E.y + 4.0, E.y + 12.0, P.y) * (1.0 - smoothstep(E.y + run * 0.7, E.y + run, P.y));
              blood = max(blood, tear);
            }
            // The stretched mouth is dark inside.
            vec2 dm = (P - M) / vec2(55.0, 8.0 + 18.0 * uWarp);
            mouthHole = uWarp * 0.85 * (1.0 - smoothstep(0.6, 1.0, length(dm)));
            fu = vec2(P.x / uPhotoSize.x, 1.0 - P.y / uPhotoSize.y);
          }
          vec4 ph = texture2D(uPhoto, fu);
          // The photo was cut out of a white background: pull the mask in from its edge (lowest
          // alpha a few pixels around) so the whitish fringe never shows on the cheeks.
          vec2 px = 7.0 / uPhotoSize;
          float aMin = min(min(texture2D(uPhoto, fu + vec2(px.x, 0.0)).a, texture2D(uPhoto, fu - vec2(px.x, 0.0)).a),
                           min(texture2D(uPhoto, fu + vec2(0.0, px.y)).a, texture2D(uPhoto, fu - vec2(0.0, px.y)).a));
          float fw = uHasPhoto * smoothstep(0.0, 0.6, vMask2.y) * inside01(fu0) * smoothstep(0.75, 0.98, min(ph.a, aMin)) * (1.0 - smoothstep(0.19, 0.21, 1.0 - fu0.y - (uFaceC.y / uPhotoSize.y)));
          vec3 face = ph.rgb;
          face = mix(face, face * vec3(0.8, 0.7, 0.7), uWarp * 0.4);
          face = mix(face, vec3(0.22, 0.0, 0.01), blood * min(1.0, uWarp * 1.5) * 0.85);
          face = mix(face, vec3(0.015, 0.0, 0.0), mouthHole);
          col = mix(col, face, fw);
          if (uHasPhoto < 0.5) {
            // No photo yet: a faceless head with hollow, sunken eyes and a black slit of a mouth.
            vec2 q = vec2(p.x, p.y - uFaceY) / uEyeHalf;
            float eyes = 1.0 - smoothstep(0.32, 0.5, min(length((q - vec2(1.0, 0.0)) * vec2(1.0, 1.4)), length((q - vec2(-1.0, 0.0)) * vec2(1.0, 1.4))));
            float mouth = 1.0 - smoothstep(0.75, 1.0, length((q - vec2(0.0, -1.9)) / vec2(0.95, 0.16)));
            float front = vMask2.y;
            col = mix(col, vec3(0.012, 0.008, 0.008), max(eyes, mouth * 0.9) * front);
          }
          col *= mix(1.0, vMask.x, 0.85);
          diffuseColor.rgb = col;
          gRough = skinM * (0.48 + 0.25 * rNoise(p * 30.0)) + shirt * 0.93 + pants * 0.9 + hairM * 0.7 + nail * 0.3;
          gRough = mix(gRough, 0.58, fw);
          // Fine relief: pores and wrinkles on skin, weave on cloth (weaker on the photo face).
          gH = skinM * (rNoise(p * 140.0) * 0.4 + rFbm(p * vec3(30.0, 110.0, 30.0)) * 0.6) * (1.0 - fw * 0.8) + shirt * rFbm(p * vec3(25.0, 60.0, 25.0)) * 0.5 + pants * rNoise(p * vec3(160.0, 30.0, 160.0)) * 0.5;
          gEmis = col * uGlow;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n        normal = bumpN(-vViewPosition, normal, gH * 0.002);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEmis;
        // Faint cold rim on the silhouette: his shape reads against the dark.
        float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += vec3(0.55, 0.62, 0.75) * rim * 0.07;`,
      );
  };
  mat.customProgramCacheKey = () => 'robin-v8';
  return mat;
}

// ───────────────────────────── animation ─────────────────────────────

interface Spring {
  x: number;
  v: number;
}
const spring = (s: Spring, target: number, dt: number, freq: number, damp = 0.75) => {
  const w = 2 * Math.PI * freq;
  s.v += (-w * w * (s.x - target) - 2 * damp * w * s.v) * dt;
  s.x += s.v * dt;
  return s.x;
};
const expTo = (cur: number, target: number, dt: number, rate: number) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

interface Leg {
  side: 1 | -1;
  thigh: THREE.Bone;
  shin: THREE.Bone;
  foot: THREE.Bone;
  toes: THREE.Bone;
  a: number;
  b: number;
  restAnkle: THREE.Vector3;
  phaseOffset: number;
  planted: boolean;
}

interface Finger {
  bones: THREE.Bone[];
  axis: THREE.Vector3; // curl axis (rest, parent space)
  spread: THREE.Vector3;
  thumb: boolean;
}

interface Arm {
  side: 1 | -1;
  /** Upper arm / forearm lengths (IK). */
  a: number;
  b: number;
  planted: boolean;
  clav: THREE.Bone;
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  fingers: Finger[];
  swing: Spring;
  out: Spring;
  elbow: Spring;
}

export class RobinBody {
  readonly object = new THREE.Group();
  mode: RobinMode = 'idle';
  /** Ground speed (m/s), set by the AI. */
  speed = 0;
  /** 0..1: duck under a door lintel. */
  duck = 0;
  onStep: (foot: THREE.Vector3, loud: number) => void = () => {};
  private bones = new Map<string, THREE.Bone>();
  private legs: Leg[] = [];
  private arms: Arm[] = [];
  private t = Math.random() * 100;
  private phase = 0;
  private gaitAmp = 0;
  private post = { hunch: 0.5, lean: 0, crouch: 0.05, reach: 0, spread: 0, duck: 0, run: 0 };
  private tilt: Spring = { x: 0.25, v: 0 };
  private tiltTarget = 0.25;
  private twitch = { yaw: { x: 0, v: 0 } as Spring, roll: { x: 0, v: 0 } as Spring, pitch: { x: 0, v: 0 } as Spring };
  private nextTwitch = 2;
  private screamT = -1;
  private attackT = 0;
  private headLook = new THREE.Quaternion();
  private hasLook = false;
  readonly species: Species;
  readonly style: BodyStyle;
  /** Rest height of the hips and of the top of the head above the head bone. */
  private hipsY: number;
  private headTopOff = 0.36;
  /** 0..1.2: extra stoop to keep the head under the ceiling / a door lintel (feedback). */
  private stoop = 0;
  private lastTop = 0;
  /** Freeze in place (Jovan while you look at him): no gait, no breathing — only twitches. */
  frozen = false;
  /** One-off performances the AI asks for (Leo: roar = rear up and pound the chest; stunned). */
  act: 'none' | 'roar' | 'stunned' = 'none';
  private actT = 0;
  private actW = 0;
  /** 0..1: arms on the ground (Leo) / on the ceiling (Jovan). */
  private armIK = 0;
  /** Ceiling height above the feet (Jovan presses his palms against it). */
  ceiling = 3.6;

  constructor(tpl: RobinTemplate) {
    this.species = tpl.species ?? 'robin';
    this.style = BODY_STYLES[this.species];
    this.hipsY = tpl.meta?.hipsY ?? 1.55;
    this.object.add(tpl.scene);
    this.uniforms = ((tpl.mesh.material as THREE.Material).userData.uniforms as Record<string, { value: unknown }> | undefined) ?? null;
    tpl.scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    tpl.scene.updateMatrixWorld(true);
    const B = (n: string) => this.bones.get(n)!;
    if (tpl.meta) this.headTopOff = tpl.meta.height - B('head').getWorldPosition(new THREE.Vector3()).y;
    const wp = (n: string) => B(n).getWorldPosition(new THREE.Vector3());
    for (const [side, s] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      this.legs.push({
        side: s,
        thigh: B(`thigh${side}`),
        shin: B(`shin${side}`),
        foot: B(`foot${side}`),
        toes: B(`toes${side}`),
        a: wp(`thigh${side}`).distanceTo(wp(`shin${side}`)),
        b: wp(`shin${side}`).distanceTo(wp(`foot${side}`)),
        restAnkle: wp(`foot${side}`),
        phaseOffset: s === 1 ? 0 : 0.5,
        planted: true,
      });
      const palmN = new THREE.Vector3(-0.866 * s, -0.5, 0);
      const fingers: Finger[] = [];
      for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        const bs = [1, 2, 3].map((i) => B(`${f}${i}${side}`));
        const p1 = bs[0]!.getWorldPosition(new THREE.Vector3());
        const p2 = bs[1]!.getWorldPosition(new THREE.Vector3());
        const dir = p2.clone().sub(p1).normalize();
        const axis = new THREE.Vector3().crossVectors(dir, palmN).normalize();
        fingers.push({ bones: bs, axis, spread: palmN.clone(), thumb: f === 'thumb' });
      }
      this.arms.push({
        side: s,
        clav: B(`clavicle${side}`),
        upper: B(`upperarm${side}`),
        fore: B(`forearm${side}`),
        hand: B(`hand${side}`),
        fingers,
        swing: { x: 0, v: 0 },
        out: { x: 0, v: 0 },
        elbow: { x: 0.3, v: 0 },
        a: wp(`upperarm${side}`).distanceTo(wp(`forearm${side}`)),
        b: wp(`forearm${side}`).distanceTo(wp(`hand${side}`)),
        planted: true,
      });
    }
  }

  get head(): THREE.Bone {
    return this.bones.get('head')!;
  }

  scream() {
    this.screamT = 0;
  }

  /**
   * Jump-scare choreography time (s), driven by the JumpScare; -1 = off.
   *   < hitAt  wind-up: hunched low, head cocked sideways, snaps upright and stares
   *   ≥ hitAt  lunge: arms flung wide, claws splayed, screaming with a violent head shake,
   *            then the claws close in
   */
  scareT = -1;
  /** When the lunge lands (s into the scare); the JumpScare sets it. */
  scareHit = 1.35;
  static readonly SCARE_HIT = 1.35;
  /** Moment the head snaps back upright (after turning upside down). */
  static readonly SCARE_SNAP = 0.78;
  private uniforms: Record<string, { value: unknown }> | null = null;

  /** Face warp for the scare (0..1). */
  setWarp(w: number, t: number) {
    if (!this.uniforms) return;
    this.uniforms.uWarp!.value = w;
    this.uniforms.uScareTime!.value = t;
  }

  /** `look`: world position to look at (the player's eye). */
  update(dt: number, look: THREE.Vector3 | null) {
    dt = Math.min(dt, 0.05);
    const st = this.style;
    // Frozen: the body holds still (no gait, no breath); the head still twitches and turns.
    const realDt = dt;
    if (this.frozen && this.scareT < 0) dt = 0;
    this.t += dt;
    const B = (n: string) => this.bones.get(n)!;
    const sc = this.scareT;
    const hit = this.scareHit;
    if (sc >= 0) this.mode = sc < hit ? 'idle' : 'attack';
    const mode = this.mode;
    if (mode === 'attack') this.attackT = sc >= 0 ? sc - hit : this.attackT + dt;
    else this.attackT = 0;
    if (sc >= hit && sc - dt < hit) this.screamT = 0;
    if (sc >= 0 && sc < hit) {
      // The head slowly turns upside down while he stares… then snaps back.
      const snap = RobinBody.SCARE_SNAP;
      this.tiltTarget = sc < snap ? Math.PI * 0.97 : -0.08;
      if (sc >= snap && sc - dt < snap) {
        this.tilt.x = 0.15;
        this.tilt.v = 0;
        this.twitch.roll.v -= 30;
        this.twitch.yaw.v += 20;
      }
    }
    if (this.screamT >= 0) {
      this.screamT += dt;
      if (this.screamT > 1.6) this.screamT = -1;
    }
    const scream = this.screamT >= 0 ? Math.sin(Math.min(1, this.screamT / 1.6) * Math.PI) : 0;
    const act = sc >= 0 ? 'none' : this.act;
    this.actT = act === 'none' ? 0 : this.actT + dt;
    this.actW = expTo(this.actW, act === 'none' ? 0 : 1, dt, 8);
    const leo = this.species === 'leo';

    // ── posture targets ──
    const p = this.post;
    const run = mode === 'run' ? 1 : 0;
    const tgt = {
      hunch: mode === 'attack' ? 0.05 : mode === 'run' ? st.runHunch : mode === 'walk' ? st.walkHunch : st.idleHunch,
      lean: run * st.runLean,
      crouch: mode === 'attack' ? 0.02 : mode === 'run' ? 0.16 : mode === 'walk' ? 0.08 : 0.05,
      reach: mode === 'run' ? 1 : mode === 'attack' ? 1 : 0,
      spread: mode === 'attack' ? 1 : scream * 0.6,
    };
    let rateK = 1;
    if (act === 'roar') Object.assign(tgt, { hunch: -0.15, lean: 0, crouch: 0.12, reach: 0, spread: 0 });
    if (act === 'stunned') Object.assign(tgt, { hunch: 0.5, lean: 0, crouch: 0.3, reach: 0, spread: 0 });
    // Leo's slam: rear up with both fists overhead, then bring them down (period 0.9 s).
    const slamPh = leo && mode === 'attack' && sc < 0 ? (this.attackT % 0.9) / 0.9 : -1;
    if (slamPh >= 0) {
      const down = THREE.MathUtils.smoothstep(slamPh, 0.45, 0.58) * (1 - THREE.MathUtils.smoothstep(slamPh, 0.75, 1));
      Object.assign(tgt, { hunch: THREE.MathUtils.lerp(-0.2, 1.2, down), lean: 0, crouch: 0.1 + 0.15 * down, reach: 0, spread: 0 });
      rateK = 5;
    }
    if (sc >= 0) {
      rateK = 6;
      if (sc < hit) Object.assign(tgt, { hunch: 0.85, lean: 0, crouch: 0.28, reach: 0, spread: 0 });
      else Object.assign(tgt, { hunch: 0.55, lean: 0.35, crouch: 0.1, reach: 1, spread: 1 });
    }
    // Stoop just enough to keep the head under the ceiling (or under a door lintel when ducking).
    p.duck = expTo(p.duck, this.duck, realDt, 4 * rateK);
    const limit = THREE.MathUtils.lerp(st.headroom, 2.5, p.duck);
    // (Integral control on the measured head height, applied directly — no smoothing lag, so it
    // settles instead of overshooting.)
    if (this.lastTop > 0 && sc < 0) this.stoop = THREE.MathUtils.clamp(this.stoop + (this.lastTop - limit) * realDt * 2.5, 0, 1);
    if (sc >= 0) this.stoop = expTo(this.stoop, 0, realDt, 2);
    p.hunch = expTo(p.hunch, tgt.hunch, dt, 3 * rateK);
    p.lean = expTo(p.lean, tgt.lean, dt, 3 * rateK);
    p.crouch = expTo(p.crouch, tgt.crouch, dt, 3 * rateK);
    p.reach = expTo(p.reach, tgt.reach, dt, 4 * rateK);
    p.spread = expTo(p.spread, tgt.spread, dt, 5 * rateK);
    p.run = expTo(p.run, run, dt, 4);

    // ── gait ──
    const stride = THREE.MathUtils.lerp(st.walkStride, st.runStride, p.run); // metres per full cycle
    const moving = this.speed > 0.05 && mode !== 'attack';
    this.gaitAmp = expTo(this.gaitAmp, moving ? 1 : 0, dt, 5);
    if (moving) this.phase = (this.phase + (dt * this.speed) / stride) % 1;
    const beta = THREE.MathUtils.lerp(0.62, 0.4, p.run); // stance fraction

    for (const b of this.bones.values()) b.quaternion.identity();
    // Hips: drop, bob, sway.
    const hips = B('hips');
    const ph2 = this.phase * Math.PI * 4;
    const bob = this.gaitAmp * (-0.03 - 0.03 * p.run) * Math.cos(ph2);
    hips.position.set(this.gaitAmp * 0.025 * Math.sin(this.phase * Math.PI * 2) * (1 - p.run), this.hipsY - (p.crouch + this.stoop * 0.3) * 0.6 * (this.hipsY / 1.55) + bob + Math.sin(this.t * 1.3) * 0.006, -p.lean * 0.05);
    const dizzy = act === 'stunned' ? this.actW : 0;
    hips.position.x += dizzy * 0.09 * Math.sin(this.actT * 2.3);
    hips.quaternion.setFromEuler(new THREE.Euler(p.lean * 0.35, this.gaitAmp * 0.1 * Math.sin(this.phase * Math.PI * 2), this.gaitAmp * 0.05 * Math.cos(this.phase * Math.PI * 2) + dizzy * 0.12 * Math.sin(this.actT * 2.3 + 0.6)));

    // Spine: hunch spread over the vertebrae, counter-rotation against the hips, breathing.
    const breath = Math.sin(this.t * (1.1 + p.run * 1.5)) * (0.025 + p.run * 0.03) + scream * 0.12;
    const hunch = (p.hunch + this.stoop * 0.55) * 0.9 + p.lean * 0.45;
    const counter = -this.gaitAmp * 0.12 * Math.sin(this.phase * Math.PI * 2);
    B('spine1').quaternion.setFromEuler(new THREE.Euler(hunch * 0.22, counter * 0.4, 0));
    B('spine2').quaternion.setFromEuler(new THREE.Euler(hunch * 0.33 - breath * 0.4, counter * 0.4, 0));
    // Galloping on his knuckles, Leo's back rocks; roaring, he arches back.
    const rock = st.gait === 'knuckle' ? this.gaitAmp * p.run * 0.16 * Math.sin(this.phase * Math.PI * 2 + 0.8) : 0;
    const arch = act === 'roar' ? this.actW * 0.3 : 0;
    B('chest').quaternion.setFromEuler(new THREE.Euler(hunch * 0.45 - breath - scream * 0.25 + rock - arch, counter * 0.4, Math.sin(this.t * 0.37) * 0.04 - dizzy * 0.1 * Math.sin(this.actT * 2.3)));
    B('neck1').quaternion.setFromEuler(new THREE.Euler(p.hunch * 0.25, 0, 0));

    // ── arms ──
    const spineFwd = hunch + p.lean * 0.35 - scream * 0.25;
    for (const arm of this.arms) {
      const s = arm.side;
      const legPh = this.phase + (s === 1 ? 0.5 : 0);
      const swingT = this.gaitAmp * (1 - p.reach) * st.armSwing * Math.sin(legPh * Math.PI * 2);
      // Hang with gravity (undo the hunch), swing, reach forward when running/attacking.
      const atk = this.attackT;
      const grab = mode === 'attack' ? THREE.MathUtils.smoothstep(atk, 0.25, 0.55) : 0;
      const reachPitch = -1.25 * p.reach * (1 - p.spread * 0.2) + p.run * 0.25 * Math.sin(legPh * Math.PI * 2);
      const pitch = spring(arm.swing, -spineFwd * 0.92 + swingT + reachPitch - grab * 0.25, dt, 1.4 * (sc >= 0 ? 3 : 1), 0.55);
      const outT = st.armOut + p.spread * (1.0 - grab * 0.9) - this.gaitAmp * 0.08;
      const out = spring(arm.out, outT, dt, 1.6 * (sc >= 0 ? 3 : 1), 0.6);
      const elbow = spring(arm.elbow, 0.22 + this.gaitAmp * 0.12 + p.reach * (0.15 - grab * 0.2) + scream * 0.3 + p.duck * 0.2, dt, 2.2 * (sc >= 0 ? 2 : 1), 0.6);
      arm.clav.quaternion.setFromEuler(new THREE.Euler(0, 0, s * (0.05 + p.spread * 0.15 + scream * 0.1)));
      arm.upper.quaternion.setFromEuler(new THREE.Euler(pitch, s * 0.15 * p.reach, s * (out - 0.35)));
      arm.fore.quaternion.setFromAxisAngle(_v.set(0.5 * s, -0.866, 0).cross(Z).normalize(), elbow).multiply(_q.setFromAxisAngle(_v2.set(0.5 * s, -0.866, 0), s * 0.6 * p.reach));
      arm.hand.quaternion.setFromEuler(new THREE.Euler(-0.15 * p.reach + 0.1 * Math.sin(this.t * 2.1 + s), 0, s * 0.1));
      // Fingers: loosely curled, twitching; splayed when reaching; claw shut on the grab.
      const splay = Math.max(p.reach * (1 - grab), p.spread * 0.6, scream * 0.8);
      arm.fingers.forEach((f, fi) => {
        const tw = Math.max(0, Math.sin(this.t * (3.1 + fi * 0.7) + s * 2 + fi)) ** 6 * 0.35;
        let curl = 0.25 + tw - splay * 0.35 + grab * 1.0;
        // Fist for the knuckles (and Leo's roar), flat palm against the ceiling.
        const fist = st.gait === 'knuckle' ? Math.max(this.armIK, this.actW, slamPh >= 0 ? 1 : 0) : 0;
        if (fist > 0) curl = THREE.MathUtils.lerp(curl, f.thumb ? 0.7 : 1.45, fist);
        if (st.gait === 'ceiling') curl = THREE.MathUtils.lerp(curl, -0.06 + tw * 0.4, this.armIK);
        const spreadA = (fi - 2) * 0.09 * splay * s;
        f.bones.forEach((b, j) => {
          b.quaternion.setFromAxisAngle(f.axis, curl * (j === 0 ? 0.6 : 1) * (f.thumb ? 0.5 : 1));
          if (j === 0) b.quaternion.premultiply(_q.setFromAxisAngle(f.spread, spreadA));
        });
      });
    }

    this.object.updateMatrixWorld(true);
    if (leo && (this.actW > 0.001 || slamPh >= 0)) {
      this.leoActArms(act, slamPh);
      this.object.updateMatrixWorld(true);
    }
    // ── legs (IK) ──
    const objQ = this.object.getWorldQuaternion(new THREE.Quaternion());
    for (const leg of this.legs) {
      const off = st.gait === 'knuckle' ? (leg.side === 1 ? 0 : THREE.MathUtils.lerp(0.5, 0.12, p.run)) : leg.phaseOffset;
      const lp = (this.phase + off) % 1;
      let z: number;
      let lift = 0;
      let footPitch: number;
      const half = stride * 0.5; // stance covers beta·stride, centred under the hip
      if (lp < beta) {
        const u = lp / beta;
        z = THREE.MathUtils.lerp(beta * half, -beta * half, u);
        footPitch = u > 0.75 ? -(u - 0.75) * 1.6 : 0; // heel lifts before toe-off
        if (!leg.planted) {
          leg.planted = true;
          if (this.gaitAmp > 0.3) this.onStep(leg.foot.getWorldPosition(new THREE.Vector3()), 0.5 + p.run * 0.5);
        }
      } else {
        const u = (lp - beta) / (1 - beta);
        z = THREE.MathUtils.lerp(-beta * half, beta * half, (1 - Math.cos(u * Math.PI)) / 2);
        lift = Math.sin(u * Math.PI) * (st.footLift + p.run * 0.16);
        footPitch = (1 - u) * -0.5 + u * 0.25;
        leg.planted = false;
      }
      z *= this.gaitAmp;
      lift *= this.gaitAmp;
      footPitch *= this.gaitAmp;
      const local = _v.set(leg.restAnkle.x * (1 - 0.15 * this.gaitAmp), leg.restAnkle.y + lift, leg.restAnkle.z + z + p.lean * 0.05);
      const target = this.object.localToWorld(local.clone());
      const pole = _v3.copy(Z).applyQuaternion(objQ).add(_v2.set(leg.side * 0.15, 0, 0).applyQuaternion(objQ));
      this.solveLeg(leg, target, pole);
      // Foot stays level with the ground (pitched for heel/toe roll).
      const shinQ = leg.shin.getWorldQuaternion(_q2);
      leg.foot.quaternion.copy(shinQ.invert()).multiply(_q.copy(objQ).multiply(new THREE.Quaternion().setFromAxisAngle(X, footPitch)));
      leg.toes.quaternion.setFromAxisAngle(X, footPitch < 0 ? footPitch * 0.9 : 0);
      leg.foot.updateMatrixWorld(true);
    }

    // ── arms on the ground (Leo) / pressed against the ceiling (Jovan) ──
    let ikW = 0;
    if (st.gait === 'knuckle') ikW = mode === 'attack' || act !== 'none' || sc >= 0 ? 0 : 1;
    if (st.gait === 'ceiling') ikW = mode === 'attack' || sc >= 0 || p.duck > 0.3 ? 0 : 1;
    this.armIK = expTo(this.armIK, ikW, dt, 6);
    if (this.armIK > 0.002) this.armsIK(stride, beta, objQ, p.run);

    // ── head: tilt, twitch, look at the target ──
    this.nextTwitch -= realDt;
    if (this.nextTwitch < 0) {
      this.nextTwitch = (mode === 'idle' ? 1.5 : 2.5) + Math.random() * 4;
      const k = mode === 'run' ? 0.4 : 1;
      this.twitch.yaw.v += (Math.random() - 0.5) * 18 * k;
      this.twitch.roll.v += (Math.random() - 0.5) * 22 * k;
      this.twitch.pitch.v += (Math.random() - 0.5) * 10 * k;
      if (Math.random() < 0.35) this.tiltTarget = (Math.random() - 0.3) * 0.7;
    }
    const tw = this.twitch;
    spring(tw.yaw, 0, realDt, 3, 0.35);
    spring(tw.roll, 0, realDt, 3, 0.35);
    spring(tw.pitch, 0, realDt, 3, 0.35);
    const tilt = spring(this.tilt, this.tiltTarget, dt, sc >= 0 ? (sc < RobinBody.SCARE_SNAP ? 1.1 : 6) : 0.6, sc >= 0 && sc < RobinBody.SCARE_SNAP ? 0.9 : 0.8);
    const shake = (scream > 0 ? scream : 0) * (sc >= 0 ? 1.8 : 1);
    const head = B('head');
    const neck2 = B('neck2');
    neck2.quaternion.setFromEuler(new THREE.Euler(-p.hunch * 0.3 - scream * (sc >= 0 ? -0.15 : 0.6), 0, 0));
    neck2.updateMatrixWorld(true);
    const fkWorld = neck2.getWorldQuaternion(new THREE.Quaternion());
    let want: THREE.Quaternion;
    if (look) {
      const hp = head.getWorldPosition(_v2);
      _m.lookAt(look, hp, Y);
      want = new THREE.Quaternion().setFromRotationMatrix(_m);
      // Clamp: no more than ~75° from the neck's forward.
      const ang = fkWorld.angleTo(want);
      if (ang > 1.3) want = fkWorld.clone().slerp(want, 1.3 / ang);
    } else want = fkWorld.clone();
    if (!this.hasLook) {
      this.headLook.copy(want);
      this.hasLook = true;
    }
    this.headLook.slerp(want, 1 - Math.exp(-realDt * (sc >= 0 ? 14 : this.frozen ? 0.8 : mode === 'idle' ? 2.5 : 5)));
    const extra = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(tw.pitch.x * 0.1 - scream * (sc >= 0 ? -0.12 : 0.55) + Math.sin(this.t * 41) * 0.06 * shake, tw.yaw.x * 0.1 + Math.sin(this.t * 37) * 0.08 * shake, tilt + tw.roll.x * 0.1 + Math.sin(this.t * 29) * 0.1 * shake),
    );
    head.quaternion.copy(fkWorld.invert()).multiply(this.headLook).multiply(extra);
    head.updateMatrixWorld(true);
    this.lastTop = this.headTop();
  }

  /**
   * Leo's performances, posed over the FK arms (weight actW):
   *   roar     — fists up in a double flex, then pounding his chest, alternating
   *   stunned  — one hand clutching his head, the other arm hanging limp
   *   slam     — (attack) both fists high overhead, then hammered down
   */
  private leoActArms(act: 'none' | 'roar' | 'stunned', slamPh: number) {
    const t = this.actT;
    for (const arm of this.arms) {
      const s = arm.side;
      let pitch: number;
      let out: number;
      let elbow: number;
      let w = this.actW;
      if (slamPh >= 0) {
        const down = THREE.MathUtils.smoothstep(slamPh, 0.45, 0.58) * (1 - THREE.MathUtils.smoothstep(slamPh, 0.75, 1));
        pitch = THREE.MathUtils.lerp(-2.9, -0.55, down);
        out = 0.25;
        elbow = THREE.MathUtils.lerp(0.9, 0.15, down);
        w = 1;
      } else if (act === 'roar') {
        const flex = 1 - THREE.MathUtils.smoothstep(t, 0.3, 0.45);
        const beat = Math.max(0, Math.sin(t * 21 + (s === 1 ? 0 : Math.PI)));
        pitch = THREE.MathUtils.lerp(-0.5 - 0.25 * beat, -0.3, flex);
        out = THREE.MathUtils.lerp(-0.2 + 0.25 * beat, 1.5, flex);
        elbow = THREE.MathUtils.lerp(2.25 + 0.2 * beat, 2.1, flex);
      } else {
        // Stunned: left hand to the head, right arm limp.
        pitch = s === 1 ? -1.35 : 0.15 + 0.1 * Math.sin(t * 2.3);
        out = s === 1 ? 0.65 : 0.3;
        elbow = s === 1 ? 2.35 : 0.12;
      }
      _q.setFromEuler(new THREE.Euler(pitch, 0, s * (out - 0.35)));
      arm.upper.quaternion.slerp(_q, w);
      _q.setFromAxisAngle(_v.set(0.5 * s, -0.866, 0).cross(Z).normalize(), elbow);
      arm.fore.quaternion.slerp(_q, w);
      // Fists placed by IK: pounding the chest (roar), clutching the head (stunned, left hand).
      const beatIK = act === 'roar' ? THREE.MathUtils.smoothstep(t, 0.3, 0.45) : act === 'stunned' && s === 1 ? 1 : 0;
      if (beatIK > 0 && slamPh < 0) {
        arm.upper.updateMatrixWorld(true);
        const objQ = this.object.getWorldQuaternion(new THREE.Quaternion());
        let target: THREE.Vector3;
        if (act === 'roar') {
          const beat = Math.max(0, Math.sin(t * 19 + (s === 1 ? 0 : Math.PI)));
          const chest = this.bones.get('chest')!.getWorldPosition(new THREE.Vector3());
          target = chest.add(_v.set(s * 0.2, 0.12, 0.95 - 0.4 * beat).applyQuaternion(objQ));
        } else {
          const head = this.head.getWorldPosition(new THREE.Vector3());
          target = head.add(_v.set(s * 0.3, 0.12, -0.05).applyQuaternion(objQ));
        }
        const fkU = arm.upper.quaternion.clone();
        const fkF = arm.fore.quaternion.clone();
        this.solveArm(arm, target, _v3.set(s, -0.7, -0.4).applyQuaternion(objQ).normalize());
        arm.upper.quaternion.copy(fkU.slerp(arm.upper.quaternion, beatIK * w));
        arm.fore.quaternion.copy(fkF.slerp(arm.fore.quaternion, beatIK * w));
      }
      arm.upper.updateMatrixWorld(true);
    }
  }

  /** Arms as legs (Leo's knuckles) or hands walking along the ceiling (Jovan), blended by armIK. */
  private armsIK(stride: number, beta: number, objQ: THREE.Quaternion, run: number) {
    const st = this.style;
    const knuckle = st.gait === 'knuckle';
    const w = this.armIK;
    for (const arm of this.arms) {
      const s = arm.side;
      // Gait phase: Leo walks like a gorilla (each hand with the opposite leg, a little later) and
      // gallops with both hands together; Jovan's hands go with the opposite leg.
      const off = knuckle ? (s === 1 ? THREE.MathUtils.lerp(0.6, 0.5, run) : THREE.MathUtils.lerp(0.1, 0.6, run)) : s === 1 ? 0.5 : 0;
      const lp = (this.phase + off) % 1;
      const half = stride * 0.5;
      let z: number;
      let lift = 0;
      if (lp < beta) {
        z = THREE.MathUtils.lerp(beta * half, -beta * half, lp / beta);
        if (!arm.planted) {
          arm.planted = true;
          if (knuckle && this.gaitAmp > 0.3) this.onStep(arm.hand.getWorldPosition(new THREE.Vector3()), 0.35 + run * 0.4);
        }
      } else {
        const u = (lp - beta) / (1 - beta);
        z = THREE.MathUtils.lerp(-beta * half, beta * half, (1 - Math.cos(u * Math.PI)) / 2);
        lift = Math.sin(u * Math.PI) * (knuckle ? 0.18 + run * 0.15 : 0.12);
        arm.planted = false;
      }
      z *= this.gaitAmp;
      lift *= this.gaitAmp;
      const sh = this.object.worldToLocal(arm.upper.getWorldPosition(_v2));
      const local = knuckle
        ? _v.set(sh.x + s * 0.12, 0.2 + lift, sh.z + 0.45 + z)
        : _v.set(sh.x + s * 0.22, this.ceiling - 0.07 - lift, sh.z + 0.3 + z * 0.8 + 0.05 * Math.sin(this.t * 0.7 + s));
      // Out of reach: pull the target in towards the shoulder.
      const reach = (arm.a + arm.b) * 0.985;
      const d = local.distanceTo(sh);
      if (d > reach) local.lerp(sh, 1 - reach / d);
      const target = this.object.localToWorld(local.clone());
      const pole = knuckle ? _v3.set(s * 0.5, -0.2, -1) : _v3.set(s * 1, -0.5, -0.2);
      pole.applyQuaternion(objQ).normalize();
      const fkU = arm.upper.quaternion.clone();
      const fkF = arm.fore.quaternion.clone();
      const fkH = arm.hand.quaternion.clone();
      this.solveArm(arm, target, pole);
      // Hand: knuckles down, palm facing back (Leo); palm flat up against the ceiling (Jovan).
      const uT = knuckle ? _v.set(0, -1, 0.12).normalize() : _v.set(s * 0.35, 0, 0.94).normalize();
      const nT = knuckle ? _v2.set(-0.35 * s, 0, -0.94) : _v2.set(0, 1, 0);
      nT.addScaledVector(uT, -nT.dot(uT)).normalize();
      const uR = new THREE.Vector3(0.5 * s, -0.866, 0);
      const nR = new THREE.Vector3(-0.866 * s, -0.5, 0);
      const mT = new THREE.Matrix4().makeBasis(uT, nT, new THREE.Vector3().crossVectors(uT, nT));
      const mR = new THREE.Matrix4().makeBasis(uR, nR, new THREE.Vector3().crossVectors(uR, nR));
      const qObj = new THREE.Quaternion().setFromRotationMatrix(mT.multiply(mR.transpose()));
      const foreW = arm.fore.getWorldQuaternion(new THREE.Quaternion());
      const ikH = foreW.invert().multiply(objQ.clone().multiply(qObj));
      arm.upper.quaternion.copy(fkU.slerp(arm.upper.quaternion, w));
      arm.fore.quaternion.copy(fkF.slerp(arm.fore.quaternion, w));
      arm.hand.quaternion.copy(fkH.slerp(ikH, w));
      arm.hand.updateMatrixWorld(true);
    }
  }

  /** Two-bone IK for an arm: upper arm / forearm so the wrist reaches `target`; elbow towards `pole`. */
  private solveArm(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3) {
    const A = arm.upper.getWorldPosition(new THREE.Vector3());
    const toT = target.clone().sub(A);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(arm.a - arm.b) + 1e-3, arm.a + arm.b - 1e-3);
    const dir = toT.normalize();
    const cosA = THREE.MathUtils.clamp((arm.a * arm.a + d * d - arm.b * arm.b) / (2 * arm.a * d), -1, 1);
    // Bend plane: contains dir and the pole.
    const axis = new THREE.Vector3().crossVectors(dir, pole).normalize();
    const elbowDir = dir.clone().applyAxisAngle(axis, Math.acos(cosA));
    const K = A.clone().addScaledVector(elbowDir, arm.a);
    const T = A.clone().addScaledVector(dir, d);
    const parentQ = arm.upper.parent!.getWorldQuaternion(new THREE.Quaternion());
    arm.upper.quaternion.setFromUnitVectors(arm.fore.position.clone().normalize(), elbowDir.applyQuaternion(parentQ.invert()));
    arm.upper.updateMatrixWorld(true);
    const upQ = arm.upper.getWorldQuaternion(new THREE.Quaternion());
    arm.fore.quaternion.setFromUnitVectors(arm.hand.position.clone().normalize(), T.sub(K).normalize().applyQuaternion(upQ.invert()));
    arm.fore.updateMatrixWorld(true);
  }

  /** Analytic two-bone IK: thigh/shin so the ankle reaches `target`; knee towards `pole`. */
  private solveLeg(leg: Leg, target: THREE.Vector3, pole: THREE.Vector3) {
    const A = leg.thigh.getWorldPosition(new THREE.Vector3());
    const toT = target.clone().sub(A);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(leg.a - leg.b) + 1e-3, leg.a + leg.b - 1e-3);
    const dir = toT.normalize();
    const cosA = THREE.MathUtils.clamp((leg.a * leg.a + d * d - leg.b * leg.b) / (2 * leg.a * d), -1, 1);
    const axis = new THREE.Vector3().crossVectors(dir, pole).normalize();
    const kneeDir = dir.clone().applyAxisAngle(axis, Math.acos(cosA));
    const K = A.clone().addScaledVector(kneeDir, leg.a);
    const T = A.clone().addScaledVector(dir, d);
    // Thigh: rest direction (towards the knee, in parent space) → desired, in parent space.
    const parentQ = leg.thigh.parent!.getWorldQuaternion(new THREE.Quaternion());
    const restThigh = leg.shin.position.clone().normalize();
    const wantThigh = kneeDir.clone().applyQuaternion(parentQ.clone().invert());
    leg.thigh.quaternion.setFromUnitVectors(restThigh, wantThigh);
    leg.thigh.updateMatrixWorld(true);
    const thighQ = leg.thigh.getWorldQuaternion(new THREE.Quaternion());
    const restShin = leg.foot.position.clone().normalize();
    const wantShin = T.sub(K).normalize().applyQuaternion(thighQ.invert());
    leg.shin.quaternion.setFromUnitVectors(restShin, wantShin);
    leg.shin.updateMatrixWorld(true);
  }

  /** Top of the head above the ground (for tuning / door checks). */
  headTop(): number {
    return this.head.getWorldPosition(_v).y - this.object.position.y + this.headTopOff;
  }

  dispose() {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}
