import { SIM } from '../config';
import { Signal } from './Signal';

export interface FrameBeginEvent {
  /** Wall-clock seconds since the previous frame, clamped, unscaled. */
  readonly realDelta: number;
  /** Wall-clock seconds since the loop started. */
  readonly elapsed: number;
}

export interface FixedUpdateEvent {
  /** Always SIM.fixedDelta seconds. */
  readonly delta: number;
  /** Simulated seconds since the loop started. */
  readonly elapsed: number;
  /** Monotonically increasing tick index. */
  readonly tick: number;
}

export interface RenderEvent {
  /** Wall-clock seconds since the previous frame, clamped. */
  readonly delta: number;
  /** `delta * timeScale`: what the simulation actually consumed this frame. */
  readonly scaledDelta: number;
  /** The time scale in force this frame; 0 during a hit-stop. */
  readonly timeScale: number;
  /** Wall-clock seconds since the loop started. */
  readonly elapsed: number;
  /** 0..1 progress into the next fixed step, for interpolated presentation. */
  readonly alpha: number;
}

/**
 * Fixed-timestep simulation with a decoupled render callback.
 *
 * Gameplay must subscribe to `onFixedUpdate` so behaviour is identical at 30,
 * 60 and 144 fps; presentation-only work (tween, particle sway, camera easing)
 * belongs in `onRender`, which can interpolate using `alpha`.
 *
 * Frame protocol, in order:
 *
 * ```
 * onFrameBegin  real dt — the one chance to set `timeScale` for this frame
 * onFixedUpdate × n     — driven by dt * timeScale, so timeScale 0 freezes the sim
 * onRender              — presentation update (VFX advances its clocks here)
 * onPresent             — the engine draws
 * ```
 *
 * `onRender` and `onPresent` are separate signals on purpose: the draw has to
 * happen after every presentation system has written its state, and ordering by
 * "who subscribed first" is not a contract anyone can rely on.
 */
export class Loop {
  readonly onFrameBegin = new Signal<FrameBeginEvent>();
  readonly onFixedUpdate = new Signal<FixedUpdateEvent>();
  readonly onRender = new Signal<RenderEvent>();
  readonly onPresent = new Signal<RenderEvent>();

  /**
   * Simulation speed for the current frame. 0 is a hit-stop: the accumulator
   * stops filling, so no fixed step runs, while rendering keeps going at full
   * frame rate. Set it from `onFrameBegin` — it is sampled right after that
   * signal and never persisted across frames by the loop itself.
   */
  timeScale = 1;

  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  private simElapsed = 0;
  private wallElapsed = 0;
  private tick = 0;

  /** Wall-clock seconds of the last frame; useful for a HUD readout. */
  frameDelta = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Simulated seconds consumed so far; advances slower than wall clock during hit-stops. */
  get elapsed(): number {
    return this.simElapsed;
  }

  /**
   * Runs one frame with an explicit delta instead of waiting for the browser.
   * Headless harnesses (self-checks, bench, deterministic replays) drive the
   * real loop through this rather than reimplementing the protocol.
   */
  step(realDelta: number): void {
    this.advance(Math.max(realDelta, 0));
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    // Clamp: a backgrounded tab or a stalled main thread must not fast-forward
    // the simulation by seconds' worth of ticks the moment it comes back.
    const delta = Math.min((now - this.lastTime) / 1000, SIM.fixedDelta * SIM.maxSubSteps);
    this.lastTime = now;
    this.advance(delta);
  };

  private advance(delta: number): void {
    this.frameDelta = delta;
    this.wallElapsed += delta;

    this.onFrameBegin.emit({ realDelta: delta, elapsed: this.wallElapsed });

    const timeScale = Math.max(this.timeScale, 0);
    const scaledDelta = delta * timeScale;
    this.accumulator += scaledDelta;

    let steps = 0;
    while (this.accumulator >= SIM.fixedDelta && steps < SIM.maxSubSteps) {
      this.accumulator -= SIM.fixedDelta;
      this.simElapsed += SIM.fixedDelta;
      this.tick += 1;
      steps += 1;
      this.onFixedUpdate.emit({
        delta: SIM.fixedDelta,
        elapsed: this.simElapsed,
        tick: this.tick,
      });
    }

    const event: RenderEvent = {
      delta,
      scaledDelta,
      timeScale,
      elapsed: this.wallElapsed,
      alpha: this.accumulator / SIM.fixedDelta,
    };
    this.onRender.emit(event);
    this.onPresent.emit(event);
  }

  dispose(): void {
    this.stop();
    this.onFrameBegin.clear();
    this.onFixedUpdate.clear();
    this.onRender.clear();
    this.onPresent.clear();
  }
}
