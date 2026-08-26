/**
 * Content primary keys.
 *
 * Round 2 ruling 3: the `id` field in `games/last-watt/data/*.json` is the
 * canonical name of a tower, an upgrade, an enemy and a boss phase. Round 1
 * gave combat a second, private set of names for the same eight towers and
 * eight enemies; those are gone as primary keys and survive only in
 * `LEGACY_*_IDS` below, which is read-only and expected to shrink to nothing.
 *
 * Anything that takes an id from outside the module (`buildTower`,
 * `spawnEnemy`, `upgradeTower`, `ContentRegistry`) runs it through the
 * resolvers here first, so a caller still holding a Round 1 name keeps working
 * while every id combat *emits* is canonical.
 */

/** Tower and building ids — `data/towers.json`. */
export const TOWER_IDS = {
  /** 铆钉机枪 */
  rivetMg: 'mg_rivet',
  /** 焦油喷洒器 */
  tarSprayer: 'tar_sprayer',
  /** 液压破碎锤 */
  hydraulicBreaker: 'hydraulic_breaker',
  /** 冷凝喷射塔 */
  condenserJet: 'condenser_jet',
  /** 火焰喷射塔 */
  flameThrower: 'flame_thrower',
  /** 特斯拉线圈 */
  teslaCoil: 'tesla_coil',
  /** 电容站 */
  capacitorStation: 'capacitor_station',
  /** 发电机 */
  generator: 'generator',
} as const;

/** Upgrade ids — `data/towers.json`, `towers[].upgrades[].id`. */
export const UPGRADE_IDS = {
  mgTwin: 'up_mg_twin',
  mgArmorPiercing: 'up_mg_ap',
  tarSticky: 'up_tar_sticky',
  tarWide: 'up_tar_wide',
  breakerShockwave: 'up_breaker_shockwave',
  breakerFastCycle: 'up_breaker_fastcycle',
  condenserDeepFreeze: 'up_cond_deepfreeze',
  condenserDualNozzle: 'up_cond_dualnozzle',
  flameLongBurn: 'up_flame_longburn',
  flameRange: 'up_flame_range',
  teslaChain5: 'up_tesla_chain5',
  teslaCoolRun: 'up_tesla_coolrun',
  capacitorLongSurge: 'up_cap_longsurge',
  capacitorHalfHeat: 'up_cap_halfheat',
} as const;

/** Enemy ids — `data/enemies.json`. */
export const ENEMY_IDS = {
  /** 拾荒虫 */
  scavengerBug: 'scavenger_bug',
  /** 疾行鼠群 */
  swiftRat: 'swift_rat',
  /** 装甲运输车 */
  armoredTruck: 'armored_truck',
  /** 侦察蜂 */
  scoutWasp: 'scout_wasp',
  /** 爆破工兵（拆迁蟹） */
  demoSapper: 'demo_sapper',
  /** 修理无人机 */
  repairDrone: 'repair_drone',
  /** 修理母舰 */
  repairMothership: 'repair_mothership',
  /** 利维坦 */
  leviathan: 'leviathan',
} as const;

/** Leviathan phase ids — `data/enemies.json`, `behavior_params.phases[].id`. */
export const ENEMY_PHASE_IDS = {
  leviathanArmorPlates: 'p1_armor_plates',
  leviathanSapperRelease: 'p2_sapper_release',
  leviathanOverdriveDash: 'p3_overdrive_dash',
} as const;

/**
 * Round 1 combat-private tower names. Read-only: nothing in the module may
 * define, emit or store one of these. Delete a row once no caller uses it.
 */
export const LEGACY_TOWER_IDS: Readonly<Record<string, string>> = Object.freeze({
  rivet_mg: TOWER_IDS.rivetMg,
  hydraulic_hammer: TOWER_IDS.hydraulicBreaker,
  condenser: TOWER_IDS.condenserJet,
  flamethrower: TOWER_IDS.flameThrower,
});

/** Round 1 combat-private upgrade names. Read-only. */
export const LEGACY_UPGRADE_IDS: Readonly<Record<string, string>> = Object.freeze({
  mg_twin_link: UPGRADE_IDS.mgTwin,
  mg_armor_piercing: UPGRADE_IDS.mgArmorPiercing,
  tar_viscous: UPGRADE_IDS.tarSticky,
  tar_wide_nozzle: UPGRADE_IDS.tarWide,
  hammer_shockwave: UPGRADE_IDS.breakerShockwave,
  hammer_rapid_cycle: UPGRADE_IDS.breakerFastCycle,
  condenser_deep_freeze: UPGRADE_IDS.condenserDeepFreeze,
  condenser_dual_nozzle: UPGRADE_IDS.condenserDualNozzle,
  flamer_long_burn: UPGRADE_IDS.flameLongBurn,
  flamer_extended_range: UPGRADE_IDS.flameRange,
  tesla_five_jumps: UPGRADE_IDS.teslaChain5,
  tesla_heat_sink: UPGRADE_IDS.teslaCoolRun,
  capacitor_long_overload: UPGRADE_IDS.capacitorLongSurge,
  capacitor_heat_sink: UPGRADE_IDS.capacitorHalfHeat,
});

/**
 * Round 1 combat-private enemy names, which `src/gameplay/waves/enemyMeta.ts`
 * still emits through its own `ENEMY_IDS`. Read-only.
 */
export const LEGACY_ENEMY_IDS: Readonly<Record<string, string>> = Object.freeze({
  scurry_rats: ENEMY_IDS.swiftRat,
  armored_hauler: ENEMY_IDS.armoredTruck,
  scout_bee: ENEMY_IDS.scoutWasp,
  sapper_crab: ENEMY_IDS.demoSapper,
});

function resolve(aliases: Readonly<Record<string, string>>, id: string): string {
  return aliases[id] ?? id;
}

/** Maps a Round 1 tower name onto its `data/towers.json` id; else identity. */
export function resolveTowerId(id: string): string {
  return resolve(LEGACY_TOWER_IDS, id);
}

/** Maps a Round 1 upgrade name onto its `data/towers.json` id; else identity. */
export function resolveUpgradeId(id: string): string {
  return resolve(LEGACY_UPGRADE_IDS, id);
}

/** Maps a Round 1 enemy name onto its `data/enemies.json` id; else identity. */
export function resolveEnemyId(id: string): string {
  return resolve(LEGACY_ENEMY_IDS, id);
}

/** True when `id` is a deprecated name rather than a canonical one. */
export function isLegacyId(id: string): boolean {
  return id in LEGACY_TOWER_IDS || id in LEGACY_UPGRADE_IDS || id in LEGACY_ENEMY_IDS;
}
