/**
 * Per-enemy status container.
 *
 * Pure data plus the exclusivity rules: it never emits events and never deals
 * damage. It reports what changed and the caller (`StatusSystem`) turns that
 * into events and reaction triggers, which keeps ordering explicit and makes
 * the whole thing trivially unit-testable.
 */

import type { Seconds, StatusId } from '../types';
import {
  NEUTRAL_MODIFIERS,
  type AggregatedModifiers,
  type StatusDef,
  type StatusInstance,
  type StatusModifiers,
  type StatusRegistry,
  type StatusRemovalReason,
} from './statusDef';

export interface StatusApplyOptions {
  stacks?: number;
  duration?: Seconds;
  modifiers?: StatusModifiers;
  params?: Readonly<Record<string, number>>;
}

export interface StatusRemoval {
  status: StatusId;
  reason: StatusRemovalReason;
  def: StatusDef;
}

export interface StatusApplyResult {
  status: StatusId;
  applied: boolean;
  refreshed: boolean;
  blockedBy?: 'immune' | 'blocked_by_status' | 'def_immunity';
  stacks: number;
  duration: Seconds;
  /** Statuses evicted or cancelled as a consequence of this application. */
  removed: StatusRemoval[];
}

function applyModifiers(acc: AggregatedModifiers, mods: StatusModifiers, times: number): void {
  if (times <= 0) return;
  if (mods.speedMul !== undefined) acc.speedMul *= Math.pow(mods.speedMul, times);
  if (mods.damageTakenMul !== undefined) acc.damageTakenMul *= Math.pow(mods.damageTakenMul, times);
  if (mods.armorDelta !== undefined) acc.armorDelta += mods.armorDelta * times;
  if (mods.immobile) acc.immobile = true;
  if (mods.suppressBehaviour) acc.suppressBehaviour = true;
}

export class StatusSet {
  private readonly instances = new Map<StatusId, StatusInstance>();
  private aggregated: AggregatedModifiers = { ...NEUTRAL_MODIFIERS };
  private dirty = false;

  constructor(
    private readonly registry: StatusRegistry,
    /** Immunities declared on the EnemyDef or granted by a boss phase. */
    private immunities: ReadonlySet<StatusId> = new Set(),
  ) {}

  setImmunities(immunities: ReadonlySet<StatusId>): void {
    this.immunities = immunities;
    for (const id of immunities) {
      if (this.instances.has(id)) {
        this.instances.delete(id);
        this.dirty = true;
      }
    }
  }

  has(id: StatusId): boolean {
    return this.instances.has(id);
  }

  stacks(id: StatusId): number {
    return this.instances.get(id)?.stacks ?? 0;
  }

  get(id: StatusId): StatusInstance | undefined {
    return this.instances.get(id);
  }

  list(): StatusInstance[] {
    return [...this.instances.values()];
  }

  apply(id: StatusId, options: StatusApplyOptions = {}): StatusApplyResult {
    const def = this.registry.get(id);
    const removed: StatusRemoval[] = [];

    if (this.immunities.has(id)) {
      return { status: id, applied: false, refreshed: false, blockedBy: 'def_immunity', stacks: 0, duration: 0, removed };
    }
    for (const active of this.instances.values()) {
      const activeDef = this.registry.get(active.id);
      if (active.id !== id && activeDef.blocks?.includes(id)) {
        return { status: id, applied: false, refreshed: false, blockedBy: 'blocked_by_status', stacks: 0, duration: 0, removed };
      }
    }

    // GDD §7.2: coatings are unique, reaction states are unique.
    if (def.group) {
      for (const active of [...this.instances.values()]) {
        if (active.id === id) continue;
        if (this.registry.get(active.id).group === def.group) {
          this.removeInternal(active.id, 'replaced', removed);
        }
      }
    }
    for (const cleared of def.clears ?? []) {
      if (cleared !== id) this.removeInternal(cleared, 'cleansed', removed);
    }

    const duration = options.duration ?? def.defaultDuration;
    const addStacks = Math.max(1, options.stacks ?? 1);
    const existing = this.instances.get(id);

    if (existing) {
      const before = existing.stacks;
      existing.stacks = Math.min(def.maxStacks, existing.stacks + addStacks);
      if (def.refresh === 'refresh') existing.remaining = Math.max(existing.remaining, duration);
      else if (def.refresh === 'extend') existing.remaining += duration;
      if (options.modifiers) existing.modifiers = options.modifiers;
      if (options.params) existing.params = options.params;
      this.dirty = true;
      return {
        status: id,
        applied: existing.stacks !== before,
        refreshed: true,
        stacks: existing.stacks,
        duration: existing.remaining,
        removed,
      };
    }

    const instance: StatusInstance = {
      id,
      stacks: Math.min(def.maxStacks, addStacks),
      remaining: duration,
      dotCarry: 0,
    };
    if (options.modifiers) instance.modifiers = options.modifiers;
    if (options.params) instance.params = options.params;
    this.instances.set(id, instance);
    this.dirty = true;
    return { status: id, applied: true, refreshed: false, stacks: instance.stacks, duration, removed };
  }

  remove(id: StatusId, reason: StatusRemovalReason = 'cleansed'): StatusRemoval | undefined {
    const out: StatusRemoval[] = [];
    this.removeInternal(id, reason, out);
    return out[0];
  }

  /** Decrements timers. Returns the statuses that ran out this frame. */
  tick(dt: Seconds): StatusRemoval[] {
    const expired: StatusRemoval[] = [];
    for (const instance of [...this.instances.values()]) {
      if (instance.remaining === Number.POSITIVE_INFINITY) continue;
      instance.remaining -= dt;
      if (instance.remaining <= 0) this.removeInternal(instance.id, 'expired', expired);
    }
    return expired;
  }

  modifiers(): AggregatedModifiers {
    if (this.dirty) this.recompute();
    return this.aggregated;
  }

  clear(): void {
    this.instances.clear();
    this.dirty = true;
  }

  private removeInternal(id: StatusId, reason: StatusRemovalReason, out: StatusRemoval[]): void {
    if (!this.instances.delete(id)) return;
    this.dirty = true;
    out.push({ status: id, reason, def: this.registry.get(id) });
  }

  private recompute(): void {
    const acc: AggregatedModifiers = { ...NEUTRAL_MODIFIERS };
    for (const instance of this.instances.values()) {
      const def = this.registry.get(instance.id);
      const mods = instance.modifiers ?? def.modifiers;
      if (mods) applyModifiers(acc, mods, 1);
      if (def.perStackModifiers) applyModifiers(acc, def.perStackModifiers, instance.stacks);
    }
    this.aggregated = acc;
    this.dirty = false;
  }
}
