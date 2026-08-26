/**
 * Wave generator (GDD §8.3, §6.1).
 *
 * One base table × per-map multiplier columns → a fully resolved 20-wave plan.
 * The plan is precomputed and immutable: the runtime just plays back timestamps,
 * and the next-wave preview UI reads the very same structure, so what the player
 * is promised is literally what spawns (GDD §17.2 item 3).
 */

import type { MapWaveModifiers, WaveOverrideDef } from '../grid/mapDef';
import type { BaseWaveDef, SpawnGroupDef, WaveTableDef } from './baseWaveTable';
import { BASE_WAVE_TABLE, loadWaveTable } from './baseWaveTable';
import type { EnemyClass, EnemyWaveMeta } from './enemyMeta';
import { DEFAULT_ENEMY_WAVE_META, ENEMY_IDS, enemyMetaOf, isEnemyClass } from './enemyMeta';

export interface GateSchedule {
  id: string;
  openWave: number;
}

export interface WaveEconomyRules {
  /** Wave clear reward = wave × this (GDD §6.1). */
  rewardPerWave: number;
  /** Starting a wave early pays this fraction extra. */
  earlyStartBonus: number;
  /** Bounty decay steps, applied to the last entry whose `afterWave` is passed. */
  bountyDecay: ReadonlyArray<{ afterWave: number; multiplier: number }>;
}

export const DEFAULT_ECONOMY_RULES: WaveEconomyRules = {
  rewardPerWave: 5,
  earlyStartBonus: 0.1,
  bountyDecay: [
    { afterWave: 10, multiplier: 0.8 },
    { afterWave: 15, multiplier: 0.6 },
  ],
};

export interface WavePlanOptions {
  gates: readonly GateSchedule[];
  table?: WaveTableDef;
  modifiers?: MapWaveModifiers;
  enemyMeta?: Readonly<Record<string, EnemyWaveMeta>>;
  economy?: Partial<WaveEconomyRules>;
  /** Count injected when an enemy's first-appearance wave has no group for it. */
  firstAppearanceSquadSize?: number;
}

export interface ResolvedSpawn {
  /** Seconds after the wave starts. */
  time: number;
  enemy: string;
  gateId: string;
  /** Stable sequence number within the wave. */
  ordinal: number;
  hpMultiplier: number;
  speedMultiplier: number;
  bountyMultiplier: number;
}

export interface WavePreviewEntry {
  enemy: string;
  count: number;
  icon: string;
  class: EnemyClass;
  /** Needs anti-air (GDD §14.1 对空警示). */
  air: boolean;
  threat: EnemyWaveMeta['threat'];
}

export interface ResolvedWave {
  wave: number;
  /** Gold paid on clear, before the early-start bonus. */
  reward: number;
  earlyStartBonus: number;
  bountyMultiplier: number;
  hpMultiplier: number;
  speedMultiplier: number;
  /** Ids of the gates this wave actually uses. */
  gateIds: string[];
  spawns: ResolvedSpawn[];
  /** Time of the last spawn; the wave keeps running until the field is clear. */
  spawnDuration: number;
  preview: WavePreviewEntry[];
  isBoss: boolean;
  script?: string;
  note?: string;
}

export type WavePlan = ResolvedWave[];

// ---------------------------------------------------------------------------
// Per-map presets (GDD §8.3)
// ---------------------------------------------------------------------------

/**
 * The three multiplier columns of GDD §8.3, ready to drop into a `MapDef`.
 * Map 1 is the identity column and doubles as the documented baseline.
 */
export const MAP_WAVE_MODIFIER_PRESETS: Readonly<Record<string, MapWaveModifiers>> = {
  map1: {
    hpMultiplier: 1.0,
    countMultipliers: { flying: 1.0, healer: 1.0, sapper: 1.0 },
    firstAppearance: {
      [ENEMY_IDS.scoutBee]: 4,
      [ENEMY_IDS.sapperCrab]: 7,
      [ENEMY_IDS.repairDrone]: 8,
    },
    injectOnFirstAppearance: true,
  },
  map2: {
    hpMultiplier: 1.1,
    countMultipliers: { flying: 1.5, healer: 1.5, sapper: 1.0 },
    firstAppearance: {
      [ENEMY_IDS.scoutBee]: 3,
      [ENEMY_IDS.repairDrone]: 6,
      [ENEMY_IDS.sapperCrab]: 9,
    },
    injectOnFirstAppearance: true,
  },
  map3: {
    hpMultiplier: 1.2,
    countMultipliers: { flying: 1.2, healer: 1.2, sapper: 1.5 },
    firstAppearance: {
      [ENEMY_IDS.scoutBee]: 2,
      [ENEMY_IDS.sapperCrab]: 2,
      [ENEMY_IDS.repairDrone]: 2,
    },
    injectOnFirstAppearance: true,
    waveOverrides: {
      // 波 15 母舰 ×2（同场）
      '15': { countScale: { [ENEMY_IDS.mothership]: 2 } },
      // 波 20 利维坦 HP ×1.2
      '20': { hpMultiplier: 1.2 },
    },
  },
};

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function bountyMultiplierFor(wave: number, rules: WaveEconomyRules): number {
  let multiplier = 1;
  for (const step of rules.bountyDecay) {
    if (wave > step.afterWave) multiplier = step.multiplier;
  }
  return multiplier;
}

