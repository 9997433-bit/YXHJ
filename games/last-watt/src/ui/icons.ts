import { svg } from './dom';

/**
 * HUD 图标。
 *
 * GDD 18.1 要求「图标形状与粒子语言一致」：冰是硬边多面体、火是软边火舌、
 * 电是折线尖刺、超载是扩散圆环、经济是圆点。色弱玩家靠形状也能读出系统归属，
 * 所以下面每个 path 的轮廓都刻意贴着 `ShapeLanguage` 走，不用通用图标库。
 *
 * 全部 24×24 viewBox，`currentColor` 取色，尺寸由 CSS 决定。
 */

export type IconName =
  // 建造项（GDD 7.1 七塔 + 发电机）
  | 'tower-rivet'
  | 'tower-tar'
  | 'tower-hammer'
  | 'tower-condenser'
  | 'tower-flamer'
  | 'tower-tesla'
  | 'tower-capacitor'
  | 'building-generator'
  // 敌人预览（GDD 8.1）
  | 'enemy-bug'
  | 'enemy-rat'
  | 'enemy-hauler'
  | 'enemy-bee'
  | 'enemy-sapper'
  | 'enemy-medic'
  | 'enemy-boss'
  // 工程与大招
  | 'eng-dig'
  | 'eng-bridge'
  | 'ability-overload'
  // 状态（与粒子形状一一对应）
  | 'status-wet'
  | 'status-oil'
  | 'status-frozen'
  | 'status-burning'
  | 'flag-air';

interface IconDef {
  /** 主轮廓，用 fill */
  fill?: string;
  /** 细节线条，用 stroke */
  stroke?: string;
  strokeWidth?: number;
}

