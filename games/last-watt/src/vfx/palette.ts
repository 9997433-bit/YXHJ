/**
 * 粒子语言立法（GDD 15.2）。
 *
 * 颜色与形状是《余电》的战场信息通道：同色不同系统靠形状区分，
 * 因此所有 VFX / UI 取色必须从这里取，禁止在效果里写死十六进制。
 */

export type RGBA = readonly [number, number, number, number];

/** 线性空间比对 sRGB 更适合做加法混合的粒子叠加，转换在这里一次性完成。 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToRgba(hex: string, alpha = 1, linear = true): RGBA {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return linear
    ? [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), alpha]
    : [r, g, b, alpha];
}

/** 六色立法。键名即 GDD 中的语义，不要按“好看”临时改。 */
export const PALETTE_HEX = {
  /** 电青：电力 / 导电 / 超载 / 大招 */
  electric: '#35E0FF',
  /** 橙红：火 / 自爆 */
  fire: '#FF7A29',
  /** 冰白：冰 / 碎裂 */
  ice: '#BFF7FF',
  /** 焦褐：油渍 / 尘土 */
  oil: '#6B4A2B',
  /** 金黄：金币 */
  coin: '#FFD84D',
  /** 警红：丢区 / 核心受损 */
  alert: '#FF3B30',
} as const;

export type PaletteKey = keyof typeof PALETTE_HEX;

export const PALETTE: Record<PaletteKey, RGBA> = {
  electric: hexToRgba(PALETTE_HEX.electric),
  fire: hexToRgba(PALETTE_HEX.fire),
  ice: hexToRgba(PALETTE_HEX.ice),
  oil: hexToRgba(PALETTE_HEX.oil),
  coin: hexToRgba(PALETTE_HEX.coin),
  alert: hexToRgba(PALETTE_HEX.alert),
};

/** 形状立法：每个系统的粒子轮廓必须可在静帧里被认出来。 */
export enum ShapeLanguage {
  /** 冰 = 硬边多面体碎片 */
  IceShard = 'ice-shard',
  /** 火 = 软边翻页火舌 */
  FireTongue = 'fire-tongue',
  /** 电 = 折线与尖刺火花 */
  ElectricSpike = 'electric-spike',
  /** 超载 = 扩散圆环 */
  Ring = 'ring',
  /** 经济 = 圆点飞行流 */
  Dot = 'dot',
  /** 环境 = 软烟/雾/尘 */
  Soft = 'soft',
}

export function withAlpha(color: RGBA, alpha: number): RGBA {
  return [color[0], color[1], color[2], alpha];
}

/** 把颜色整体提亮，用于自发光峰值（Bloom 只吃自发光，>1 才会溢出辉光）。 */
export function boost(color: RGBA, gain: number): RGBA {
  return [color[0] * gain, color[1] * gain, color[2] * gain, color[3]];
}

/** UI 侧需要 sRGB 字符串（CSS 不吃线性值）。 */
export function cssColor(key: PaletteKey, alpha = 1): string {
  const [r, g, b] = hexToRgba(PALETTE_HEX[key], 1, false);
  const to255 = (v: number) => Math.round(v * 255);
  return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${alpha})`;
}
