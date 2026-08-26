/**
 * The slice of an EnemyDef the wave generator needs (GDD §8.1).
 *
 * Stats live in `src/combat/entities/enemyDef.ts`; the generator only cares
 * about the class (so per-map weight multipliers can hit "flying" or "sapper"
 * as a group), the substitute to use before an enemy's first-appearance wave,
 * and what the next-wave preview should highlight.
 */

/**
 * Canonical EnemyDef ids — `data/enemies.json` is the single source of truth
 * (INTEGRATION.md §3.2 / J3). The wave generator emits these ids and nothing
 * else; every other spelling enters through {@link ENEMY_ID_ALIASES}.
 */
export const ENEMY_IDS = {
  /** 拾荒虫 — the baseline walker. */
  scavenger: 'scavenger_bug',
  /** 疾行鼠群 — fast and fragile. */
  sprinter: 'swift_rat',
  /** 装甲运输车 — armoured, forces combos. */
  hauler: 'armored_truck',
  /** 侦察蜂 — flies straight at the core, ignores the flow field. */
  scoutBee: 'scout_wasp',
  /** 爆破工兵/拆迁蟹 — disables towers and blows up player bridges. */
  sapperCrab: 'demo_sapper',
  /** 修理无人机 — heal aura, forces focus fire. */
  repairDrone: 'repair_drone',
  /** 修理母舰 — wave 15 mini boss. */
  mothership: 'repair_mothership',
  /** 利维坦 — wave 20 boss. */
  leviathan: 'leviathan',
} as const;

/**
 * One-way translation layer (INTEGRATION.md §3): it swallows the two Round-1
 * vocabularies — combat's old code table and this module's first draft — and
 * only ever emits canonical ids. Authored tables written against either
 * spelling still load.
 *
 * @deprecated R2 — delete the alias entries in R3 once no table uses them.
 */
export const ENEMY_ID_ALIASES: Readonly<Record<string, string>> = {
  // src/combat/data/enemies.ts, Round 1
  scurry_rats: ENEMY_IDS.sprinter,
  armored_hauler: ENEMY_IDS.hauler,
  scout_bee: ENEMY_IDS.scoutBee,
  sapper_crab: ENEMY_IDS.sapperCrab,
  // this module's first draft
  scavenger: ENEMY_IDS.scavenger,
  sprinter: ENEMY_IDS.sprinter,
  hauler: ENEMY_IDS.hauler,
  demolisher: ENEMY_IDS.sapperCrab,
  mothership: ENEMY_IDS.mothership,
};

export function normalizeEnemyId(id: string): string {
  return ENEMY_ID_ALIASES[id] ?? id;
}

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

/** Preview icons are derived from the canonical id so the two can never drift. */
const meta = (
  id: string,
  cls: EnemyClass,
  air: boolean,
  threat: EnemyWaveMeta['threat'],
  substitute?: string,
): EnemyWaveMeta => ({
  id,
  class: cls,
  icon: `enemy_${id}`,
  air,
  threat,
  ...(substitute ? { substitute } : {}),
});

export const DEFAULT_ENEMY_WAVE_META: Readonly<Record<string, EnemyWaveMeta>> = {
  [ENEMY_IDS.scavenger]: meta(ENEMY_IDS.scavenger, 'basic', false, 'normal'),
  [ENEMY_IDS.sprinter]: meta(ENEMY_IDS.sprinter, 'fast', false, 'normal'),
  [ENEMY_IDS.hauler]: meta(ENEMY_IDS.hauler, 'armored', false, 'normal'),
  [ENEMY_IDS.scoutBee]: meta(ENEMY_IDS.scoutBee, 'flying', true, 'breaker', ENEMY_IDS.sprinter),
  [ENEMY_IDS.sapperCrab]: meta(ENEMY_IDS.sapperCrab, 'sapper', false, 'breaker', ENEMY_IDS.hauler),
  [ENEMY_IDS.repairDrone]: meta(
    ENEMY_IDS.repairDrone,
    'healer',
    false,
    'breaker',
    ENEMY_IDS.scavenger,
  ),
  [ENEMY_IDS.mothership]: meta(ENEMY_IDS.mothership, 'boss', false, 'boss'),
  [ENEMY_IDS.leviathan]: meta(ENEMY_IDS.leviathan, 'boss', false, 'boss'),
};

export function enemyMetaOf(
  id: string,
  table: Readonly<Record<string, EnemyWaveMeta>> = DEFAULT_ENEMY_WAVE_META,
): EnemyWaveMeta {
  return table[id] ?? table[normalizeEnemyId(id)] ?? meta(id, 'basic', false, 'normal');
}

/** Class names accepted wherever an enemy id is, e.g. in `firstAppearance`. */
export const ENEMY_CLASS_NAMES: readonly EnemyClass[] = [
  'basic',
  'fast',
  'armored',
  'flying',
  'sapper',
  'healer',
  'boss',
];

export function isEnemyClass(value: string): value is EnemyClass {
  return (ENEMY_CLASS_NAMES as readonly string[]).includes(value);
}
