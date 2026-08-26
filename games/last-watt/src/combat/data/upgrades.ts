/**
 * Upgrade table — the 14 two-choice upgrades of GDD §7.1.
 *
 * Note that three of them (deep freeze, long burn, long overload) retune
 * numbers that belong to *combos*, and they do it by overriding the parameters
 * their tower publishes rather than by editing a reaction row. That is the
 * whole reason `{ param, fallback }` exists.
 */

import type { UpgradeDef } from '../entities/towerDef';
import { REACTION_PARAMS } from './reactions';
import { TAR_SLOW_UPGRADED_MULTIPLIER } from './tuning';

export const UPGRADE_DEFS: readonly UpgradeDef[] = [
  {
    id: 'mg_twin_link',
    towerId: 'rivet_mg',
    displayName: '双联',
    cost: 90,
    description: 'DPS 10 → 16。',
    patch: { damageMul: 1.6 },
  },
  {
    id: 'mg_armor_piercing',
    towerId: 'rivet_mg',
    displayName: '穿甲弹',
    cost: 110,
    description: '无视护甲：装甲运输车不再刮痧。',
    patch: { ignoreArmor: true },
  },
  {
    id: 'tar_viscous',
    towerId: 'tar_sprayer',
    displayName: '黏稠',
    cost: 90,
    description: '减速 30% → 40%。',
    patch: { paramOverrides: { [REACTION_PARAMS.slowMul]: TAR_SLOW_UPGRADED_MULTIPLIER } },
  },
  {
    id: 'tar_wide_nozzle',
    towerId: 'tar_sprayer',
    displayName: '大范围',
    cost: 100,
    description: '油渍覆盖半径 +1 格。',
    patch: { paintRadiusAdd: 1 },
  },
  {
    id: 'hammer_shockwave',
    towerId: 'hydraulic_hammer',
    displayName: '震荡波',
    cost: 130,
    description: '每次重击附带 1 格溅射。',
    patch: { splashRadiusAdd: 1 },
  },
  {
    id: 'hammer_rapid_cycle',
    towerId: 'hydraulic_hammer',
    displayName: '快速循环',
    cost: 140,
    description: '攻击间隔 2.5s → 1.8s（仍单发 45，冰碎门槛不受影响）。',
    patch: { intervalMul: 0.72 },
  },
  {
    id: 'condenser_deep_freeze',
    towerId: 'condenser',
    displayName: '冻结 2.5s',
    cost: 120,
    description: '叠满三层后的冻结时间 2s → 2.5s。',
    patch: {
      statusOverrides: [
        { status: 'chilled', params: { [REACTION_PARAMS.freezeDuration]: 2.5 } },
      ],
    },
  },
  {
    id: 'condenser_dual_nozzle',
    towerId: 'condenser',
    displayName: '双喷口',
    cost: 130,
    description: '喷雾锥角显著加宽，可同时冻住一整波。',
    patch: { coneHalfAngleAdd: 18, rangeAdd: 0.5 },
  },
  {
    id: 'flamer_long_burn',
    towerId: 'flamethrower',
    displayName: '火场延长',
    cost: 130,
    description: '火场持续 5s → 8s。',
    patch: { paramOverrides: { [REACTION_PARAMS.fireFieldDuration]: 8 } },
  },
  {
    id: 'flamer_extended_range',
    towerId: 'flamethrower',
    displayName: '射程 +1',
    cost: 120,
    description: '喷射距离 +1 格。',
    patch: { rangeAdd: 1 },
  },
  {
    id: 'tesla_five_jumps',
    towerId: 'tesla_coil',
    displayName: '链 5 跳',
    cost: 150,
    description: '链式闪电 3 跳 → 5 跳。',
    patch: { chainJumpsAdd: 2 },
  },
  {
    id: 'tesla_heat_sink',
    towerId: 'tesla_coil',
    displayName: '超载后不过热',
    cost: 150,
    description: '超载结束后不进入过热停机。',
    patch: { overheatImmune: true },
  },
  {
    id: 'capacitor_long_overload',
    towerId: 'capacitor_station',
    displayName: '超载 8s',
    cost: 120,
    description: '超载持续 6s → 8s。',
    patch: { activationParamOverrides: { [REACTION_PARAMS.overloadDuration]: 8 } },
  },
  {
    id: 'capacitor_heat_sink',
    towerId: 'capacitor_station',
    displayName: '过热减半',
    cost: 130,
    description: '超载后的过热停机 3s → 1.5s。',
    patch: { activationParamOverrides: { [REACTION_PARAMS.overheatDuration]: 1.5 } },
  },
];