/** Gates spawning on a given wave, in declaration order. */
export function gatesOpenAt(gates: readonly GateSchedule[], wave: number): GateSchedule[] {
  const open = gates.filter((gate) => gate.openWave <= wave);
  return open.length > 0 ? open : gates.slice(0, 1);
}

export function buildWavePlan(options: WavePlanOptions): WavePlan {
  const table = loadWaveTable(options.table ?? BASE_WAVE_TABLE);
  const modifiers = options.modifiers ?? {};
  const metaTable = options.enemyMeta ?? DEFAULT_ENEMY_WAVE_META;
  const economy: WaveEconomyRules = { ...DEFAULT_ECONOMY_RULES, ...(options.economy ?? {}) };
  const squadSize = options.firstAppearanceSquadSize ?? 2;

  const ordered = [...table.waves].sort((a, b) => a.wave - b.wave);
  return ordered.map((baseWave) =>
    resolveWave(baseWave, { ...options, economy, squadSize, modifiers, metaTable }),
  );
}

interface ResolveContext {
  gates: readonly GateSchedule[];
  modifiers: MapWaveModifiers;
  metaTable: Readonly<Record<string, EnemyWaveMeta>>;
  economy: WaveEconomyRules;
  squadSize: number;
}

function resolveWave(base: BaseWaveDef, ctx: ResolveContext): ResolvedWave {
  const { modifiers, metaTable, economy } = ctx;
  const override: WaveOverrideDef = modifiers.waveOverrides?.[String(base.wave)] ?? {};

  let groups: SpawnGroupDef[] = (override.replace ?? base.groups).map((group) => ({ ...group }));
  if (override.addGroups) groups.push(...override.addGroups.map((group) => ({ ...group })));

  groups = scaleCounts(groups, override, modifiers, metaTable);
  groups = applyFirstAppearance(groups, base.wave, modifiers, metaTable, ctx.squadSize);

  const gates = gatesOpenAt(ctx.gates, base.wave);
  const hpMultiplier = (modifiers.hpMultiplier ?? 1) * (override.hpMultiplier ?? 1);
  const speedMultiplier = modifiers.speedMultiplier ?? 1;
  const bountyMultiplier = bountyMultiplierFor(base.wave, economy);

  const spawns: ResolvedSpawn[] = [];
  for (const group of groups) {
    const interval = group.interval ?? 1;
    const delay = group.delay ?? 0;
    const pickGates = gateTargets(group, gates);
    for (let i = 0; i < group.count; i += 1) {
      for (const gateId of pickGates(i)) {
        spawns.push({
          time: round3(delay + i * interval),
          enemy: group.enemy,
          gateId,
          ordinal: 0,
          hpMultiplier,
          speedMultiplier,
          bountyMultiplier,
        });
      }
    }
  }

  // Array.prototype.sort is stable, so equal timestamps keep declaration order.
  spawns.sort((a, b) => a.time - b.time);
  spawns.forEach((spawn, index) => {
    spawn.ordinal = index;
  });

  const preview = buildPreview(spawns, metaTable);

  return {
    wave: base.wave,
    reward: base.reward ?? base.wave * economy.rewardPerWave,
    earlyStartBonus: economy.earlyStartBonus,
    bountyMultiplier,
    hpMultiplier,
    speedMultiplier,
    gateIds: gates.map((gate) => gate.id),
    spawns,
    spawnDuration: spawns.length > 0 ? (spawns[spawns.length - 1] as ResolvedSpawn).time : 0,
    preview,
    isBoss: preview.some((entry) => entry.threat === 'boss'),
    script: base.script,
    note: base.note,
  };
}

