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

export const ROBIN_BODY_URL = '/assets/monster/robin_body.glb?v=1';

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
}

/** Load the body and build its material (null if the GLB is missing). */
export async function loadRobinBody(photo: MonsterImage | null): Promise<RobinTemplate | null> {
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(ROBIN_BODY_URL);
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
    m.material = createRobinMaterial(photo);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return { scene: gltf.scene, mesh: m };
  } catch (e) {
    console.warn('Robin body failed to load', e);
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

export function createRobinMaterial(photo: MonsterImage | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  const img = photo?.texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const W = img?.width ?? 379;
  const Hh = img?.height ?? 658;
  const P = ROBIN_PHOTO;
  const s = (2 * P.eyeHalf) / Math.hypot(P.eyeR[0] - P.eyeL[0], P.eyeR[1] - P.eyeL[1]);
  const ang = Math.atan2(P.eyeR[1] - P.eyeL[1], P.eyeR[0] - P.eyeL[0]);
  const skin = img ? sampleColor(img, 150, 380, 178, 405, 0xd9a58a) : new THREE.Color(0xd9a58a);
  const hair = img ? sampleColor(img, 150, 180, 250, 230, 0x5a3b28) : new THREE.Color(0x5a3b28);
  const uniforms = {
    uPhoto: { value: photo?.texture ?? null },
    uHasPhoto: { value: photo ? 1 : 0 },
    uPhotoSize: { value: new THREE.Vector2(W, Hh) },
    uFaceC: { value: new THREE.Vector2((P.eyeL[0] + P.eyeR[0]) / 2, (P.eyeL[1] + P.eyeR[1]) / 2) },
    uFaceY: { value: P.eyeY },
    uFaceS: { value: s },
    uFaceRot: { value: ang },
    uShirtC: { value: new THREE.Vector2(P.collar[0], P.collar[1]) },
    uShirtY: { value: P.collarY },
    uShirtS: { value: P.shirtHalfWidth / P.shirtHalfWidthPx },
    uSkin: { value: skin },
    uHair: { value: hair },
    uGlow: { value: 0.035 },
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
          vec3 sk = mix(uSkin, vec3(dot(uSkin, vec3(0.3, 0.55, 0.15))) * vec3(0.9, 0.95, 0.97), 0.55) * (0.68 + 0.4 * mott);
          float vein = pow(1.0 - abs(rNoise(p * vec3(16.0, 5.0, 16.0)) * 2.0 - 1.0), 14.0);
          sk = mix(sk, vec3(0.22, 0.24, 0.36), vein * 0.4);
          sk = mix(sk, vec3(0.32, 0.18, 0.2), smoothstep(0.58, 0.8, rFbm(p * 3.1 + 4.0)) * 0.55);
          // Grime collects low on the body and in creases.
          sk *= mix(0.65, 1.0, smoothstep(0.1, 1.2, p.y));
          // Shirt: off-white, sweat-yellowed, filthy hem, old blood.
          float dirt = rFbm(p * 5.0 + 9.0);
          vec3 sh = vec3(0.8, 0.78, 0.72) * (0.72 + 0.35 * dirt);
          sh = mix(sh, vec3(0.55, 0.46, 0.3), smoothstep(2.15, 1.95, p.y) * 0.6);
          sh = mix(sh, vec3(0.22, 0.05, 0.04), smoothstep(0.62, 0.78, rFbm(p * 4.0 + 2.0)) * 0.85);
          // Print from the photo on the chest.
          vec2 su = shirtUV(p);
          vec4 pr = texture2D(uPhoto, su);
          float prW = uHasPhoto * inside01(su) * pr.a * smoothstep(0.0, 0.06, p.z) * smoothstep(0.1, 0.5, vRestN.z);
          sh = mix(sh, pr.rgb * (0.65 + 0.35 * dirt), prW);
          // Trousers: dark, worn, torn.
          vec3 pa = vec3(0.07, 0.075, 0.09) * (0.7 + 0.6 * rFbm(p * vec3(9.0, 3.0, 9.0)));
          vec3 ha = uHair * (0.55 + 0.7 * rNoise(p * vec3(60.0, 18.0, 60.0)));
          vec3 na = vec3(0.32, 0.27, 0.17) * (0.6 + 0.5 * rNoise(p * 120.0));
          vec3 col = sk * skinM + sh * shirt + pa * pants + ha * hairM + na * nail;
          // Face: the photo, projected from the front, faded out towards the sides.
          vec2 fu = faceUV(p);
          vec4 ph = texture2D(uPhoto, fu);
          float fw = uHasPhoto * vMask2.y * inside01(fu) * smoothstep(0.6, 0.97, ph.a) * (1.0 - smoothstep(0.19, 0.21, 1.0 - fu.y - (uFaceC.y / uPhotoSize.y)));
          col = mix(col, ph.rgb, fw);
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n        totalEmissiveRadiance += gEmis;');
  };
  mat.customProgramCacheKey = () => 'robin-v1';
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

  constructor(tpl: RobinTemplate) {
    this.object.add(tpl.scene);
    tpl.scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    tpl.scene.updateMatrixWorld(true);
    const B = (n: string) => this.bones.get(n)!;
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
  static readonly SCARE_HIT = 0.42;

  /** `look`: world position to look at (the player's eye). */
  update(dt: number, look: THREE.Vector3 | null) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const B = (n: string) => this.bones.get(n)!;
    const sc = this.scareT;
    const hit = RobinBody.SCARE_HIT;
    if (sc >= 0) this.mode = sc < hit ? 'idle' : 'attack';
    const mode = this.mode;
    if (mode === 'attack') this.attackT = sc >= 0 ? sc - hit : this.attackT + dt;
    else this.attackT = 0;
    if (sc >= hit && sc - dt < hit) this.screamT = 0;
    if (sc >= 0 && sc < hit) {
      this.tiltTarget = sc < 0.3 ? 0.7 : -0.05;
      if (sc >= 0.3 && sc - dt < 0.3) this.twitch.roll.v -= 25;
    }
    if (this.screamT >= 0) {
      this.screamT += dt;
      if (this.screamT > 1.6) this.screamT = -1;
    }
    const scream = this.screamT >= 0 ? Math.sin(Math.min(1, this.screamT / 1.6) * Math.PI) : 0;

    // ── posture targets ──
    const p = this.post;
    const run = mode === 'run' ? 1 : 0;
    const tgt = {
      hunch: mode === 'attack' ? 0.05 : mode === 'run' ? 0.35 : mode === 'walk' ? 0.55 : 0.45,
      lean: run * 0.55,
      crouch: mode === 'attack' ? 0.02 : mode === 'run' ? 0.16 : mode === 'walk' ? 0.08 : 0.05,
      reach: mode === 'run' ? 1 : mode === 'attack' ? 1 : 0,
      spread: mode === 'attack' ? 1 : scream * 0.6,
    };
    let rateK = 1;
    if (sc >= 0) {
      rateK = 6;
      if (sc < hit) Object.assign(tgt, { hunch: 0.85, lean: 0, crouch: 0.28, reach: 0, spread: 0 });
      else Object.assign(tgt, { hunch: 0.55, lean: 0.35, crouch: 0.1, reach: 1, spread: 1 });
    }
    p.duck = expTo(p.duck, this.duck, dt, 4 * rateK);
    p.hunch = expTo(p.hunch, tgt.hunch + p.duck * 0.62, dt, 3 * rateK);
    p.lean = expTo(p.lean, tgt.lean, dt, 3 * rateK);
    p.crouch = expTo(p.crouch, tgt.crouch + p.duck * 0.38, dt, 3 * rateK);
    p.reach = expTo(p.reach, tgt.reach, dt, 4 * rateK);
    p.spread = expTo(p.spread, tgt.spread, dt, 5 * rateK);
    p.run = expTo(p.run, run, dt, 4);

    // ── gait ──
    const stride = THREE.MathUtils.lerp(1.55, 2.5, p.run); // metres per full cycle
    const moving = this.speed > 0.05 && mode !== 'attack';
    this.gaitAmp = expTo(this.gaitAmp, moving ? 1 : 0, dt, 5);
    if (moving) this.phase = (this.phase + (dt * this.speed) / stride) % 1;
    const beta = THREE.MathUtils.lerp(0.62, 0.4, p.run); // stance fraction

    for (const b of this.bones.values()) b.quaternion.identity();
    // Hips: drop, bob, sway.
    const hips = B('hips');
    const ph2 = this.phase * Math.PI * 4;
    const bob = this.gaitAmp * (-0.03 - 0.03 * p.run) * Math.cos(ph2);
    hips.position.set(this.gaitAmp * 0.025 * Math.sin(this.phase * Math.PI * 2) * (1 - p.run), 1.55 - p.crouch * 0.6 + bob + Math.sin(this.t * 1.3) * 0.006, -p.lean * 0.05);
    hips.quaternion.setFromEuler(new THREE.Euler(p.lean * 0.35, this.gaitAmp * 0.1 * Math.sin(this.phase * Math.PI * 2), this.gaitAmp * 0.05 * Math.cos(this.phase * Math.PI * 2)));

    // Spine: hunch spread over the vertebrae, counter-rotation against the hips, breathing.
    const breath = Math.sin(this.t * (1.1 + p.run * 1.5)) * (0.025 + p.run * 0.03) + scream * 0.12;
    const hunch = p.hunch * 0.9 + p.lean * 0.45;
    const counter = -this.gaitAmp * 0.12 * Math.sin(this.phase * Math.PI * 2);
    B('spine1').quaternion.setFromEuler(new THREE.Euler(hunch * 0.22, counter * 0.4, 0));
    B('spine2').quaternion.setFromEuler(new THREE.Euler(hunch * 0.33 - breath * 0.4, counter * 0.4, 0));
    B('chest').quaternion.setFromEuler(new THREE.Euler(hunch * 0.45 - breath - scream * 0.25, counter * 0.4, Math.sin(this.t * 0.37) * 0.04));
    B('neck1').quaternion.setFromEuler(new THREE.Euler(p.hunch * 0.25, 0, 0));

    // ── arms ──
    const spineFwd = hunch + p.lean * 0.35 - scream * 0.25;
    for (const arm of this.arms) {
      const s = arm.side;
      const legPh = this.phase + (s === 1 ? 0.5 : 0);
      const swingT = this.gaitAmp * (1 - p.reach) * 0.38 * Math.sin(legPh * Math.PI * 2);
      // Hang with gravity (undo the hunch), swing, reach forward when running/attacking.
      const atk = this.attackT;
      const grab = mode === 'attack' ? THREE.MathUtils.smoothstep(atk, 0.25, 0.55) : 0;
      const reachPitch = -1.25 * p.reach * (1 - p.spread * 0.2) + p.run * 0.25 * Math.sin(legPh * Math.PI * 2);
      const pitch = spring(arm.swing, -spineFwd * 0.92 + swingT + reachPitch - grab * 0.25, dt, 1.4 * (sc >= 0 ? 3 : 1), 0.55);
      const outT = 0.12 + p.spread * (1.0 - grab * 0.9) - this.gaitAmp * 0.08;
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
        const curl = 0.25 + tw - splay * 0.35 + grab * 1.0;
        const spreadA = (fi - 2) * 0.09 * splay * s;
        f.bones.forEach((b, j) => {
          b.quaternion.setFromAxisAngle(f.axis, curl * (j === 0 ? 0.6 : 1) * (f.thumb ? 0.5 : 1));
          if (j === 0) b.quaternion.premultiply(_q.setFromAxisAngle(f.spread, spreadA));
        });
      });
    }

    this.object.updateMatrixWorld(true);
    // ── legs (IK) ──
    const objQ = this.object.getWorldQuaternion(new THREE.Quaternion());
    for (const leg of this.legs) {
      const lp = (this.phase + leg.phaseOffset) % 1;
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
        lift = Math.sin(u * Math.PI) * (0.14 + p.run * 0.16);
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

    // ── head: tilt, twitch, look at the target ──
    this.nextTwitch -= dt;
    if (this.nextTwitch < 0) {
      this.nextTwitch = (mode === 'idle' ? 1.5 : 2.5) + Math.random() * 4;
      const k = mode === 'run' ? 0.4 : 1;
      this.twitch.yaw.v += (Math.random() - 0.5) * 18 * k;
      this.twitch.roll.v += (Math.random() - 0.5) * 22 * k;
      this.twitch.pitch.v += (Math.random() - 0.5) * 10 * k;
      if (Math.random() < 0.35) this.tiltTarget = (Math.random() - 0.3) * 0.7;
    }
    const tw = this.twitch;
    spring(tw.yaw, 0, dt, 3, 0.35);
    spring(tw.roll, 0, dt, 3, 0.35);
    spring(tw.pitch, 0, dt, 3, 0.35);
    const tilt = spring(this.tilt, this.tiltTarget, dt, sc >= 0 ? 4 : 0.6, 0.8);
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
    this.headLook.slerp(want, 1 - Math.exp(-dt * (sc >= 0 ? 14 : mode === 'idle' ? 2.5 : 5)));
    const extra = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(tw.pitch.x * 0.1 - scream * (sc >= 0 ? -0.12 : 0.55) + Math.sin(this.t * 41) * 0.06 * shake, tw.yaw.x * 0.1 + Math.sin(this.t * 37) * 0.08 * shake, tilt + tw.roll.x * 0.1 + Math.sin(this.t * 29) * 0.1 * shake),
    );
    head.quaternion.copy(fkWorld.invert()).multiply(this.headLook).multiply(extra);
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
    return this.head.getWorldPosition(_v).y - this.object.position.y + 0.36;
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
