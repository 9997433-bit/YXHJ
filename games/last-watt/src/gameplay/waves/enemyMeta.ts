/**
 * The slice of an EnemyDef the wave generator needs (GDD §8.1).
 *
 * Stats live in `src/combat/entities/enemyDef.ts`; the generator only cares
 * about the class (so per-map weight multipliers can hit "flying" or "sapper"
 * as a group), the substitute to use before an enemy's first-appearance wave,
 * and what the next-wave preview should highlight.
 */

/** Canonical EnemyDef ids. Combat's data table and `data/` must match these. */
export const ENEMY_IDS = {
  /** 拾荒虫 — the baseline walker. */
  scavenger: 'scavenger',
  /** 疾行鼠群 — fast and fragile. */
  sprinter: 'sprinter',
  /** 装甲运输车 — armoured, forces combos. */
  hauler: 'hauler',
  /** 侦察蜂 — flies straight at the core, ignores the flow field. */
  scoutBee: 'scout_bee',
  /** 爆破工兵/拆迁蟹 — disables towers and blows up player bridges. */
  sapperCrab: 'sapper_crab',
  /** 修理无人机 — heal aura, forces focus fire. */
  repairDrone: 'repair_drone',
  /** 修理母舰 — wave 15 mini boss. */
  mothership: 'mothership',
  /** 利维坦 — wave 20 boss. */
  leviathan: 'leviathan',
} as const;

export type EnemyClass = 'basic' | 'fast' | 'armored' | 'flying' | 'sapper' | 'healer' | 'boss';

export interface EnemyWaveMeta {
  id: string;
  class: EnemyClass;
  /** Shown in the next-wave preview (GDD §14.1). */
  icon: string;
  /** Needs an anti-air tower. */
  air: boolean;
  /** `breaker` types get the highlighted treatment in the preview. */
  threat: 'normal' | 'breaker' | 'boss';
  /** Stand-in used when this enemy is not unlocked yet on the current map. */
  substitute?: string;
}

const meta = (
  id: string,
  cls: EnemyClass,
  icon: string,
  air: boolean,
  threat: EnemyWaveMeta['threat'],
  substitute?: string,
): EnemyWaveMeta => ({ id, class: cls, icon, air, threat, ...(substitute ? { substitute } : {}) });

export const DEFAULT_ENEMY_WAVE_META: Readonly<Record<string, EnemyWaveMeta>> = {
  [ENEMY_IDS.scavenger]: meta(ENEMY_IDS.scavenger, 'basic', 'enemy_scavenger', false, 'normal'),
  [ENEMY_IDS.sprinter]: meta(ENEMY_IDS.sprinter, 'fast', 'enemy_sprinter', false, 'normal'),
  [ENEMY_IDS.hauler]: meta(ENEMY_IDS.hauler, 'armored', 'enemy_hauler', false, 'normal'),
  [ENEMY_IDS.scoutBee]: meta(
    ENEMY_IDS.scoutBee,
    'flying',
    'enemy_scout_bee',
    true,
    'breaker',
    ENEMY_IDS.sprinter,
  ),
  [ENEMY_IDS.sapperCrab]: meta(
    ENEMY_IDS.sapperCrab,
    'sapper',
    'enemy_sapper_crab',
    false,
    'breaker',
    ENEMY_IDS.hauler,
  ),
  [ENEMY_IDS.repairDrone]: meta(
    ENEMY_IDS.repairDrone,
    'healer',
    'enemy_repair_drone',
    false,
    'breaker',
    ENEMY_IDS.scavenger,
  ),
  [ENEMY_IDS.mothership]: meta(ENEMY_IDS.mothership, 'boss', 'enemy_mothership', false, 'boss'),
  [ENEMY_IDS.leviathan]: meta(ENEMY_IDS.leviathan, 'boss', 'enemy_leviathan', false, 'boss'),
};

export function enemyMetaOf(
  id: string,
  table: Readonly<Record<string, EnemyWaveMeta>> = DEFAULT_ENEMY_WAVE_META,
): EnemyWaveMeta {
  return table[id] ?? meta(id, 'basic', `enemy_${id}`, false, 'normal');
}