const ICONS: Record<IconName, IconDef> = {
  // --- 塔：机械剪影，方硬为主，和有机的敌人轮廓区分 ---
  'tower-rivet': {
    fill: 'M9 3h6v4h-2v2h6v3h-6v9H9v-9H3V9h6V7H7V3z',
  },
  'tower-tar': {
    fill: 'M12 2 6 9h12z M4 12h16v3H4z',
    stroke: 'M6 18h1.5M10.5 18H12M15 18h1.5M6 21h1.5M10.5 21H12M15 21h1.5',
    strokeWidth: 1.6,
  },
  'tower-hammer': {
    fill: 'M4 3h10v6H4z M8 9h2v12H8z',
    stroke: 'M15 6h5',
    strokeWidth: 2,
  },
  // 冷凝：硬边六角 + 锥形雾口
  'tower-condenser': {
    fill: 'M12 2l4 3v6l-4 3-4-3V5z',
    stroke: 'M12 14v7M7 17l-3 4M17 17l3 4',
    strokeWidth: 1.7,
  },
  // 火：软边火舌
  'tower-flamer': {
    fill: 'M13 2c0 4-5 4-5 9a4.6 4.6 0 0 0 9 .3C17 8 13 7 13 2z M9 21h8v2H9z',
  },
  // 电：折线
  'tower-tesla': {
    fill: 'M13 2 7 12h4l-2 10 8-12h-4l3-8z',
    stroke: 'M5 22h14',
    strokeWidth: 1.8,
  },
  // 超载：扩散圆环
  'tower-capacitor': {
    fill: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
    stroke: 'M12 3a9 9 0 0 1 0 18 9 9 0 0 1 0-18',
    strokeWidth: 1.6,
  },
  'building-generator': {
    fill: 'M4 8h16v11H4z',
    stroke: 'M8 8V4h8v4M9 13h6M12 11v4',
    strokeWidth: 1.7,
  },

  // --- 敌人：圆钝有机剪影 ---
  'enemy-bug': {
    fill: 'M12 5a5 6 0 0 1 5 6v4a5 5 0 0 1-10 0v-4a5 6 0 0 1 5-6z',
    stroke: 'M7 9 3 6M17 9l4-3M7 16l-4 3M17 16l4 3',
    strokeWidth: 1.6,
  },
  'enemy-rat': {
    fill: 'M14 8a5 4 0 0 1 0 8H8a4 4 0 0 1 0-8z',
    stroke: 'M14 12h7M4 10l-2-2M4 14l-2 2',
    strokeWidth: 1.7,
  },
  'enemy-hauler': {
    fill: 'M3 8h13l5 4v5H3z',
    stroke: 'M7 20a2 2 0 1 1 0-4 2 2 0 0 1 0 4M17 20a2 2 0 1 1 0-4 2 2 0 0 1 0 4',
    strokeWidth: 1.6,
  },
  'enemy-bee': {
    fill: 'M12 9a3 4 0 0 1 0 8 3 4 0 0 1 0-8z',
    stroke: 'M9 10 3 5M15 10l6-5M12 17v4',
    strokeWidth: 1.7,
  },
  'enemy-sapper': {
    fill: 'M12 7a5 5 0 0 1 5 5v5H7v-5a5 5 0 0 1 5-5z',
    stroke: 'M12 7V3M9 3h6M4 19l3-2M20 19l-3-2',
    strokeWidth: 1.7,
  },
  // 治疗：扳手，GDD 8.1 明确要求头顶扳手图标
  'enemy-medic': {
    fill: 'M16 3a5 5 0 0 0-4.6 7L4 17.4 6.6 20l7.4-7.4A5 5 0 0 0 21 8l-3 3-2-2 3-3a5 5 0 0 0-3-3z',
  },
  'enemy-boss': {
    fill: 'M3 10h4l2-3h6l2 3h4v8H3z',
    stroke: 'M8 18v3M16 18v3M12 7V4',
    strokeWidth: 1.8,
  },

  // --- 工程 / 大招 ---
  'eng-dig': {
    fill: 'M10 2h4v7h-4z',
    stroke: 'M12 9v6M4 21c2-4 4-6 8-6s6 2 8 6',
    strokeWidth: 1.9,
  },
  'eng-bridge': {
    fill: 'M2 11h20v2H2z',
    stroke: 'M4 13v7M20 13v7M8 13c0-2 8-2 8 0',
    strokeWidth: 1.8,
  },
  'ability-overload': {
    fill: 'M13 2 6 13h5l-2 9 9-13h-5z',
    stroke: 'M3 12a9 9 0 0 1 3-6.7M21 12a9 9 0 0 1-3 6.7',
    strokeWidth: 1.5,
  },

  // --- 状态：形状严格对齐粒子语言 ---
  // 湿 = 圆点流
  'status-wet': { fill: 'M12 3c3.5 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6 6-11z' },
  // 油 = 圆点 + 铺开的洼
  'status-oil': {
    fill: 'M12 4c2.5 3.5 4 5.5 4 7.5a4 4 0 0 1-8 0C8 9.5 9.5 7.5 12 4z',
    stroke: 'M3 18c3 1.5 15 1.5 18 0',
    strokeWidth: 2,
  },
  // 冻 = 硬边多面体
  'status-frozen': { fill: 'M12 2l3.2 2.6-1 4.1 4-1.2L20 11l-3.4 1.4L20 15l-1.8 3.5-4-1.2 1 4.1L12 22l-3.2-2.6 1-4.1-4 1.2L4 15l3.4-2L4 11l1.8-3.5 4 1.2-1-4.1z' },
  // 燃 = 软边火舌
  'status-burning': { fill: 'M13 2c.4 4-4.5 4.6-4.5 9.5a4.5 4.5 0 0 0 9 0C17.5 8.5 13.6 7.4 13 2z' },
  // 对空标记 = 向上的尖刺，和电系尖刺同族
  'flag-air': { fill: 'M12 3l4 7h-3v6h-2v-6H8z', stroke: 'M6 20h12', strokeWidth: 1.8 },
};

export function createIcon(name: IconName, className = ''): SVGSVGElement {
  const def = ICONS[name];
  const root = svg('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  if (className) root.setAttribute('class', className);

  if (def.fill) {
    root.append(svg('path', { d: def.fill, fill: 'currentColor' }));
  }
  if (def.stroke) {
    root.append(
      svg('path', {
        d: def.stroke,
        stroke: 'currentColor',
        'stroke-width': def.strokeWidth ?? 1.6,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        fill: 'none',
      }),
    );
  }
  return root;
}
