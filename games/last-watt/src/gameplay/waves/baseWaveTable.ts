/**
 * The single 20-wave base table (GDD §8.3): "同一份基础波表（20 波）套用权重乘
 * 区，不为每图手写全新波表。"
 *
 * PROVISIONAL — these counts are a playable first pass derived from the §11
 * tutorial script and the §12 difficulty curve. Once `data/` ships an authored
 * table, drop it in through `loadWaveTable()`; the generator does not care where
 * the numbers come from.
 *
 * Shape of a wave: spawn groups run in parallel, each with its own start delay
 * and spacing, which is what makes a wave read as "a mixed formation" instead of
 * a queue.
 */

import { ENEMY_IDS } from './enemyMeta';

export interface SpawnGroupDef {
  enemy: string;
  count: number;
  /** Seconds between two spawns of this group. */
  interval?: number;
  /** Seconds after the wave starts before the first spawn. */
  delay?: number;
  /**
   * `'spread'` (default) round-robins over the gates open on that wave,
   * `'all'` sends the full count through every open gate, a number picks one.
   */
  gate?: number | 'all' | 'spread';
}

export interface BaseWaveDef {
  wave: number;
  groups: SpawnGroupDef[];
  /** Overrides the computed `wave × 5` reward (GDD §6.1). */
  reward?: number;
  /** Tutorial beat id for the §11 scripted waves. */
  script?: string;
  note?: string;
}

export interface WaveTableDef {
  id: string;
  waves: BaseWaveDef[];
}

const S = ENEMY_IDS;

