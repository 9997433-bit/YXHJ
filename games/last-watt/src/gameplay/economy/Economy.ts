/**
 * 双资源经济 + 核心完整度 (GDD §6, §10; SYSTEMS.md §4).
 *
 * Gold, the two power layers and core integrity are one object because every
 * interesting rule in §6.3 is a coupling between them: a tower's permanent draw
 * is what stops the battery charging, and losing a substation cuts the supply
 * cap without touching what is already built ("逼你卖塔").
 *
 * Owns the numbers, not the decisions. Legality lives in `BuildSystem` and
 * `EngineeringSystem`; this class only answers "can I pay" and books the
 * payment. Combat reaches the battery through the `PowerSupply` port
 * (`tryConsumeBattery`), never through the fields.
 */

import type { Seconds } from '../types';
import type { GameplayEvents } from '../events';

export interface EconomyRules {
  startingGold: number;
  /** GDD §6.2: base supply before any generator. */
  basePowerCap: number;
  baseBatteryMax: number;
  /** Battery gained per second per point of *idle* supply (SYSTEMS.md §4.2). */
  batteryChargePerIdlePower: number;
  /** One capacitor activation (GDD §7.1). */
  overloadBatteryCost: number;
  maxIntegrity: number;
  /** 波间修复：100 金 = +20 完整度 (GDD §10). */
  repairCost: number;
  repairIntegrity: number;
  /** Every leaked enemy also steals gold (GDD §10); the def carries the amount. */
  ultimateChargeEveryWaves: number;
  ultimateMaxCharges: number;
}

export const DEFAULT_ECONOMY: EconomyRules = {
  startingGold: 220,
  basePowerCap: 8,
  baseBatteryMax: 100,
  batteryChargePerIdlePower: 0.25,
  overloadBatteryCost: 20,
  maxIntegrity: 100,
  repairCost: 100,
  repairIntegrity: 20,
  ultimateChargeEveryWaves: 5,
  ultimateMaxCharges: 2,
};

export interface EconomyOptions {
  rules?: Partial<EconomyRules>;
  events?: GameplayEvents;
  gold?: number;
  integrity?: number;
}

/** Buildings contribute to the caps for as long as they stand (GDD §6.2). */
export interface PowerContribution {
  powerCap?: number;
  batteryMax?: number;
  /** Multiplicative, per SYSTEMS.md decision D9 (1.5ⁿ for n capacitors). */
  batteryChargeMul?: number;
}

export interface EconomySnapshot {
  gold: number;
  power: { used: number; cap: number; idle: number; deficit: number };
  battery: { value: number; max: number; overloadCost: number };
  integrity: { value: number; max: number };
  ultimate: { charges: number; maxCharges: number };
}

export class Economy {
  readonly rules: EconomyRules;

  gold: number;
  integrity: number;
  battery = 0;
  /** Sum of every standing tower's `powerCost`. Disabled towers still count. */
  powerUsed = 0;
  ultimateCharges = 0;

  private readonly events: GameplayEvents | undefined;
  private capBonus = 0;
  private capPenalty = 0;
  private batteryMaxBonus = 0;
  private chargeMul = 1;
  private wavesCleared = 0;

  constructor(options: EconomyOptions = {}) {
    this.rules = { ...DEFAULT_ECONOMY, ...(options.rules ?? {}) };
    this.events = options.events;
    this.gold = options.gold ?? this.rules.startingGold;
    this.integrity = options.integrity ?? this.rules.maxIntegrity;
  }

  // -------------------------------------------------------------------------
  // Gold
  // -------------------------------------------------------------------------

  canAfford(amount: number): boolean {
    return this.gold >= amount;
  }

  /** Books a purchase. Returns false and changes nothing when short. */
  spend(amount: number, reason: string): boolean {
    if (amount > this.gold) return false;
    this.gold -= amount;
    this.emitGold(-amount, reason);
    return true;
  }

  earn(amount: number, reason: string): void {
    if (amount <= 0) return;
    this.gold += Math.round(amount);
    this.emitGold(Math.round(amount), reason);
  }

  /** Leak theft (GDD §10): takes what it can, never goes negative. */
  steal(amount: number): number {
    const taken = Math.min(this.gold, Math.max(0, amount));
    if (taken === 0) return 0;
    this.gold -= taken;
    this.emitGold(-taken, 'leak');
    return taken;
  }

  // -------------------------------------------------------------------------
  // Power (GDD §6.2)
  // -------------------------------------------------------------------------

  get powerCap(): number {
    return Math.max(0, this.rules.basePowerCap + this.capBonus - this.capPenalty);
  }

  /** Supply nothing is drawing; this and only this charges the battery. */
  get idlePower(): number {
    return Math.max(0, this.powerCap - this.powerUsed);
  }

  /** How far over the cap the board already is; >0 blocks new draw. */
  get powerDeficit(): number {
    return Math.max(0, this.powerUsed - this.powerCap);
  }

