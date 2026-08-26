/**
 * 图 1「主厂房」— greybox layout (GDD §5.2).
 *
 * PROVISIONAL. This is a systems-first greybox that exercises every mechanic the
 * grid/pathing/engineering code has to support; final level design belongs in
 * `data/`. What it is built to teach, in GDD order:
 *
 *  - 挖沟封捷径: the cross-link at (8,2) shortens the serpentine from 44 to 32
 *    steps. One dig there puts the full 44-step walk back and is legal because
 *    the loop survives.
 *  - 搭桥引怪: the ravine on row 5 gaps a would-be corridor at (11,5). Bridging
 *    that single cell cuts the walk to 22 steps — the player opens it precisely
 *    when the middle is where their guns are.
 *  - 丢 B 区开支路: the `sluice_b` barrier (15,3)–(16,5) is a 21-step straight
 *    shot into the core. When integrity drops to 50 it opens and every tower
 *    lined up along the serpentine is suddenly aimed at nothing.
 *  - Second gate at wave 10, engineering quota 挖沟 3 / 搭桥 2 with one extra
 *    dig at wave 15.
 *
 * Layout legend (see `grid/mapDef.ts`):
 *   `.` ground  `#` rock  `=` path  `d` diggable road  `~` puddle  `,` soft soil
 *   `v` trench  `w` water  `C` core  `1`/`2` gates  `L` barrier group 0
 */

import type { MapDef } from '../grid/mapDef';
import { MAP_WAVE_MODIFIER_PRESETS } from '../waves/waveGenerator';

/**
 * 20×12. Column ruler:            0123456789012345678901
 */
const LAYOUT = [
  /*  0 */ '....................',
  /*  1 */ '1==============...,,',
  /*  2 */ '........d.....=.....',
  /*  3 */ '...=========d==LL...',
  /*  4 */ '...=.......=....L...',
  /*  5 */ ',,.=....vvvvvv..LCC.',
  /*  6 */ ',..==d====~~d====CC.',
  /*  7 */ '...=............=...',
  /*  8 */ '...===d======~===...',
  /*  9 */ '......,,.=..........',
  /* 10 */ '2=========..........',
  /* 11 */ '....................',
];

export const MAP1_POWERHOUSE: MapDef = {
  id: 'map1_powerhouse',
  name: '主厂房',
  cols: 20,
  rows: 12,
  layout: LAYOUT,
  gates: [
    { id: 'gate_north', openWave: 1, label: '北侧破口' },
    { id: 'gate_south', openWave: 10, label: '南侧破口' },
  ],
  barriers: [
    {
      id: 'sluice_b',
      openTerrain: 'path',
    },
  ],
  zones: [
    {
      id: 'A',
      label: 'A 变电区',
      // The pocket between the two northern lanes — prime tower real estate.
      rects: [{ cx: 3, cy: 2, w: 11, h: 1 }],
      triggerIntegrity: 80,
      powerPenalty: 4,
    },
    {
      id: 'B',
      label: 'B 变电区',
      // The southern pocket, plus the sluice that opens when it is lost.
      rects: [{ cx: 4, cy: 7, w: 9, h: 1 }],
      triggerIntegrity: 50,
      powerPenalty: 6,
      opensBarrier: 'sluice_b',
    },
  ],
  engineering: {
    digQuota: 3,
    bridgeQuota: 2,
    grants: [{ wave: 15, dig: 1 }],
  },
  waveModifiers: MAP_WAVE_MODIFIER_PRESETS.map1,
  notes: [
    '教学职责：完整教会核心循环与 4 combo（GDD §5.2）',
    '默认路线 32 步；挖 (8,2) 变 44 步；桥 (11,5) 变 22 步；开闸后 21 步',
    '正式关卡数据应迁到 data/，本文件仅为可运行灰盒',
  ],
};
