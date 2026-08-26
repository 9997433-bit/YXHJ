/**
 * `data/game_state.defaults.json` → `EconomyRules` / engineering costs.
 *
 * INTEGRATION.md §4.1-5 and §4.2-3: starting gold, the supply cap and the
 * battery ceiling are read from the table, never hard-coded. The numbers live
 * in one JSON so changing 220 there changes it everywhere, which is exactly
 * what acceptance hook §5.4 checks.
 *
 * The JSON is a design document first — it carries formulas and notes this
 * module has no use for — so this is the same kind of one-way adapter as
 * `importers.ts`: it reads the fields the runtime needs and ignores the rest.
 */

import type { EconomyRules } from '../economy/Economy';

export interface GameStateDefaultsJson {
  defaults: {
    gold: number;
    power_cap: number;
    battery: number;
    integrity: number;
  };
  limits: {
    battery_max_base: number;
    ability_charges_max: number;
    integrity_max: number;
  };
  rules: {
    battery: {
      charge_per_idle_power_per_s: number;
      overload_battery_cost: number;
    };
    economy: {
      sell_refund_ratio: number;
      leak_gold_steal: number;
      dig_cost_gold: number;
      bridge_cost_gold: number;
    };
    repair: {
      cost_gold: number;
      integrity_gain: number;
    };
    ability_master_overload: {
      charge_every_completed_waves: number;
      max_stored: number;
    };
    engineering: {
      construction_time_s: number;
    };
  };
}

export function importEconomyRules(json: GameStateDefaultsJson): EconomyRules {
  return {
    startingGold: json.defaults.gold,
    basePowerCap: json.defaults.power_cap,
    baseBatteryMax: json.limits.battery_max_base,
    batteryChargePerIdlePower: json.rules.battery.charge_per_idle_power_per_s,
    overloadBatteryCost: json.rules.battery.overload_battery_cost,
    sellRefundRatio: json.rules.economy.sell_refund_ratio,
    maxIntegrity: json.limits.integrity_max,
    repairCost: json.rules.repair.cost_gold,
    repairIntegrity: json.rules.repair.integrity_gain,
    ultimateChargeEveryWaves: json.rules.ability_master_overload.charge_every_completed_waves,
    ultimateMaxCharges: json.limits.ability_charges_max,
  };
}

export interface EngineeringCostDefaults {
  digCost: number;
  bridgeCost: number;
  digDuration: number;
  bridgeDuration: number;
}

export function importEngineeringCosts(json: GameStateDefaultsJson): EngineeringCostDefaults {
  const duration = json.rules.engineering.construction_time_s;
  return {
    digCost: json.rules.economy.dig_cost_gold,
    bridgeCost: json.rules.economy.bridge_cost_gold,
    digDuration: duration,
    bridgeDuration: duration,
  };
}
