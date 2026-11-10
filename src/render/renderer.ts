import * as THREE from 'three';

export interface RenderOptions {
  pixelRatioCap: number;
  /** 0 = uncapped. */
  fpsCap: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
}

export const DEFAULT_RENDER: RenderOptions = { pixelRatioCap: 1.5, fpsCap: 0, shadows: true, shadowMapSize: 1024, antialias: true };

export function createRenderer(canvasParent: HTMLElement, opts: RenderOptions): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: opts.antialias,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatioCap));
  renderer.info.autoReset = false;
  renderer.domElement.id = 'game-canvas';
  canvasParent.appendChild(renderer.domElement);
  return renderer;
}

/** Keeps renderer and camera sized to the canvas' parent. */
export function bindResize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, el: HTMLElement, onResize?: (w: number, h: number) => void): () => void {
  const apply = () => {
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    onResize?.(renderer.domElement.width, renderer.domElement.height);
  };
  apply();
  const ro = new ResizeObserver(apply);
  ro.observe(el);
  window.addEventListener('orientationchange', apply);
  return () => {
    ro.disconnect();
    window.removeEventListener('orientationchange', apply);
  };
}
