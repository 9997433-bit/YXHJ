/**
 * Upgrade table — the 14 two-choice upgrades of GDD §7.1.
 *
 * Ids and owning tower ids are the primary keys from
 * `games/last-watt/data/towers.json`.
 *
 * Note that three of them (deep freeze, long burn, long overload) retune
 * numbers that belong to *combos*, and they do it by overriding the parameters
 * their tower publishes rather than by editing a reaction row. That is the
 * whole reason `{ param, fallback }` exists.
 */

import type { UpgradeDef } from '../entities/towerDef';
import { TOWER_IDS, UPGRADE_IDS } from './ids';
import { REACTION_PARAMS } from './reactions';
import { TAR_SLOW_UPGRADED_MULTIPLIER } from './tuning';

export const UPGRADE_DEFS: readonly UpgradeDef[] = [
  {
    id: UPGRADE_IDS.mgTwin,
    towerId: TOWER_IDS.rivetMg,
    displayName: '双联',
    cost: 90,
    description: 'DPS 10 → 16。',
    patch: { damageMul: 1.6 },
  },
  {
    id: UPGRADE_IDS.mgArmorPiercing,
    towerId: TOWER_IDS.rivetMg,
    displayName: '穿甲弹',
    cost: 110,
    description: '无视护甲：装甲运输车不再刮痧。',
    patch: { ignoreArmor: true },
  },
  {
    id: UPGRADE_IDS.tarSticky,
    towerId: TOWER_IDS.tarSprayer,
    displayName: '黏稠',
    cost: 90,
    description: '减速 30% → 40%。',
    patch: { paramOverrides: { [REACTION_PARAMS.slowMul]: TAR_SLOW_UPGRADED_MULTIPLIER } },
  },
  {
    id: UPGRADE_IDS.tarWide,
    towerId: TOWER_IDS.tarSprayer,
    displayName: '大范围',
    cost: 100,
    description: '油渍覆盖半径 +1 格。',
    patch: { paintRadiusAdd: 1 },
  },
  {
    id: UPGRADE_IDS.breakerShockwave,
    towerId: TOWER_IDS.hydraulicBreaker,
    displayName: '震荡波',
    cost: 130,
    description: '每次重击附带 1 格溅射。',
    patch: { splashRadiusAdd: 1 },
  },
  {
    id: UPGRADE_IDS.breakerFastCycle,
    towerId: TOWER_IDS.hydraulicBreaker,
    displayName: '快速循环',
    cost: 140,
    description: '攻击间隔 2.5s → 1.8s（仍单发 45，冰碎门槛不受影响）。',
    patch: { intervalMul: 0.72 },
  },
  {
    id: UPGRADE_IDS.condenserDeepFreeze,
    towerId: TOWER_IDS.condenserJet,
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
    id: UPGRADE_IDS.condenserDualNozzle,
    towerId: TOWER_IDS.condenserJet,
    displayName: '双喷口',
    cost: 130,
    description: '喷雾锥角显著加宽，可同时冻住一整波。',
    patch: { coneHalfAngleAdd: 18, rangeAdd: 0.5 },
  },
  {
    id: UPGRADE_IDS.flameLongBurn,
    towerId: TOWER_IDS.flameThrower,
    displayName: '火场延长',
    cost: 130,
    description: '火场持续 5s → 8s。',
    patch: { paramOverrides: { [REACTION_PARAMS.fireFieldDuration]: 8 } },
  },
  {
    id: UPGRADE_IDS.flameRange,
    towerId: TOWER_IDS.flameThrower,
    displayName: '射程 +1',
    cost: 120,
    description: '喷射距离 +1 格。',
    patch: { rangeAdd: 1 },
  },
  {
    id: UPGRADE_IDS.teslaChain5,
    towerId: TOWER_IDS.teslaCoil,
    displayName: '链 5 跳',
    cost: 150,
    description: '链式闪电 3 跳 → 5 跳。',
    patch: { chainJumpsAdd: 2 },
  },
  {
    id: UPGRADE_IDS.teslaCoolRun,
    towerId: TOWER_IDS.teslaCoil,
    displayName: '超载后不过热',
    cost: 150,
    description: '超载结束后不进入过热停机。',
    patch: { overheatImmune: true },
  },
  {
    id: UPGRADE_IDS.capacitorLongSurge,
    towerId: TOWER_IDS.capacitorStation,
    displayName: '超载 8s',
    cost: 120,
    description: '超载持续 6s → 8s。',
    patch: { activationParamOverrides: { [REACTION_PARAMS.overloadDuration]: 8 } },
  },
  {
    id: UPGRADE_IDS.capacitorHalfHeat,
    towerId: TOWER_IDS.capacitorStation,
    displayName: '过热减半',
    cost: 130,
    description: '超载后的过热停机 3s → 1.5s。',
    patch: { activationParamOverrides: { [REACTION_PARAMS.overheatDuration]: 1.5 } },
  },
];
