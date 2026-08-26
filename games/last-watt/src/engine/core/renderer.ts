import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

import { DEVICE, SURFACE } from '../config';

export class WebGL2UnsupportedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'WebGL2UnsupportedError';
  }
}

export interface RendererBundle {
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
}

/**
 * Creates the WebGL2 context ourselves instead of letting three fall back.
 * The whole visual direction (emissive-driven bloom on half-float targets) is
 * WebGL2-only, so a silent WebGL1 fallback would ship a broken-looking game
 * rather than an honest error screen.
 */
export function createRenderer(container: HTMLElement): RendererBundle {
  const canvas = document.createElement('canvas');
  const contextAttributes: WebGLContextAttributes = {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false,
  };

  const gl = canvas.getContext('webgl2', contextAttributes);
  if (!gl) {
    throw new WebGL2UnsupportedError(
      'This browser or GPU did not provide a WebGL2 context. ' +
        'Last Watt requires WebGL2 (Chrome 56+, Firefox 51+, Safari 15+) with hardware acceleration enabled.',
    );
  }

  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DEVICE.maxPixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.setClearColor(SURFACE.voidColor, 1);

  renderer.outputColorSpace = SRGBColorSpace;
  // Tonemapping is applied by the post pipeline's OutputPass, but the renderer
  // flag is what the pass reads, so it has to be set here.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  container.appendChild(canvas);

  return { renderer, canvas, gl };
}

/** Human-readable GPU string for the debug overlay / bug reports. */
export function describeGpu(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = ext
    ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string | null)
    : (gl.getParameter(gl.RENDERER) as string | null);
  return raw ?? 'unknown gpu';
}