function scaleCounts(
  groups: SpawnGroupDef[],
  override: WaveOverrideDef,
  modifiers: MapWaveModifiers,
  metaTable: Readonly<Record<string, EnemyWaveMeta>>,
): SpawnGroupDef[] {
  const classMultipliers = modifiers.countMultipliers ?? {};
  const idScales = override.countScale ?? {};

  return groups.map((group) => {
    const meta = enemyMetaOf(group.enemy, metaTable);
    const multiplier = (classMultipliers[meta.class] ?? 1) * (idScales[group.enemy] ?? 1);
    if (multiplier === 1) return group;
    // Never round a squad out of existence: a ×0.5 column thins, it does not cut.
    const count = Math.max(1, Math.round(group.count * multiplier));
    return { ...group, count };
  });
}

/**
 * Per-map unlock schedule (GDD §8.3 「破阵敌首次登场波」).
 *
 * Before an enemy's first-appearance wave its groups fall back to a substitute
 * so the wave keeps its intended pressure; on the exact first-appearance wave a
 * small squad is injected when the base table has none.
 */
function applyFirstAppearance(
  groups: SpawnGroupDef[],
  wave: number,
  modifiers: MapWaveModifiers,
  metaTable: Readonly<Record<string, EnemyWaveMeta>>,
  squadSize: number,
): SpawnGroupDef[] {
  const schedule = modifiers.firstAppearance;
  if (!schedule) return groups;

  // Keys may be an enemy id or a class name, so `{ flying: 4 }` and
  // `{ scout_bee: 4 }` mean the same thing.
  const firstWaveOf = (enemy: string): number | undefined =>
    schedule[enemy] ?? schedule[enemyMetaOf(enemy, metaTable).class];

  const result = groups.map((group) => {
    const first = firstWaveOf(group.enemy);
    if (first === undefined || wave >= first) return group;
    const substitute = enemyMetaOf(group.enemy, metaTable).substitute;
    if (!substitute) return { ...group, count: 0 };
    return { ...group, enemy: substitute };
  });

  const kept = result.filter((group) => group.count > 0);
  if (modifiers.injectOnFirstAppearance === false) return kept;

  for (const [key, first] of Object.entries(schedule)) {
    if (first !== wave) continue;
    const enemy = isEnemyClass(key) ? representativeOf(key, metaTable) : key;
    if (!enemy) continue;
    if (kept.some((group) => group.enemy === enemy)) continue;
    kept.push({ enemy, count: squadSize, interval: 5, delay: 4 });
  }
  return kept;
}

/** The enemy a class-keyed schedule entry should inject. */
function representativeOf(
  cls: EnemyClass,
  metaTable: Readonly<Record<string, EnemyWaveMeta>>,
): string | null {
  for (const meta of Object.values(metaTable)) {
    if (meta.class === cls) return meta.id;
  }
  return null;
}

/**
 * Resolves a group's `gate` field into "which gates does spawn #i come from".
 * A fixed gate index that has not opened yet falls back to the last open one,
 * so a boss authored for gate 2 still shows up on a map where it opens late.
 */
function gateTargets(group: SpawnGroupDef, gates: GateSchedule[]): (spawnIndex: number) => string[] {
  const mode = group.gate ?? 'spread';

  if (typeof mode === 'number') {
    const gate = gates[Math.min(Math.max(mode, 0), gates.length - 1)] as GateSchedule;
    return () => [gate.id];
  }

  if (mode === 'all') {
    const ids = gates.map((gate) => gate.id);
    return () => ids;
  }

  return (spawnIndex) => [(gates[spawnIndex % gates.length] as GateSchedule).id];
}

function buildPreview(
  spawns: readonly ResolvedSpawn[],
  metaTable: Readonly<Record<string, EnemyWaveMeta>>,
): WavePreviewEntry[] {
  const counts = new Map<string, number>();
  for (const spawn of spawns) counts.set(spawn.enemy, (counts.get(spawn.enemy) ?? 0) + 1);

  const entries: WavePreviewEntry[] = [];
  for (const [enemy, count] of counts) {
    const meta = enemyMetaOf(enemy, metaTable);
    entries.push({ enemy, count, icon: meta.icon, class: meta.class, air: meta.air, threat: meta.threat });
  }

  // Bosses first, then breakers, then the rest — matches the HUD read order.
  const rank = (entry: WavePreviewEntry): number =>
    entry.threat === 'boss' ? 0 : entry.threat === 'breaker' ? 1 : 2;
  entries.sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.enemy.localeCompare(b.enemy));
  return entries;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
