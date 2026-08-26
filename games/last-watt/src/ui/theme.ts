import { PALETTE_HEX, cssColor } from '../vfx/palette';

/**
 * HUD 设计令牌。
 *
 * 两条来自 VISUAL_BIBLE 10.4 的硬约束：
 * 1. **UI 发光自带**，不依赖后处理 Bloom——画质降级、关掉 post 之后 HUD 观感不变；
 * 2. 颜色只能取自第 15.2 章立法色，UI 与粒子共用一套语义（`../vfx/palette`）。
 */

export const COLORS = {
  electric: PALETTE_HEX.electric,
  fire: PALETTE_HEX.fire,
  ice: PALETTE_HEX.ice,
  oil: PALETTE_HEX.oil,
  coin: PALETTE_HEX.coin,
  alert: PALETTE_HEX.alert,
} as const;

/** 自发光档位（VISUAL_BIBLE：E0 熄灭 / E1 待机 / E2 活跃 / E3 事件）。 */
export const EMISSIVE = {
  off: 0,
  idle: 1.2,
  active: 2.5,
  event: 5,
} as const;

export const css = { color: cssColor };

/**
 * 用三层 box-shadow 伪造自发光：内芯 + 中晕 + 外辉。
 * 单层 shadow 会得到一圈生硬的光边，读起来像贴纸而不是灯。
 */
export function glow(hex: string, strength = 1): string {
  const c = (a: number) => hexToCss(hex, a);
  return [
    `0 0 ${2 * strength}px ${c(0.9)}`,
    `0 0 ${7 * strength}px ${c(0.55)}`,
    `0 0 ${18 * strength}px ${c(0.3)}`,
  ].join(', ');
}

export function textGlow(hex: string, strength = 1): string {
  const c = (a: number) => hexToCss(hex, a);
  return `0 0 ${3 * strength}px ${c(0.8)}, 0 0 ${12 * strength}px ${c(0.4)}`;
}

export function hexToCss(hex: string, alpha = 1): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
