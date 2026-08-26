/**
 * Gold, power, battery and core integrity (GDD §6, §10).
 *
 * Small enough to live in one file and deliberately dumb: it holds numbers and
 * enforces the two rules that gate player actions (can I pay, is there supply).
 * Who spends and why is `Sim`'s business. Satisfies `combat.PowerSupply`.
 */

import { ECONOMY_DEFAULTS } from './config';

export interface EconomyChange {
  gold: number;
  delta: number;
  reason: string;
}

export class Economy {
  gold: number = ECONOMY_DEFAULTS.gold;
  battery: number = ECONOMY_DEFAULTS.battery;
  batteryMax: number = ECONOMY_DEFAULTS.batteryMax;
  integrity: number = ECONOMY_DEFAULTS.integrity;

  /** Base supply plus generators, minus the penalty of every lost zone. */
  baseCap: number = ECONOMY_DEFAULTS.powerCap;
  generatorBonus = 0;
  zonePenalty = 0;

  /** Sum of the permanent draw of every standing tower. */
  powerUsed = 0;

  /** Seconds left on the "you tried to overspend supply" HUD flash. */
  deficitFlash = 0;
  private lastDeficit = 0;

  get powerCap(): number {
    return Math.max(0, this.baseCap + this.generatorBonus - this.zonePenalty);
  }

  get idlePower(): number {
    return Math.max(0, this.powerCap - this.powerUsed);
  }

  /** Deficit to show on the supply bar, or 0 once the flash has decayed. */
  get powerDeficit(): number {
    return this.deficitFlash > 0 ? this.lastDeficit : 0;
  }

  canAfford(cost: number): boolean {
    return this.gold >= cost;
  }

  hasSupplyFor(powerCost: number): boolean {
    return powerCost <= 0 || this.powerUsed + powerCost <= this.powerCap;
  }

  /** Records a refused build so the supply bar can flash the exact shortfall. */
  flagDeficit(powerCost: number): void {
    this.lastDeficit = Math.max(0, this.powerUsed + powerCost - this.powerCap);
    this.deficitFlash = 1.5;
  }

  spend(amount: number, reason: string): EconomyChange {
    this.gold = Math.max(0, this.gold - amount);
    return { gold: this.gold, delta: -amount, reason };
  }

  earn(amount: number, reason: string): EconomyChange {
    this.gold += amount;
    return { gold: this.gold, delta: amount, reason };
  }

  damageIntegrity(amount: number): number {
    this.integrity = Math.max(0, this.integrity - amount);
    return this.integrity;
  }

  /** GDD §6.2: idle supply trickles into the battery at 0.25/point/second. */
  chargeBattery(dt: number): void {
    if (this.deficitFlash > 0) this.deficitFlash = Math.max(0, this.deficitFlash - dt);
    const gain = this.idlePower * ECONOMY_DEFAULTS.batteryChargePerIdlePower * dt;
    this.battery = Math.min(this.batteryMax, this.battery + gain);
  }

  // --- combat.PowerSupply ---------------------------------------------------

  tryConsumeBattery(amount: number): boolean {
    if (this.battery < amount) return false;
    this.battery -= amount;
    return true;
  }
}
