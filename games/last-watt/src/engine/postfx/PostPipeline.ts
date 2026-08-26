import { Color, type PerspectiveCamera, type Scene, Vector2, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { BLOOM } from '../config';
import { EmissiveMask } from './EmissiveMask';

const MASK_BACKGROUND = new Color(0x000000);

const COMPOSITE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    bloomTexture: { value: null as unknown },
    bloomMix: { value: BLOOM.mix },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTexture;
    uniform float bloomMix;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 glow = texture2D(bloomTexture, vUv);
      gl_FragColor = vec4(base.rgb + glow.rgb * bloomMix, base.a);
    }
  `,
};

/**
 * Two-composer post stack — GDD §15.1.
 *
 * Pass 1 renders an emissive-only mask of the scene and blurs it with
 * UnrealBloom. Pass 2 renders the lit beauty image and adds the blurred mask
 * on top, then tonemaps. Because the bloom input never contains lit albedo,
 * the rusted-iron ground can be as bright as it likes and still not glow.
 *
 * The vignette listed in the GDD's "post trio" is event-driven (zone loss /
 * ultimate) and belongs to the VFX layer, not to this always-on stack.
 */
export class PostPipeline {
  enabled = true;

  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;

  private readonly mask = new EmissiveMask();
  private readonly bloomComposer: EffectComposer;
  private readonly finalComposer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly compositePass: ShaderPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.bloomPass = new UnrealBloomPass(
      new Vector2(1, 1),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );

    this.bloomComposer = new EffectComposer(renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(scene, camera));
    this.bloomComposer.addPass(this.bloomPass);

    this.compositePass = new ShaderPass(COMPOSITE_SHADER, 'tDiffuse');
    this.compositePass.uniforms.bloomTexture.value = this.bloomComposer.renderTarget2.texture;

    this.finalComposer = new EffectComposer(renderer);
    this.finalComposer.addPass(new RenderPass(scene, camera));
    this.finalComposer.addPass(this.compositePass);
    this.finalComposer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(width, 1);
    const h = Math.max(height, 1);

    this.finalComposer.setPixelRatio(pixelRatio);
    this.finalComposer.setSize(w, h);

    // The bloom chain is a blur; running it at a fraction of the beauty
    // resolution is free quality-wise and buys back fill rate on 1060-class GPUs.
    this.bloomComposer.setPixelRatio(pixelRatio * BLOOM.resolutionScale);
    this.bloomComposer.setSize(w, h);

    this.compositePass.uniforms.bloomTexture.value = this.bloomComposer.renderTarget2.texture;
  }

  setBloom(params: Partial<{ strength: number; radius: number; threshold: number; mix: number }>): void {
    if (params.strength !== undefined) this.bloomPass.strength = params.strength;
    if (params.radius !== undefined) this.bloomPass.radius = params.radius;
    if (params.threshold !== undefined) this.bloomPass.threshold = params.threshold;
    if (params.mix !== undefined) this.compositePass.uniforms.bloomMix.value = params.mix;
  }

  render(): void {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const background = this.scene.background;
    const fog = this.scene.fog;
    // Fog would tint the mask towards the void colour and quietly steal energy
    // from distant emissives, so the bloom input is rendered unfogged.
    this.scene.background = MASK_BACKGROUND;
    this.scene.fog = null;
    this.mask.apply(this.scene);
    this.bloomComposer.render();
    this.mask.revert();
    this.scene.fog = fog;
    this.scene.background = background;

    this.finalComposer.render();
  }

  dispose(): void {
    this.mask.dispose();
    this.bloomPass.dispose();
    this.compositePass.dispose();
    this.bloomComposer.dispose();
    this.finalComposer.dispose();
  }
}
