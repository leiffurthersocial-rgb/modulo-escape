/**
 * Phase 1 environment: sky colour, exponential fog, hemisphere fill, one sun with a
 * shadow map that follows the player, and the overgrown ground around the building.
 */
import * as THREE from 'three';
import type { LevelData } from '../gen/types.ts';

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  private sunOffset = new THREE.Vector3(-18, 30, 12);
  private shadowExtent = 22;

  constructor(scene: THREE.Scene, level: LevelData, shadowMapSize: number) {
    const sky = new THREE.Color(0xb9c8c2);
    scene.background = sky;
    this.fog = new THREE.FogExp2(0xa9b6ad, 0.028);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xdfeee9, 0x5a5f4a, 1.25);
    this.group.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 3.2);
    this.sun.castShadow = shadowMapSize > 0;
    this.sun.shadow.mapSize.set(Math.max(shadowMapSize, 256), Math.max(shadowMapSize, 256));
    const c = this.sun.shadow.camera;
    c.left = -this.shadowExtent;
    c.right = this.shadowExtent;
    c.top = this.shadowExtent;
    c.bottom = -this.shadowExtent;
    c.near = 1;
    c.far = 90;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.group.add(this.sun, this.sun.target);

    // Overgrown ground outside the building footprint.
    const w = level.width * level.cellSize;
    const d = level.height * level.cellSize;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 300, d + 300),
      new THREE.MeshStandardMaterial({ color: 0x46612f, roughness: 1, flatShading: true }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(w / 2, -0.26, d / 2);
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.group.add(ground);
    scene.add(this.group);
  }

  /** Keep the shadow frustum centred on the player, snapped to texels to avoid shimmering. */
  follow(p: THREE.Vector3) {
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const x = Math.round(p.x / texel) * texel;
    const z = Math.round(p.z / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
    this.sun.target.updateMatrixWorld();
  }

  setShadowMapSize(size: number) {
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }
}
