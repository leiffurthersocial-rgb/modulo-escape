/**
 * Blood when you shoot a monster: a spray out of the wound (dark droplets flying with the bullet,
 * falling under gravity, splatting where they land), and a pool spreading out under it that stays.
 * Cheap: one Points cloud for all droplets (CPU-moved, ≤ 240), small flat splat meshes on a shared
 * canvas texture, the oldest pools recycled.
 */
import * as THREE from 'three';

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  floorY: number;
}
interface Pool {
  mesh: THREE.Mesh;
  grow: number;
  size: number;
  t: number;
  delay: number;
}

const MAX_DROPS = 240;
/** Big pools (under shot monsters) and small droplet splats are capped separately. */
const MAX_POOLS = 12;
const MAX_SPLATS = 60;

export class Blood {
  readonly group = new THREE.Group();
  private drops: Drop[] = [];
  private points: THREE.Points;
  private pos = new Float32Array(MAX_DROPS * 3);
  private pools: Pool[] = [];
  private poolMat: THREE.MeshPhongMaterial;
  private geo = new THREE.PlaneGeometry(1, 1);

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8a0a06, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
    // Wet, dark, glossy: it catches your flashlight.
    this.poolMat = new THREE.MeshPhongMaterial({
      map: splatTexture(),
      color: 0x3a0303,
      // A wet sheen, but a red one (a white highlight at grazing angles read as pale milk).
      specular: 0x3a0808,
      shininess: 70,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /**
   * A hit at `point` (the wound), the bullet going along `dir`; `floorY` is the floor under it.
   * Spray, then a pool under the monster a moment later.
   */
  hit(point: THREE.Vector3, dir: THREE.Vector3, floorY: number, under: THREE.Vector3) {
    const d = dir.clone().normalize();
    const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i < 140 && this.drops.length < MAX_DROPS; i++) {
      // Mostly out of the back of the wound (with the bullet), some back towards you.
      const back = Math.random() < 0.25 ? -0.6 : 1;
      const v = d.clone().multiplyScalar(back * (1.5 + Math.random() * 3.5));
      v.addScaledVector(side, (Math.random() - 0.5) * 2.4);
      v.y += 0.4 + Math.random() * 1.8;
      this.drops.push({ p: point.clone(), v, life: 1.6, floorY });
    }
    // Spatter right at the feet, then the pool spreads.
    this.splat(under.clone().setY(floorY), 0.35 + Math.random() * 0.15, 0, 0.6);
    this.splat(under.clone().setY(floorY), 0.9 + Math.random() * 0.4, 0.5, 3.5);
  }

  private splats: Pool[] = [];

  private splat(at: THREE.Vector3, size: number, delay: number, grow: number) {
    // Small splats and big pools recycle separately (droplets never eat the pool).
    const list = size < 0.3 ? this.splats : this.pools;
    const cap = size < 0.3 ? MAX_SPLATS : MAX_POOLS;
    let pool = list.length >= cap ? list.shift()! : null;
    if (!pool) {
      const mesh = new THREE.Mesh(this.geo, this.poolMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      pool = { mesh, grow, size, t: 0, delay };
    }
    Object.assign(pool, { grow, size, t: 0, delay });
    pool.mesh.position.set(at.x, at.y + 0.006 + Math.random() * 0.002, at.z);
    pool.mesh.rotation.z = Math.random() * Math.PI * 2;
    pool.mesh.scale.setScalar(0.001);
    list.push(pool);
  }

  update(dt: number) {
    // Droplets: fly, fall, splat on the floor.
    let n = 0;
    this.drops = this.drops.filter((d) => {
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y <= d.floorY + 0.01) {
        if (Math.random() < 0.35) this.splat(d.p.clone().setY(d.floorY), 0.05 + Math.random() * 0.12, 0, 0.15);
        return false;
      }
      return d.life > 0;
    });
    for (const d of this.drops) this.pos.set([d.p.x, d.p.y, d.p.z], n++ * 3);
    this.points.geometry.setDrawRange(0, n);
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // Pools spread (fast at first, then creeping).
    for (const p of [...this.pools, ...this.splats]) {
      p.t += dt;
      const k = p.t < p.delay ? 0 : 1 - Math.exp(-((p.t - p.delay) / p.grow) * 3);
      p.mesh.scale.setScalar(Math.max(0.001, p.size * k));
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}

/** An irregular blood splat: a dark blob with lobes, thin splash spikes and droplets around it. */
let splatTex: THREE.Texture | null = null;
function splatTexture(): THREE.Texture {
  if (splatTex) return splatTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  g.fillStyle = 'rgba(255,255,255,1)';
  // Lobed main blob.
  g.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = S * 0.3 * (1 + 0.18 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 7) + 0.06 * Math.sin(a * 13 + 2));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.fill();
  // Splash spikes and droplets.
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = S * 0.26;
    const r1 = S * (0.34 + Math.random() * 0.12);
    g.lineWidth = 2 + Math.random() * 5;
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.stroke();
    g.beginPath();
    g.arc(Math.cos(a) * (r1 + 6), Math.sin(a) * (r1 + 6), 2 + Math.random() * 5, 0, Math.PI * 2);
    g.fill();
  }
  // Darker, thicker centre (more opaque), thin edges.
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.42);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = grad;
  g.fillRect(-S / 2, -S / 2, S, S);
  splatTex = new THREE.CanvasTexture(c);
  splatTex.colorSpace = THREE.SRGBColorSpace;
  return splatTex;
}
