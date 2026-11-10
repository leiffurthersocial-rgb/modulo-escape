/**
 * "The Tall One": a procedural horror creature, built and animated in code (no download).
 * Emaciated 2.4 m humanoid: hunched spine, ribs, arms to the knees, long jointed fingers,
 * elongated skull with sunken black sockets and a hinged jaw full of teeth, pale mottled skin.
 *
 * Animation is procedural per mode: a stop-start stalk with head twitches (walk), a forward-leaning
 * arms-reaching run with the jaw hanging open (run), wide-armed lunge (attack), breathing idle.
 * It reports foot plants via `onStep` so footsteps can be heard where they happen.
 */
import * as THREE from 'three';

export type CreatureMode = 'idle' | 'walk' | 'run' | 'attack';

interface Limb {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
}

const NOISE = /* glsl */ `
float cH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cN(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cH(i), cH(i + vec3(1,0,0)), f.x), mix(cH(i + vec3(0,1,0)), cH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cH(i + vec3(0,0,1)), cH(i + vec3(1,0,1)), f.x), mix(cH(i + vec3(0,1,1)), cH(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

/** Pale, mottled, slightly wet skin with darker veins and bruised extremities. */
function skinMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x5a5249, roughness: 0.42, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCP;\n${NOISE}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  float mottle = cN(vCP * 18.0) * 0.6 + cN(vCP * 55.0) * 0.4;
  float vein = smoothstep(0.47, 0.5, cN(vCP * 30.0 + 4.0)) * (1.0 - smoothstep(0.5, 0.53, cN(vCP * 30.0 + 4.0)));
  diffuseColor.rgb *= mix(0.45, 1.05, mottle);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.15, 0.18), vein * 0.8);
  // Grime and bruising: darker blotches, and darker towards the ends of the limbs.
  float grime = smoothstep(0.55, 0.8, cN(vCP * 7.0 + 2.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.1, 0.09), grime * 0.55);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= mix(0.65, 1.15, cN(vCP * 22.0));');
  };
  m.customProgramCacheKey = () => 'creature-skin';
  return m;
}

/** Tapered limb segment along -Y from its joint (length L). */
function segment(L: number, r0: number, r1: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1, r0, L, 9, 4);
  // A little knobbliness so it doesn't read as a tube.
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + 0.12 * Math.sin(y * 31 + i) * Math.sin(y * 9);
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  g.translate(0, -L / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function knob(r: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.castShadow = true;
  return m;
}

export class Creature {
  readonly object = new THREE.Group();
  readonly head = new THREE.Object3D();
  mode: CreatureMode = 'idle';
  /** Movement speed (m/s) the gait should match. */
  speed = 0;
  onStep: (foot: THREE.Vector3, loud: number) => void = () => {};
  private pelvis = new THREE.Object3D();
  private spine = new THREE.Object3D();
  private chest = new THREE.Object3D();
  private neck = new THREE.Object3D();
  private jaw = new THREE.Object3D();
  private legs: Limb[] = [];
  private arms: Limb[] = [];
  private fingers: THREE.Object3D[][] = [];
  private phase = 0;
  private t = 0;
  private twitch = new THREE.Vector3();
  private twitchVel = new THREE.Vector3();
  private nextTwitch = 1;
  private stall = 0;
  private lastStepSign = 0;
  private skin = skinMaterial();
  private dark = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.3 });
  private bone = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.45 });
  private tmp = new THREE.Vector3();

  constructor() {
    const S = this.skin;
    this.object.name = 'creature';
    this.pelvis.position.y = 1.32;
    this.object.add(this.pelvis);
    const hips = knob(0.13, S);
    hips.scale.set(1.3, 0.8, 0.9);
    this.pelvis.add(hips);

    // Spine: pelvis → abdomen → chest → neck → head.
    this.pelvis.add(this.spine);
    const abdomen = segment(0.36, 0.09, 0.11, S);
    abdomen.rotation.x = Math.PI; // grows upwards
    abdomen.position.y = 0;
    this.spine.add(abdomen);
    this.chest.position.y = 0.36;
    this.spine.add(this.chest);
    const ribcage = knob(0.18, S);
    ribcage.scale.set(1.2, 1.55, 0.9);
    ribcage.position.y = 0.2;
    this.chest.add(ribcage);
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.172 - i * 0.008, 0.012, 5, 18, Math.PI * 1.15), S);
      rib.rotation.set(Math.PI / 2 + 0.2, 0, -Math.PI * 0.075);
      rib.position.set(0, 0.06 + i * 0.065, 0.015);
      rib.scale.set(1.15, 0.85, 1);
      this.chest.add(rib);
    }
    // Hunched upper back: shoulder blades and a hump.
    const hump = knob(0.16, S);
    hump.scale.set(1.35, 0.9, 0.8);
    hump.position.set(0, 0.36, -0.09);
    this.chest.add(hump);
    for (const side of [-1, 1]) {
      const blade = knob(0.08, S);
      blade.scale.set(1, 1.3, 0.45);
      blade.position.set(side * 0.13, 0.3, -0.13);
      blade.rotation.z = side * 0.3;
      this.chest.add(blade);
    }
    // Spine knuckles down the back.
    for (let i = 0; i < 9; i++) {
      const v = knob(0.025, S);
      v.position.set(0, -0.3 + i * 0.075, -0.12 + Math.sin(i * 0.4) * 0.02);
      this.chest.add(v);
    }
    this.neck.position.y = 0.48;
    this.chest.add(this.neck);
    const neckMesh = segment(0.22, 0.05, 0.04, S);
    neckMesh.rotation.x = Math.PI;
    this.neck.add(neckMesh);

    // Head: elongated skull, sunken sockets, hinged jaw with teeth.
    this.head.name = 'head';
    this.head.position.y = 0.2;
    this.neck.add(this.head);
    const skull = knob(0.15, S);
    skull.scale.set(0.8, 1.35, 1.1);
    skull.position.set(0, 0.12, 0.01);
    this.head.add(skull);
    const brow = knob(0.1, S);
    brow.scale.set(1.05, 0.45, 0.7);
    brow.position.set(0, 0.17, 0.08);
    this.head.add(brow);
    for (const side of [-1, 1]) {
      const socket = knob(0.045, this.dark);
      socket.scale.set(1, 1.25, 0.6);
      socket.position.set(side * 0.052, 0.13, 0.122);
      this.head.add(socket);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), new THREE.MeshBasicMaterial({ color: 0xe8e2d0 }));
      glint.position.set(side * 0.052, 0.135, 0.143);
      this.head.add(glint);
    }
    const maw = knob(0.06, this.dark);
    maw.scale.set(0.9, 1.2, 0.5);
    maw.position.set(0, 0.0, 0.095);
    this.head.add(maw);
    for (let i = 0; i < 7; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.055, 5), this.bone);
      tooth.rotation.x = Math.PI;
      tooth.position.set((i - 3) * 0.017, 0.03, 0.135 - Math.abs(i - 3) * 0.007);
      this.head.add(tooth);
    }
    this.jaw.position.set(0, 0.03, 0.0);
    this.head.add(this.jaw);
    const jawMesh = knob(0.085, S);
    jawMesh.scale.set(0.9, 0.55, 1.45);
    jawMesh.position.set(0, -0.08, 0.07);
    this.jaw.add(jawMesh);
    for (let i = 0; i < 6; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.05, 5), this.bone);
      tooth.position.set((i - 2.5) * 0.016, -0.04, 0.17 - Math.abs(i - 2.5) * 0.008);
      this.jaw.add(tooth);
    }

    // Arms: shoulders wide, hands reach the knees, fingers long.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Object3D();
      shoulder.position.set(side * 0.27, 0.44, -0.04);
      this.chest.add(shoulder);
      shoulder.add(knob(0.07, S));
      shoulder.add(segment(0.6, 0.06, 0.04, S));
      const elbow = new THREE.Object3D();
      elbow.position.y = -0.58;
      shoulder.add(elbow);
      elbow.add(knob(0.05, S));
      elbow.add(segment(0.58, 0.042, 0.028, S));
      const wrist = new THREE.Object3D();
      wrist.position.y = -0.56;
      elbow.add(wrist);
      const palm = knob(0.05, S);
      palm.scale.set(0.9, 1.5, 0.45);
      palm.position.y = -0.04;
      wrist.add(palm);
      const fingers: THREE.Object3D[] = [];
      for (let f = 0; f < 4; f++) {
        const base = new THREE.Object3D();
        base.position.set((f - 1.5) * 0.026, -0.1, 0);
        base.rotation.z = (f - 1.5) * 0.08 * side;
        wrist.add(base);
        let parent: THREE.Object3D = base;
        for (let k = 0; k < 3; k++) {
          const L = [0.12, 0.1, 0.08][k]!;
          parent.add(segment(L, 0.014 - k * 0.003, 0.011 - k * 0.003, k === 2 ? this.dark : S));
          const next = new THREE.Object3D();
          next.position.y = -L;
          parent.add(next);
          parent = next;
          fingers.push(next);
        }
      }
      this.fingers.push(fingers);
      this.arms.push({ upper: shoulder, lower: elbow, end: wrist });
    }

    // Legs.
    for (const side of [-1, 1]) {
      const hip = new THREE.Object3D();
      hip.position.set(side * 0.12, -0.04, 0);
      this.pelvis.add(hip);
      hip.add(segment(0.64, 0.075, 0.05, S));
      const knee = new THREE.Object3D();
      knee.position.y = -0.64;
      hip.add(knee);
      knee.add(knob(0.055, S));
      knee.add(segment(0.6, 0.05, 0.032, S));
      const ankle = new THREE.Object3D();
      ankle.position.y = -0.6;
      knee.add(ankle);
      const foot = segment(0.24, 0.03, 0.02, S);
      foot.rotation.x = -Math.PI / 2;
      foot.position.set(0, -0.02, -0.02);
      ankle.add(foot);
      this.legs.push({ upper: hip, lower: knee, end: ankle });
    }
    this.object.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
  }

  update(dt: number) {
    this.t += dt;
    const mode = this.mode;
    const run = mode === 'run';
    // Stride frequency follows ground speed; the stalk stutters (stalls, then lurches on).
    const freq = run ? 2.7 : mode === 'walk' ? 1.25 : 0;
    if (mode === 'walk') {
      if (this.stall > 0) this.stall -= dt;
      else if (Math.random() < dt * 0.25) this.stall = 0.25 + Math.random() * 0.6;
    } else this.stall = 0;
    const stalled = this.stall > 0;
    this.phase += dt * freq * Math.PI * 2 * (stalled ? 0.08 : 1);
    const ph = this.phase;
    const amp = mode === 'idle' || mode === 'attack' ? 0 : run ? 1 : 0.75;

    // Random head twitches (impulse + spring).
    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0) {
      this.nextTwitch = (run ? 0.4 : 1.2) + Math.random() * (run ? 0.8 : 2.5);
      this.twitchVel.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 14);
    }
    this.twitchVel.addScaledVector(this.twitch, -dt * 160).multiplyScalar(Math.exp(-dt * 12));
    this.twitch.addScaledVector(this.twitchVel, dt);

    // Posture.
    const lean = mode === 'attack' ? 0.15 : run ? 0.75 : 0.38;
    const breathe = Math.sin(this.t * (run ? 7 : 1.6)) * 0.03;
    this.pelvis.position.y = 1.32 - Math.abs(Math.sin(ph)) * 0.06 * amp - (run ? 0.12 : 0.04);
    this.pelvis.rotation.set(0, Math.sin(ph) * 0.18 * amp, Math.sin(ph) * 0.06 * amp);
    // Always hunched; the neck juts forward and the head is held up, vulture-like.
    const hunch = mode === 'attack' ? 0.1 : 0.32;
    this.spine.rotation.set(lean * 0.5 + hunch * 0.5 + breathe, 0, 0);
    this.chest.rotation.set(lean * 0.6 + hunch + breathe, -Math.sin(ph) * 0.15 * amp, 0);
    this.neck.rotation.set(0.55 - lean * 0.4 + (mode === 'attack' ? -0.3 : 0), 0, 0);
    this.head.rotation.set(-0.95 - lean * 0.6 - hunch * 0.6 + this.twitch.x * 0.1 + (mode === 'attack' ? 0.4 : 0), this.twitch.y * 0.1, 0.35 * Math.sin(this.t * 0.37) + this.twitch.z * 0.1 + (run ? 0 : 0.18));
    const jawOpen = mode === 'attack' ? 0.75 + Math.sin(this.t * 40) * 0.08 : run ? 0.5 + Math.sin(this.t * 9) * 0.15 : 0.12 + Math.max(0, Math.sin(this.t * 0.9)) * 0.1;
    this.jaw.rotation.x = jawOpen;

    // Legs: thigh swing, knee bend on the back swing, foot plant.
    this.legs.forEach((leg, i) => {
      const p = ph + i * Math.PI;
      const swing = Math.sin(p) * (run ? 0.85 : 0.55) * amp;
      leg.upper.rotation.set(-swing - lean * 0.5, 0, 0);
      leg.lower.rotation.set(Math.max(0, Math.cos(p)) * (run ? 1.5 : 0.9) * amp + 0.08 + lean * 0.3, 0, 0);
      leg.end.rotation.set(-0.15 - lean * 0.2 + Math.max(0, -Math.cos(p)) * 0.3 * amp, 0, 0);
    });

    // Arms: dangling counter-swing (walk), reaching forward and clawing (run), spread wide (attack).
    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      const p = ph + i * Math.PI;
      if (mode === 'attack') {
        arm.upper.rotation.set(-1.9 + Math.sin(this.t * 30 + i) * 0.05, 0, side * -0.55);
        arm.lower.rotation.set(-0.5, 0, 0);
        arm.end.rotation.set(-0.3, 0, 0);
      } else if (run) {
        arm.upper.rotation.set(-1.25 + Math.sin(p) * 0.35, 0, side * -0.18);
        arm.lower.rotation.set(-0.35 - Math.max(0, Math.sin(p)) * 0.4, 0, 0);
        arm.end.rotation.set(-0.4, 0, 0);
      } else {
        // Elbows bent, clawed hands held a little forward.
        arm.upper.rotation.set(-0.25 + lean * 0.3 + Math.sin(p) * 0.22 * amp + breathe, 0, side * -0.14);
        arm.lower.rotation.set(-0.75 - Math.max(0, Math.sin(p + 1)) * 0.2 * amp, 0, 0);
        arm.end.rotation.set(-0.35, 0, side * 0.15);
      }
      // Fingers curl and flex independently.
      const curl = mode === 'attack' ? 0.2 : run ? 0.65 : 0.6;
      this.fingers[i]!.forEach((f, k) => (f.rotation.x = curl + Math.sin(this.t * 3 + k * 1.7 + i) * 0.12));
    });

    // Foot plants → footstep sounds where the foot lands.
    if (amp > 0 && !stalled) {
      const s = Math.sign(Math.sin(ph));
      if (s !== this.lastStepSign && s !== 0) {
        this.lastStepSign = s;
        const foot = this.legs[s > 0 ? 1 : 0]!.end;
        this.onStep(foot.getWorldPosition(this.tmp), run ? 1 : 0.55);
      }
    }
  }

  dispose() {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.skin.dispose();
    this.dark.dispose();
    this.bone.dispose();
  }
}