  get batteryMax(): number {
    return this.rules.baseBatteryMax + this.batteryMaxBonus;
  }

  /** GDD §6.2: a tower that would break the cap may not be built at all. */
  canDraw(powerCost: number): boolean {
    return powerCost <= 0 || this.powerUsed + powerCost <= this.powerCap;
  }

  addDraw(powerCost: number): void {
    if (powerCost === 0) return;
    this.powerUsed += powerCost;
    this.emitPower();
  }

  releaseDraw(powerCost: number): void {
    if (powerCost === 0) return;
    this.powerUsed = Math.max(0, this.powerUsed - powerCost);
    this.emitPower();
  }

  addContribution(contribution: PowerContribution): void {
    this.capBonus += contribution.powerCap ?? 0;
    this.batteryMaxBonus += contribution.batteryMax ?? 0;
    this.chargeMul *= contribution.batteryChargeMul ?? 1;
    this.clampBattery();
    this.emitPower();
  }

  removeContribution(contribution: PowerContribution): void {
    this.capBonus -= contribution.powerCap ?? 0;
    this.batteryMaxBonus -= contribution.batteryMax ?? 0;
    const mul = contribution.batteryChargeMul ?? 1;
    if (mul !== 0) this.chargeMul /= mul;
    this.clampBattery();
    this.emitPower();
  }

  /** A lost substation cuts the cap for the rest of the run (GDD §10). */
  applyPowerPenalty(penalty: number): void {
    if (penalty <= 0) return;
    this.capPenalty += penalty;
    this.emitPower();
  }

  /** Charges the battery off idle supply. Call once per fixed step. */
  tick(dt: Seconds): void {
    if (dt <= 0) return;
    const gain = this.idlePower * this.rules.batteryChargePerIdlePower * this.chargeMul * dt;
    if (gain <= 0) return;
    this.battery = Math.min(this.batteryMax, this.battery + gain);
  }

  /** `combat.PowerSupply`: refuses rather than going negative. */
  tryConsumeBattery(amount: number): boolean {
    if (amount > this.battery) return false;
    this.battery -= amount;
    return true;
  }

  get batteryChargeMultiplier(): number {
    return this.chargeMul;
  }

  // -------------------------------------------------------------------------
  // Integrity (GDD §10)
  // -------------------------------------------------------------------------

  /** @returns the integrity left after the hit. */
  damageIntegrity(amount: number, reason: string): number {
    if (amount <= 0) return this.integrity;
    this.integrity = Math.max(0, this.integrity - amount);
    this.events?.emit('integrity_changed', {
      integrity: this.integrity,
      delta: -amount,
      reason,
    });
    return this.integrity;
  }

  /**
   * 波间修复 (GDD §10). Pays 100 for +20, capped at 100. Lost zones stay lost —
   * that is `GameplayWorld.applyIntegrity`'s one-way latch, not a rule here.
   */
  repair(): boolean {
    if (this.integrity >= this.rules.maxIntegrity) return false;
    if (!this.spend(this.rules.repairCost, 'repair')) return false;
    const before = this.integrity;
    this.integrity = Math.min(this.rules.maxIntegrity, this.integrity + this.rules.repairIntegrity);
    this.events?.emit('integrity_changed', {
      integrity: this.integrity,
      delta: this.integrity - before,
      reason: 'repair',
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // 主控过载 charges (GDD §9)
  // -------------------------------------------------------------------------

  /** One charge per 5 cleared waves, capped at 2. */
  notifyWaveCleared(): boolean {
    this.wavesCleared += 1;
    if (this.wavesCleared % this.rules.ultimateChargeEveryWaves !== 0) return false;
    if (this.ultimateCharges >= this.rules.ultimateMaxCharges) return false;
    this.ultimateCharges += 1;
    this.events?.emit('ultimate_charged', { charges: this.ultimateCharges });
    return true;
  }

  spendUltimateCharge(): boolean {
    if (this.ultimateCharges <= 0) return false;
    this.ultimateCharges -= 1;
    return true;
  }

  snapshot(): EconomySnapshot {
    return {
      gold: this.gold,
      power: {
        used: this.powerUsed,
        cap: this.powerCap,
        idle: this.idlePower,
        deficit: this.powerDeficit,
      },
      battery: {
        value: this.battery,
        max: this.batteryMax,
        overloadCost: this.rules.overloadBatteryCost,
      },
      integrity: { value: this.integrity, max: this.rules.maxIntegrity },
      ultimate: { charges: this.ultimateCharges, maxCharges: this.rules.ultimateMaxCharges },
    };
  }

  private clampBattery(): void {
    this.battery = Math.min(this.battery, this.batteryMax);
  }

  private emitGold(delta: number, reason: string): void {
    this.events?.emit('gold_changed', { gold: this.gold, delta, reason });
  }

  private emitPower(): void {
    this.events?.emit('power_changed', {
      used: this.powerUsed,
      cap: this.powerCap,
      deficit: this.powerDeficit,
    });
  }
}
