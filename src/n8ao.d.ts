declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type * as THREE from 'three';
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      color: THREE.Color;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      transparencyAware: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
