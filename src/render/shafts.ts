/**
 * Cheap volumetric-looking light shafts: crossed, soft-edged additive cards running along the sun
 * direction, under ceiling holes and through sun-facing windows. Intensity follows the mood
 * (strong when sunlit, nearly gone when overcast). 'cards' = 2 planes per shaft, 'full' = 4.
 */
import * as THREE from 'three';
import { DIR, SIDES, cellIndex, getEdge } from '../gen/grid.ts';
import type { LevelData } from '../gen/types.ts';
import { surfaceUniforms } from './surface.ts';

export class LightShafts {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(level: LevelData, sunDir: THREE.Vector3, mode: 'cards' | 'full') {
    const S = level.cellSize;
    const H = level.storeyHeight;
    const down = sunDir.clone().negate(); // light travels against sunDir
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const planes = mode === 'full' ? 4 : 2;
    const addShaft = (center: THREE.Vector3, w: number, h: number, axisA: THREE.Vector3, axisB: THREE.Vector3, len: number) => {
      const dir = down.clone().normalize();
      for (let k = 0; k < planes; k++) {
        const ang = (k / planes) * Math.PI;
        const spanDir = axisA.clone().multiplyScalar(Math.cos(ang) * w).addScaledVector(axisB, Math.sin(ang) * h);
        const b = pos.length / 3;
        for (const [s, t] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]] as const) {
          const p = center.clone().addScaledVector(spanDir, s).addScaledVector(dir, t * len);
          pos.push(p.x, p.y, p.z);
          uv.push(s + 0.5, t);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    };
    l: for (let z = 0; z < level.height; z++) {
      for (let x = 0; x < level.width; x++) {
        const c = level.cells[cellIndex(level, x, z)]!;
        if (c.kind === 'void') continue;
        const cx = (x + 0.5) * S;
        const cz = (z + 0.5) * S;
        if (c.ceiling === 'hole') {
          const len = (H + 0.3) / Math.max(0.3, -down.y);
          addShaft(new THREE.Vector3(cx, H + 0.25, cz), 1.9, 1.9, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), len);
        }
        for (const s of SIDES) {
          if (getEdge(level, x, z, s) !== 'window') continue;
          const d = DIR[s];
          // Into-room normal is -d; sun must shine inward.
          const inward = new THREE.Vector3(-d.dx, 0, -d.dz);
          if (inward.dot(new THREE.Vector3(down.x, 0, down.z).normalize()) < 0.2) continue;
          const wc = new THREE.Vector3(cx + (d.dx * S) / 2, 1.7, cz + (d.dz * S) / 2);
          const along = new THREE.Vector3(Math.abs(d.dz), 0, Math.abs(d.dx));
          addShaft(wc, 2.0, 1.4, along, new THREE.Vector3(0, 1, 0), 4.5);
        }
        if (pos.length > 60000) break l;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    this.material = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 1 }, uColor: { value: new THREE.Color(0xfff0d0) }, uTime: surfaceUniforms.uTime },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uIntensity; uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        void main(){
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          float along = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          float streak = 0.65 + 0.35 * n(vec2(vUv.x * 9.0, vUv.y * 1.5 + uTime * 0.05));
          float a = edge * along * streak * uIntensity * 0.22;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'light-shafts';
  }

  setIntensity(v: number) {
    this.material.uniforms.uIntensity!.value = v;
    this.mesh.visible = v > 0.02;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Floating dust motes around the camera (wrapped in a box, so the count stays constant). */
export class Dust {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  constructor(count: number) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) pos.set([Math.random() * 14, Math.random() * 3.4, Math.random() * 14], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: surfaceUniforms.uTime, uCam: { value: new THREE.Vector3() }, uIntensity: { value: 1 }, uScale: { value: 300 } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform float uScale; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(uTime*0.13+position.y)*0.3, sin(uTime*0.07+position.x)*0.2, cos(uTime*0.11+position.z)*0.3);
          p.xz = mod(p.xz - uCam.xz + 7.0, 14.0) + uCam.xz - 7.0;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * 0.012 / -mv.z;
          vA = smoothstep(9.0, 2.0, -mv.z);
        }`,
      fragmentShader: `uniform float uIntensity; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * uIntensity * 0.5; gl_FragColor = vec4(vec3(1.0,0.95,0.85)*a, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  update(cam: THREE.Vector3, intensity: number, viewportH: number) {
    this.mat.uniforms.uCam!.value.copy(cam);
    this.mat.uniforms.uIntensity!.value = intensity;
    this.mat.uniforms.uScale!.value = viewportH;
    this.points.visible = intensity > 0.02;
  }
  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
