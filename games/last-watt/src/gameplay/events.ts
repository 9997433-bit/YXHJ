/**
 * Outbound gameplay signals.
 *
 * Same shape as `src/engine/core/Signal`, re-implemented locally so the
 * gameplay module keeps its "no sibling imports" contract and stays usable in
 * headless tests and benchmarks.
 */

import type { CellCoord, TerrainName } from './types';

export type Listener<T> = (payload: T) => void;

export class Signal<T = void> {
  private readonly listeners = new Set<Listener<T>>();

  add(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  once(listener: Listener<T>): () => void {
    const off = this.add((payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  remove(listener: Listener<T>): void {
    this.listeners.delete(listener);
  }

  emit(payload: T): void {
    // Copy: listeners are allowed to unsubscribe themselves mid-dispatch.
    for (const listener of [...this.listeners]) listener(payload);
  }

  clear(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}

export type EngineeringOp = 'dig' | 'bridge';

export interface EngineeringJobPayload extends CellCoord {
  jobId: number;
  op: EngineeringOp;
  cost: number;
  duration: number;
}

export interface SpawnRequest extends CellCoord {
  /** EnemyDef id; combat resolves the stats. */
  enemy: string;
  gateId: string;
  wave: number;
  /** Sequence number inside the wave, stable across runs. */
  ordinal: number;
  /** Per-map difficulty multipliers, already resolved (GDD §8.3). */
  hpMultiplier: number;
  speedMultiplier: number;
  /** Late-wave bounty decay (GDD §6.1). */
  bountyMultiplier: number;
}

/**
 * Every signal the gameplay module raises. Presentation and meta systems
 * subscribe; gameplay never reaches back into them.
 */
export interface GameplayEventMap {
  /** Any change to walkability. Consumers should re-read the flow field. */
  terrain_changed: { cells: CellCoord[]; reason: string };
  flow_field_rebuilt: { version: number; unreachableGates: string[] };

  engineering_started: EngineeringJobPayload;
  engineering_completed: EngineeringJobPayload & { terrain: TerrainName };
  engineering_rejected: CellCoord & { op: EngineeringOp; reason: string };
  engineering_quota_granted: { dig: number; bridge: number; wave: number };
  bridge_destroyed: CellCoord & { byEnemy?: number };

  gate_opened: { gateId: string; wave: number };
  zone_lost: { zoneId: string; powerPenalty: number; openedBarrier: string | null };
  barrier_opened: { barrierId: string; cells: CellCoord[] };

  wave_started: { wave: number; early: boolean; reward: number };
  wave_spawn: SpawnRequest;
  wave_spawning_complete: { wave: number };
  wave_cleared: { wave: number; reward: number; earlyBonus: number };
  run_complete: { wave: number };
}

export type GameplayEventName = keyof GameplayEventMap;

/** Typed fan-out over `GameplayEventMap`, one `Signal` per event name. */
export class GameplayEvents {
  private readonly signals = new Map<GameplayEventName, Signal<never>>();

  on<K extends GameplayEventName>(name: K, listener: Listener<GameplayEventMap[K]>): () => void {
    return this.signal(name).add(listener);
  }

  once<K extends GameplayEventName>(name: K, listener: Listener<GameplayEventMap[K]>): () => void {
    return this.signal(name).once(listener);
  }

  off<K extends GameplayEventName>(name: K, listener: Listener<GameplayEventMap[K]>): void {
    this.signal(name).remove(listener);
  }

  emit<K extends GameplayEventName>(name: K, payload: GameplayEventMap[K]): void {
    this.signals.get(name)?.emit(payload as never);
  }

  clear(): void {
    for (const signal of this.signals.values()) signal.clear();
    this.signals.clear();
  }

  private signal<K extends GameplayEventName>(name: K): Signal<GameplayEventMap[K]> {
    let signal = this.signals.get(name) as Signal<GameplayEventMap[K]> | undefined;
    if (!signal) {
      signal = new Signal<GameplayEventMap[K]>();
      this.signals.set(name, signal as unknown as Signal<never>);
    }
    return signal;
  }
}