export const BASE_WAVE_TABLE: WaveTableDef = {
  id: 'base_20',
  waves: [
    {
      wave: 1,
      script: 'tutorial_place_tower',
      note: '必赢，建立「击杀 = 金币」直觉',
      groups: [{ enemy: S.scavenger, count: 8, interval: 1.4 }],
    },
    {
      wave: 2,
      script: 'tutorial_leak_is_not_death',
      note: '纯机枪必漏 2–3 只；波末解锁焦油塔',
      groups: [{ enemy: S.sprinter, count: 12, interval: 1.0 }],
    },
    {
      wave: 3,
      script: 'tutorial_power_and_shatter',
      note: '机枪刮痧 → 解锁发电机/冷凝/破碎锤，教冰碎',
      groups: [
        { enemy: S.hauler, count: 2, interval: 6, delay: 2 },
        { enemy: S.scavenger, count: 6, interval: 1.6 },
      ],
    },
    {
      wave: 4,
      script: 'tutorial_anti_air',
      note: '首次飞行；机枪即可解题',
      groups: [
        { enemy: S.scoutBee, count: 3, interval: 2.0, delay: 3 },
        { enemy: S.scavenger, count: 8, interval: 1.4 },
      ],
    },
    {
      wave: 5,
      script: 'tutorial_free_dig',
      note: '侧墙炸开，赠送 1 次挖沟；波末大招充能满',
      groups: [
        { enemy: S.scavenger, count: 10, interval: 1.2 },
        { enemy: S.sprinter, count: 8, interval: 0.8, delay: 8 },
      ],
    },
    {
      wave: 6,
      script: 'tutorial_oil_fire',
      note: '油渍 + 火焰塔图纸组合节拍',
      groups: [
        { enemy: S.scavenger, count: 12, interval: 1.1 },
        { enemy: S.hauler, count: 2, interval: 6, delay: 4 },
      ],
    },
    {
      wave: 7,
      note: '拆迁蟹首秀（图 1）',
      groups: [
        { enemy: S.scavenger, count: 10, interval: 1.2 },
        { enemy: S.sapperCrab, count: 2, interval: 7, delay: 4 },
      ],
    },
    {
      wave: 8,
      script: 'tutorial_conduct',
      note: '水洼旁解锁特斯拉；治疗无人机首秀',
      groups: [
        { enemy: S.sprinter, count: 14, interval: 0.8 },
        { enemy: S.scoutBee, count: 4, interval: 1.8, delay: 2 },
        { enemy: S.repairDrone, count: 2, interval: 6, delay: 5 },
      ],
    },
    {
      wave: 9,
      note: '第一压力峰收口：拆 + 厚混编',
      groups: [
        { enemy: S.scavenger, count: 12, interval: 1.0 },
        { enemy: S.hauler, count: 3, interval: 5, delay: 3 },
        { enemy: S.sapperCrab, count: 2, interval: 7, delay: 6 },
      ],
    },
    {
      wave: 10,
      script: 'second_gate_opens',
      note: '重构点：第二出怪口 + 拆迁蟹潮',
      groups: [
        { enemy: S.scavenger, count: 14, interval: 0.9 },
        { enemy: S.sprinter, count: 10, interval: 0.7, delay: 4 },
        { enemy: S.sapperCrab, count: 5, interval: 3.5, delay: 6 },
      ],
    },
    {
      wave: 11,
      groups: [
        { enemy: S.scavenger, count: 12, interval: 0.9 },
        { enemy: S.hauler, count: 4, interval: 4.5, delay: 1 },
        { enemy: S.scoutBee, count: 5, interval: 1.6, delay: 3 },
      ],
    },
    {
      wave: 12,
      groups: [
        { enemy: S.sprinter, count: 18, interval: 0.6 },
        { enemy: S.repairDrone, count: 3, interval: 5, delay: 4 },
        { enemy: S.sapperCrab, count: 3, interval: 4, delay: 8 },
      ],
    },
    {
      wave: 13,
      groups: [
        { enemy: S.scavenger, count: 16, interval: 0.8 },
        { enemy: S.hauler, count: 4, interval: 4, delay: 2 },
        { enemy: S.scoutBee, count: 6, interval: 1.5, delay: 4 },
      ],
    },
    {
      wave: 14,
      groups: [
        { enemy: S.sprinter, count: 20, interval: 0.55 },
        { enemy: S.hauler, count: 2, interval: 6, delay: 2 },
        { enemy: S.sapperCrab, count: 4, interval: 3.5, delay: 3 },
        { enemy: S.repairDrone, count: 3, interval: 5, delay: 6 },
      ],
    },
    {
      wave: 15,
      script: 'boss_mothership',
      note: '小 Boss：修理母舰，考集火与超载时机',
      groups: [
        { enemy: S.mothership, count: 1, gate: 0 },
        { enemy: S.scavenger, count: 12, interval: 1.0, delay: 2 },
        { enemy: S.hauler, count: 3, interval: 5, delay: 4 },
      ],
    },
    {
      wave: 16,
      groups: [
        { enemy: S.sprinter, count: 20, interval: 0.55 },
        { enemy: S.scoutBee, count: 8, interval: 1.3, delay: 2 },
        { enemy: S.sapperCrab, count: 3, interval: 4, delay: 6 },
      ],
    },
    {
      wave: 17,
      groups: [
        { enemy: S.scavenger, count: 18, interval: 0.7 },
        { enemy: S.hauler, count: 6, interval: 3.5, delay: 2 },
        { enemy: S.repairDrone, count: 4, interval: 4.5, delay: 5 },
      ],
    },
    {
      wave: 18,
      groups: [
        { enemy: S.sprinter, count: 22, interval: 0.5 },
        { enemy: S.scoutBee, count: 8, interval: 1.3, delay: 2 },
        { enemy: S.sapperCrab, count: 5, interval: 3, delay: 5 },
      ],
    },
    {
      wave: 19,
      groups: [
        { enemy: S.scavenger, count: 20, interval: 0.6 },
        { enemy: S.hauler, count: 6, interval: 3.5, delay: 2 },
        { enemy: S.repairDrone, count: 4, interval: 4.5, delay: 4 },
        { enemy: S.sapperCrab, count: 4, interval: 3.5, delay: 8 },
      ],
    },
    {
      wave: 20,
      script: 'boss_leviathan',
      note: '大 Boss：利维坦，抵达核心即失败',
      groups: [
        { enemy: S.leviathan, count: 1, gate: 0 },
        { enemy: S.hauler, count: 4, interval: 4, delay: 3 },
        { enemy: S.scoutBee, count: 6, interval: 1.5, delay: 6 },
        { enemy: S.sapperCrab, count: 4, interval: 4, delay: 12 },
      ],
    },
  ],
};

export class WaveTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaveTableError';
  }
}

export function validateWaveTable(table: WaveTableDef): string[] {
  const problems: string[] = [];
  if (table.waves.length === 0) problems.push('wave table is empty');

  const seen = new Set<number>();
  for (const wave of table.waves) {
    if (seen.has(wave.wave)) problems.push(`duplicate wave ${wave.wave}`);
    seen.add(wave.wave);
    if (wave.wave < 1) problems.push(`wave numbers start at 1, found ${wave.wave}`);
    if (wave.groups.length === 0) problems.push(`wave ${wave.wave} has no spawn groups`);
    for (const group of wave.groups) {
      if (group.count <= 0) problems.push(`wave ${wave.wave}: group "${group.enemy}" has count <= 0`);
      if ((group.interval ?? 1) < 0) problems.push(`wave ${wave.wave}: negative interval`);
      if ((group.delay ?? 0) < 0) problems.push(`wave ${wave.wave}: negative delay`);
    }
  }
  return problems;
}

export function loadWaveTable(table: WaveTableDef): WaveTableDef {
  const problems = validateWaveTable(table);
  if (problems.length > 0) {
    throw new WaveTableError(`invalid wave table "${table.id}":\n  - ${problems.join('\n  - ')}`);
  }
  return table;
}
