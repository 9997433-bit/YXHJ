/**
 * Wave runtime (GDD §12): 20 waves, manual start, unlimited pause between
 * waves, +10% gold for starting early.
 *
 * The runner owns wave *state* and spawn *timing* only. It never creates
 * enemies — it emits `SpawnRequest`s and lets combat build them, and it needs
 * to be told when the field is clear because it does not track live entities.
 */

import type { CellCoord, Seconds } from '../types';
import type { GameplayEvents, SpawnRequest } from '../events';
import type { ResolvedWave, WavePlan, WavePreviewEntry } from './waveGenerator';

export type WavePhase =
  /** Between waves: the player builds, sells, digs. Nothing spawns. */
  | 'preparing'
  /** Spawns are being emitted on schedule. */
  | 'spawning'
  /** Everything has spawned; waiting for the field to be cleared. */
  | 'clearing'
  /** All waves survived. */
  | 'complete';

export interface WaveRunnerOptions {
  plan: WavePlan;
  events?: GameplayEvents;
  /** Resolves a gate id to the cell enemies appear on. */
  gateCell?: (gateId: string) => CellCoord | null;
}

export interface WaveClearResult {
  wave: number;
  reward: number;
  earlyBonus: number;
  total: number;
}

export class WaveRunner {
  readonly plan: WavePlan;

  private readonly events: GameplayEvents | undefined;
  private readonly gateCell: ((gateId: string) => CellCoord | null) | undefined;

  private index = -1;
  private elapsed = 0;
  private cursor = 0;
  private phase: WavePhase = 'preparing';
  private startedEarly = false;

  constructor(options: WaveRunnerOptions) {
    this.plan = options.plan;
    this.events = options.events;
    this.gateCell = options.gateCell;
  }

  get state(): WavePhase {
    return this.phase;
  }

  /** 1-based wave number; 0 before the first wave starts. */
  get waveNumber(): number {
    return this.index < 0 ? 0 : (this.plan[this.index] as ResolvedWave).wave;
  }

  get totalWaves(): number {
    return this.plan.length;
  }

  get currentWave(): ResolvedWave | null {
    return this.index < 0 ? null : (this.plan[this.index] as ResolvedWave);
  }

  /** The wave the HUD previews while the player is preparing (GDD §14.1). */
  get nextWave(): ResolvedWave | null {
    const nextIndex = this.index + 1;
    return nextIndex < this.plan.length ? (this.plan[nextIndex] as ResolvedWave) : null;
  }

  get nextPreview(): WavePreviewEntry[] {
    return this.nextWave?.preview ?? [];
  }

  get elapsedInWave(): Seconds {
    return this.elapsed;
  }

  /** True once every spawn of the current wave has been emitted. */
  get spawningComplete(): boolean {
    return this.phase === 'clearing' || this.phase === 'complete';
  }

  waveAt(waveNumber: number): ResolvedWave | null {
    return this.plan.find((wave) => wave.wave === waveNumber) ?? null;
  }

  /**
   * Starts the next wave.
   *
   * @param early true when the player pressed "start early" (GDD §6.1, +10%).
   * @returns false when a wave is already running or the run is over.
   */
  startWave(options: { early?: boolean } = {}): boolean {
    if (this.phase !== 'preparing') return false;
    if (this.index + 1 >= this.plan.length) return false;

    this.index += 1;
    this.elapsed = 0;
    this.cursor = 0;
    this.startedEarly = options.early ?? false;
    this.phase = 'spawning';

    const wave = this.plan[this.index] as ResolvedWave;
    this.events?.emit('wave_started', {
      wave: wave.wave,
      early: this.startedEarly,
      reward: wave.reward,
    });

    // A wave whose first spawn sits at t=0 must emit on the very same tick.
    if (wave.spawns.length === 0) this.finishSpawning(wave);
    return true;
  }

  /** Advances the schedule and returns everything that spawned this tick. */
  tick(dt: Seconds): SpawnRequest[] {
    if (this.phase !== 'spawning') return [];
    const wave = this.plan[this.index] as ResolvedWave;
    const emitted: SpawnRequest[] = [];

    // Spawns due at t=0 fire on the first tick, before time advances.
    while (this.cursor < wave.spawns.length) {
      const spawn = wave.spawns[this.cursor];
      if (!spawn || spawn.time > this.elapsed) break;
      this.cursor += 1;
      const cell = this.gateCell?.(spawn.gateId) ?? null;
      const request: SpawnRequest = {
        enemy: spawn.enemy,
        gateId: spawn.gateId,
        wave: wave.wave,
        ordinal: spawn.ordinal,
        hpMultiplier: spawn.hpMultiplier,
        speedMultiplier: spawn.speedMultiplier,
        bountyMultiplier: spawn.bountyMultiplier,
        cx: cell?.cx ?? -1,
        cy: cell?.cy ?? -1,
      };
      emitted.push(request);
      this.events?.emit('wave_spawn', request);
    }

    this.elapsed += dt;
    if (this.cursor >= wave.spawns.length) this.finishSpawning(wave);
    return emitted;
  }

  /**
   * Told by the caller once no enemy of this wave is left alive. Pays the
   * reward and drops back to `preparing` (or ends the run after the last wave).
   */
  notifyWaveCleared(): WaveClearResult | null {
    if (this.phase !== 'clearing') return null;
    const wave = this.plan[this.index] as ResolvedWave;
    const earlyBonus = this.startedEarly ? Math.round(wave.reward * wave.earlyStartBonus) : 0;

    this.events?.emit('wave_cleared', { wave: wave.wave, reward: wave.reward, earlyBonus });

    if (this.index + 1 >= this.plan.length) {
      this.phase = 'complete';
      this.events?.emit('run_complete', { wave: wave.wave });
    } else {
      this.phase = 'preparing';
    }

    return { wave: wave.wave, reward: wave.reward, earlyBonus, total: wave.reward + earlyBonus };
  }

  reset(): void {
    this.index = -1;
    this.elapsed = 0;
    this.cursor = 0;
    this.phase = 'preparing';
    this.startedEarly = false;
  }

  private finishSpawning(wave: ResolvedWave): void {
    if (this.phase !== 'spawning') return;
    this.phase = 'clearing';
    this.events?.emit('wave_spawning_complete', { wave: wave.wave });
  }
}
