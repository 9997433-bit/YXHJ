/**
 * Turns a building's data-table effects into power-grid contributions
 * (GDD §6.2, §5.2; SYSTEMS.md decision D9).
 */

import type { TowerDefView } from '../integration/combatPort';
import type { PowerContribution } from './Economy';

/** Whether the cell touches a geothermal fissure (map 3 generator bonus). */
export type PowerContributionSource = 'plain' | 'fissure';

const NOTHING: PowerContribution = {};

export function contributionOf(def: TowerDefView, source: PowerContributionSource): PowerContribution {
  const effects = def.building;
  if (!effects) return NOTHING;

  const powerCap =
    source === 'fissure'
      ? (effects.powerCapBonusOnFissure ?? effects.powerCapBonus ?? 0)
      : (effects.powerCapBonus ?? 0);

  const contribution: PowerContribution = {};
  if (powerCap) contribution.powerCap = powerCap;
  if (effects.batteryCapBonus) contribution.batteryMax = effects.batteryCapBonus;
  // D9: two capacitors multiply (1.5²), their battery caps add.
  if (effects.batteryChargeMul) contribution.batteryChargeMul = effects.batteryChargeMul;
  return contribution;
}
