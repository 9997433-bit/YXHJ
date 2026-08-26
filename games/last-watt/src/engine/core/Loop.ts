import { SIM } from '../config';
import { Signal } from './Signal';

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
 */
export class Loop {
  readonly onFixedUpdate = new Signal<FixedUpdateEvent>();
  readonly onRender = new Signal<RenderEvent>();

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

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    // Clamp: a backgrounded tab or a stalled main thread must not fast-forward
    // the simulation by seconds' worth of ticks the moment it comes back.
    const delta = Math.min((now - this.lastTime) / 1000, SIM.fixedDelta * SIM.maxSubSteps);
    this.lastTime = now;
    this.frameDelta = delta;
    this.wallElapsed += delta;
    this.accumulator += delta;

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

    this.onRender.emit({
      delta,
      elapsed: this.wallElapsed,
      alpha: this.accumulator / SIM.fixedDelta,
    });
  };

  dispose(): void {
    this.stop();
    this.onFixedUpdate.clear();
    this.onRender.clear();
  }
}
