/**
 * Post-processing chain (pmndrs/postprocessing + N8AO):
 * Render → N8AO (half/full res) → Bloom + DoF (opt) + SMAA/FXAA + vignette + AgX tone mapping.
 * With post disabled (Battery Saver) the renderer draws directly with built-in AgX.
 */
import * as THREE from 'three';
import {
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Quality } from './quality.ts';

export class PostFX {
  composer: EffectComposer | null = null;
  private ao: N8AOPostPass | null = null;
  private bloom: BloomEffect | null = null;
  private dof: DepthOfFieldEffect | null = null;
  enabled = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {}

  configure(q: Quality) {
    this.dispose();
    this.enabled = q.post;
    if (!q.post) {
      this.renderer.toneMapping = THREE.AgXToneMapping;
      return;
    }
    // Tone mapping moves into the effect chain (HDR buffers until the end).
    this.renderer.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao !== 'off') {
      const ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 0.8;
      ao.configuration.intensity = 2.6;
      ao.configuration.aoSamples = q.ao === 'full' ? 16 : 8;
      ao.configuration.denoiseSamples = q.ao === 'full' ? 8 : 4;
      ao.configuration.denoiseRadius = 8;
      ao.configuration.halfRes = q.ao === 'half';
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.color = new THREE.Color(0x0a0c08);
      ao.configuration.gammaCorrection = false;
      composer.addPass(ao);
      this.ao = ao;
    }
    const effects: Effect[] = [];
    if (q.bloom) {
      this.bloom = new BloomEffect({ intensity: 0.6, luminanceThreshold: 0.85, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 });
      effects.push(this.bloom);
    }
    if (q.dof) {
      this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 0.02, focalLength: 0.05, bokehScale: 2.5 });
      effects.push(this.dof);
    }
    effects.push(new VignetteEffect({ offset: 0.3, darkness: 0.55 }));
    // ToneMappingEffect reads renderer.toneMappingExposure (eye adaptation drives it).
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
    composer.addPass(new EffectPass(this.camera, ...effects));
    // Anti-aliasing last, on tone-mapped colour.
    if (q.antialias === 'smaa') composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
    else if (q.antialias === 'fxaa') composer.addPass(new EffectPass(this.camera, new FXAAEffect()));
    this.composer = composer;
    this.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
  }

  setSize(w: number, h: number) {
    // EffectComposer wants CSS size; renderer pixel ratio is applied inside.
    const pr = this.renderer.getPixelRatio();
    this.composer?.setSize(Math.round(w / pr), Math.round(h / pr), false);
  }

  render(dt: number) {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    this.bloom = null;
    this.dof = null;
  }
}
