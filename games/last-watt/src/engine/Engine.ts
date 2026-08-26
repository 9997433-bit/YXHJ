import { Color, FogExp2, MathUtils, Scene, Vector2, type WebGLRenderer } from 'three';

import { CAMERA, GRID, SURFACE } from './config';
import { CameraRig } from './core/CameraRig';
import { Loop, type FixedUpdateEvent, type FrameBeginEvent, type RenderEvent } from './core/Loop';
import { createRenderer, describeGpu } from './core/renderer';
import { Signal } from './core/Signal';
import { GridView } from './grid/GridView';
import { PostPipeline } from './postfx/PostPipeline';
import { EmissiveTestbed } from './scene/EmissiveTestbed';
import { Lighting } from './scene/Lighting';

export interface EngineStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  programs: number;
}

const DRAWING_BUFFER = new Vector2();

export interface ViewportEvent {
  width: number;
  height: number;
  pixelRatio: number;
  /** Height of the drawing buffer in device pixels, what point sprites size against. */
  drawingBufferHeight: number;
  /** Vertical field of view in radians. */
  verticalFov: number;
}

/**
 * Runtime host for Last Watt.
 *
 * Owns the WebGL2 device, the locked camera rig, the board presentation, the
 * lighting rig and the post stack. Gameplay, combat, VFX and UI layers attach
 * to `scene` and to the loop signals; they never touch the renderer directly.
 */
export class Engine {
  readonly scene = new Scene();
  readonly cameraRig = new CameraRig();
  readonly lighting = new Lighting();
  readonly gridView = new GridView();
  readonly loop = new Loop();

  /** Layer roots so downstream modules can add content without fighting over z-order. */
  readonly worldRoot = this.scene;

  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly post: PostPipeline;
  readonly gpu: string;

  /** Fired when the WebGL context is lost or restored. */
  readonly onContextChange = new Signal<'lost' | 'restored'>();

  /** Fired after every resize, including the one during construction. */
  readonly onViewportChange = new Signal<ViewportEvent>();

  testbed: EmissiveTestbed | null;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly statsWindow: number[] = [];
  private disposed = false;

  constructor(container: HTMLElement, options: { testbed?: boolean } = {}) {
    this.container = container;

    const bundle = createRenderer(container);
    this.renderer = bundle.renderer;
    this.canvas = bundle.canvas;
    this.gpu = describeGpu(bundle.gl);

    this.scene.name = 'LastWattScene';
    this.scene.background = new Color(SURFACE.voidColor);
    this.scene.fog = new FogExp2(SURFACE.voidColor, 0.014);

    this.scene.add(this.lighting.root, this.gridView.root);

    this.testbed = options.testbed === false ? null : new EmissiveTestbed();
    if (this.testbed) this.scene.add(this.testbed.root);

    this.post = new PostPipeline(this.renderer, this.scene, this.cameraRig.camera);

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    // The draw is the last thing in the frame: presentation systems get all of
    // `onRender` to write their state before anything reaches the GPU.
    this.loop.onPresent.add(this.renderFrame);
  }

  get camera() {
    return this.cameraRig.camera;
  }

  /**
   * Simulation speed. The VFX layer drives this from `ImpactDirector`
   * (`vfx.beginFrame().timeScale`) so a shatter hit-stop freezes the sim
   * without freezing the frame rate.
   */
  get timeScale(): number {
    return this.loop.timeScale;
  }

  set timeScale(value: number) {
    this.loop.timeScale = Math.max(value, 0);
  }

  /**
   * Subscribe to the start of a frame, before the fixed steps run. This is the
   * only place where `timeScale` can still change the current frame.
   */
  onFrameBegin(listener: (event: FrameBeginEvent) => void): () => void {
    return this.loop.onFrameBegin.add(listener);
  }

  /** Subscribe gameplay logic to the fixed 60 Hz tick. */
  onFixedUpdate(listener: (event: FixedUpdateEvent) => void): () => void {
    return this.loop.onFixedUpdate.add(listener);
  }

  /** Subscribe presentation-only work; runs once per animation frame, before the draw. */
  onRender(listener: (event: RenderEvent) => void): () => void {
    return this.loop.onRender.add(listener);
  }

  /** Subscribe after the draw — where per-frame render counters are final. */
  onPresent(listener: (event: RenderEvent) => void): () => void {
    return this.loop.onPresent.add(listener);
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const pixelRatio = this.renderer.getPixelRatio();

    this.renderer.setSize(width, height, false);
    this.cameraRig.setViewport(width, height);
    this.post.setSize(width, height, pixelRatio);

    this.onViewportChange.emit({
      width,
      height,
      pixelRatio,
      drawingBufferHeight: this.renderer.getDrawingBufferSize(DRAWING_BUFFER).y,
      verticalFov: MathUtils.degToRad(this.camera.fov),
    });
  }

  stats(): EngineStats {
    const info = this.renderer.info;
    const fps =
      this.statsWindow.length > 0
        ? this.statsWindow.length / this.statsWindow.reduce((sum, value) => sum + value, 0)
        : 0;
    return {
      fps,
      frameMs: this.loop.frameDelta * 1000,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
    };
  }

  /** Human-readable summary of the locked visual contract, for the debug HUD. */
  describe(): string {
    return [
      `grid ${GRID.cols}x${GRID.rows}`,
      `fov ${CAMERA.fov}\u00b0`,
      `pitch ${CAMERA.pitchDeg}\u00b0`,
      `zoom ${this.cameraRig.zoomStep + 1}/${CAMERA.zoomSteps.length}`,
    ].join('  ·  ');
  }

  private readonly renderFrame = (event: RenderEvent): void => {
    if (this.disposed) return;

    this.renderer.info.reset();
    this.testbed?.update(event.elapsed);
    this.post.render();

    this.statsWindow.push(Math.max(event.delta, 1e-4));
    if (this.statsWindow.length > 60) this.statsWindow.shift();
  };

  private readonly handleContextLost = (event: Event): void => {
    // Without preventDefault the browser will never fire a restore event.
    event.preventDefault();
    this.loop.stop();
    this.onContextChange.emit('lost');
  };

  private readonly handleContextRestored = (): void => {
    this.resize();
    this.loop.start();
    this.onContextChange.emit('restored');
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.loop.dispose();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.post.dispose();
    this.testbed?.dispose();
    this.gridView.dispose();
    this.lighting.dispose();
    this.onContextChange.clear();
    this.onViewportChange.clear();

    this.renderer.dispose();
    this.canvas.remove();
  }
}
