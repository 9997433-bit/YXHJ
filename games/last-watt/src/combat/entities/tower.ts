/**
 * Tower runtime instance and its little state machine.
 *
 * The overload → overheat cycle (GDD §7.3.4) is the reason this is a state
 * machine at all: overload is a timing decision precisely because it hands you
 * a 3 second shutdown afterwards.
 */

import type { CellCoord, EntityId, Seconds, TargetStrategy, Vec2 } from '../types';
import { cellCenter } from '../types';
import { patchTowerDef, type TowerDef, type UpgradeDef } from './towerDef';

export type TowerState = 'idle' | 'overloaded' | 'overheated' | 'disabled' | 'unpowered';

export class Tower {
  /** Def with the chosen upgrade already folded in. */
  def: TowerDef;
  readonly cell: CellCoord;
  readonly position: Vec2;
  readonly facing: Vec2 = { x: 1, y: 0 };

  upgradeId?: string;
  targetStrategy: TargetStrategy;

  /** Seconds until the next attack is allowed. */
  cooldown = 0;
  /** Sub-frame accumulator so high fire rates stay frame-rate independent. */
  overloadRemaining = 0;
  overloadSpeedMul = 1;
  overheatRemaining = 0;
  /** Overheat to serve once the current overload ends. */
  pendingOverheat = 0;
  /** Sapper crab shutdown (GDD §8.1: 10s). */
  disabledRemaining = 0;
  /** False inside a lost substation zone (GDD §10). */
  powered = true;
  activationCooldown = 0;

  /** Damage dealt, for the §20 "no combo above 40% of damage" red line. */
  damageDealt = 0;

  constructor(
    readonly id: EntityId,
    readonly baseDef: TowerDef,
    cell: CellCoord,
  ) {
    this.def = baseDef;
    this.cell = { cx: cell.cx, cy: cell.cy };
    this.position = cellCenter(cell.cx, cell.cy);
    this.targetStrategy = baseDef.defaultStrategy;
  }

  get defId(): string {
    return this.baseDef.id;
  }

  /** True for towers that draw power — the ones overload actually affects. */
  get drawsPower(): boolean {
    return this.baseDef.powerCost > 0;
  }

  get state(): TowerState {
    if (!this.powered) return 'unpowered';
    if (this.disabledRemaining > 0) return 'disabled';
    if (this.overheatRemaining > 0) return 'overheated';
    if (this.overloadRemaining > 0) return 'overloaded';
    return 'idle';
  }

  get operational(): boolean {
    const state = this.state;
    return state === 'idle' || state === 'overloaded';
  }

  /** Fire-rate multiplier; 2 while overloaded (GDD §7.3.4 "+100%"). */
  get attackSpeedMul(): number {
    return this.overloadRemaining > 0 ? this.overloadSpeedMul : 1;
  }

  applyUpgrade(upgrade: UpgradeDef): void {
    if (upgrade.towerId !== this.baseDef.id) {
      throw new Error(`[combat] upgrade ${upgrade.id} does not belong to tower ${this.baseDef.id}`);
    }
    this.upgradeId = upgrade.id;
    this.def = patchTowerDef(this.baseDef, upgrade.patch);
  }

  overload(speedMul: number, duration: Seconds, overheat: Seconds): void {
    this.overloadRemaining = Math.max(this.overloadRemaining, duration);
    this.overloadSpeedMul = Math.max(this.overloadSpeedMul, speedMul);
    const cost = this.def.overheatImmune ? 0 : overheat;
    this.pendingOverheat = Math.max(this.pendingOverheat, cost);
  }

  disable(duration: Seconds): void {
    this.disabledRemaining = Math.max(this.disabledRemaining, duration);
  }

  /**
   * Advances timers. Returns the state transition that happened this frame, or
   * undefined — the caller turns it into a `tower_state_changed` event.
   */
  tick(dt: Seconds): TowerState | undefined {
    const before = this.state;

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.activationCooldown > 0) this.activationCooldown = Math.max(0, this.activationCooldown - dt);
    if (this.disabledRemaining > 0) this.disabledRemaining = Math.max(0, this.disabledRemaining - dt);

    if (this.overloadRemaining > 0) {
      this.overloadRemaining = Math.max(0, this.overloadRemaining - dt);
      if (this.overloadRemaining === 0) {
        this.overloadSpeedMul = 1;
        if (this.pendingOverheat > 0) {
          this.overheatRemaining = this.pendingOverheat;
          this.pendingOverheat = 0;
        }
      }
    } else if (this.overheatRemaining > 0) {
      this.overheatRemaining = Math.max(0, this.overheatRemaining - dt);
    }

    const after = this.state;
    return after === before ? undefined : after;
  }

  /** Seconds the current state has left, for the UI ring. */
  stateRemaining(): Seconds {
    switch (this.state) {
      case 'overloaded':
        return this.overloadRemaining;
      case 'overheated':
        return this.overheatRemaining;
      case 'disabled':
        return this.disabledRemaining;
      default:
        return 0;
    }
  }
}
