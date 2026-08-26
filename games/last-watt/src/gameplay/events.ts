/**
 * Outbound gameplay signals.
 *
 * Same shape as `src/engine/core/Signal`, re-implemented locally so the
 * gameplay module keeps its "no sibling imports" contract and stays usable in
 * headless tests and benchmarks.
 */

import type { CanonicalTerrainName } from './data/importers';
import type { CellCoord } from './types';

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
  /** `terrain` is the canonical name (INTEGRATION.md §3.7); a dig yields `gully`, a bridge `bridge`. */
  engineering_completed: EngineeringJobPayload & { terrain: CanonicalTerrainName };
  engineering_rejected: CellCoord & { op: EngineeringOp; reason: string };
  engineering_quota_granted: { dig: number; bridge: number; wave: number };
  bridge_destroyed: CellCoord & { byEnemy?: number };

  gate_opened: { gateId: string; wave: number };
  zone_lost: { zoneId: string; powerPenalty: number; openedBarrier: string | null };
  barrier_opened: { barrierId: string; cells: CellCoord[] };

  /** A tower or building took a cell (GDD §17.1 `Cell.occupied`). */
  tower_placed: CellCoord & { towerId: number; defId: string; cost: number; powerCost: number };
  tower_removed: CellCoord & { towerId: number; defId: string; refund: number };
  /** Its substation was lost, so it is off until sold (GDD §10, decision D11). */
  tower_power_changed: CellCoord & { towerId: number; defId: string; powered: boolean };
  build_rejected: CellCoord & { defId: string; reason: string };

  gold_changed: { gold: number; delta: number; reason: string };
  power_changed: { used: number; cap: number; deficit: number };
  integrity_changed: { integrity: number; delta: number; reason: string };
  ultimate_charged: { charges: number };
  ultimate_fired: { chargesLeft: number };

  /** The engineering button is armed and waiting for a target cell. */
  tool_armed: { tool: EngineeringOp | 'build' | null; defId?: string };

  wave_started: { wave: number; early: boolean; reward: number };
  wave_spawn: SpawnRequest;
  wave_spawning_complete: { wave: number };
  wave_cleared: { wave: number; reward: number; earlyBonus: number };
  run_complete: { wave: number };
  /** Integrity hit 0, or the Leviathan reached the core (GDD §10). */
  run_lost: { reason: 'integrity' | 'leviathan'; wave: number; integrity: number };
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
