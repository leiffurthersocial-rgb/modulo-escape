import * as THREE from 'three';
import type { MatKey } from '../kit/greybox.ts';
import type { PropType } from '../gen/types.ts';

/** Flat-shaded, colour-coded placeholder materials (Phase 1). Shared by all chunks. */
const KIT_COLORS: Record<MatKey, number> = {
  floor: 0x5d5f58,
  floor_cracked: 0x4f514b,
  puddle: 0x26333a,
  ceiling: 0x6b6d68,
  wall: 0x8c8b84,
  wall_trim: 0x55564f,
  window_frame: 0x3d6f8f,
  door_frame: 0xb07a3a,
  exit_frame: 0xb8322a,
  pillar: 0xa29f95,
  broken: 0x6e6457,
};

const PROP_COLORS: Record<PropType, number> = {
  rubble: 0x7a7266,
  debris: 0x6a5d4c,
  barrel: 0x9c4a22,
  collapsed_slab: 0x8a8880,
  vegetation: 0x3f7a2f,
  chair: 0x3c6e9e,
  desk: 0x8a6a45,
  pipe: 0x5e6266,
};

export class GreyboxMaterials {
  readonly kit = new Map<MatKey, THREE.Material>();
  readonly props = new Map<PropType, THREE.Material>();
  readonly gate: THREE.MeshStandardMaterial;
  /** One vertex-coloured material for all opaque greybox kit parts (1 draw call per chunk). */
  readonly opaque: THREE.MeshStandardMaterial;
  /** Linear-space colour per kit material key. */
  readonly kitColor = new Map<MatKey, [number, number, number]>();

  constructor() {
    for (const [k, c] of Object.entries(KIT_COLORS) as [MatKey, number][]) {
      const m = new THREE.MeshStandardMaterial({
        color: c,
        roughness: k === 'puddle' ? 0.08 : 0.92,
        metalness: 0,
        flatShading: true,
      });
      if (k === 'puddle') {
        m.transparent = true;
        m.opacity = 0.85;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -1;
      }
      this.kit.set(k, m);
    }
    for (const [k, c] of Object.entries(KIT_COLORS) as [MatKey, number][]) {
      const col = new THREE.Color(c);
      this.kitColor.set(k, [col.r, col.g, col.b]);
    }
    this.opaque = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
    for (const [k, c] of Object.entries(PROP_COLORS) as [PropType, number][]) {
      this.props.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }));
    }
    this.gate = new THREE.MeshStandardMaterial({ color: 0x8e2a22, roughness: 0.55, metalness: 0.6, flatShading: true, emissive: 0x220000 });
  }

  dispose() {
    for (const m of this.kit.values()) m.dispose();
    for (const m of this.props.values()) m.dispose();
    this.gate.dispose();
    this.opaque.dispose();
  }
}
