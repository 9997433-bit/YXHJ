import { ParticleTile } from './atlas';
import { DecalTile } from './atlas';
import type { DecalManager } from './DecalManager';
import type { GpuParticleSystem } from './GpuParticleSystem';
import type { VfxBudget } from './budget';
import { IMPACT_PRESETS, ShakeTier, type ImpactDirector } from './ImpactDirector';

import { PALETTE, boost, withAlpha, type RGBA } from './palette';
import { VfxPriority, type Vec3Like } from './events';

/**
 * 效果库：把「一次战场事件」翻译成粒子 + 贴花 + 屏幕冲击的组合。
 *
 * 每个效果只声明**要什么**，能不能拿到由 `VfxBudget` 决定；
 * combo 与事件级效果的 `allow()` 永远返回满额，所以玩法可读性不会被性能降级吃掉。
 */

export interface VfxContext {
  particles: GpuParticleSystem;
  decals: DecalManager;
  impact: ImpactDirector;
  budget: VfxBudget;
}

const UP: Vec3Like = { x: 0, y: 1, z: 0 };
const GRAVITY = { x: 0, y: -14, z: 0 };

/**
 * 冰系配色：亮芯冰白 → 冷青尾。
 *
 * 尾色刻意偏电青而不是直接透明，理由是锈铁地面是暖棕色——
 * 纯白碎片褪色时会经过一段「灰」，在暖底上读成尘土。加一点青能保证
 * 整个生命周期里它都还是「冰」。
 */
const ICE_HOT: RGBA = boost(PALETTE.ice, 2.6);
const ICE_TAIL: RGBA = [
  PALETTE.electric[0] * 0.9,
  PALETTE.electric[1] * 1.1,
  PALETTE.electric[2] * 1.3,
  0,
];
const ICE_COOL: RGBA = withAlpha(PALETTE.ice, 0);

function emit(
  ctx: VfxContext,
  priority: VfxPriority,
  params: Parameters<GpuParticleSystem['emit']>[0],
): number {
  return ctx.particles.emit(params, ctx.budget.allow(priority, params.count));
}

// ---------------------------------------------------------------------------
// 冰碎（GDD 15.2：24 粒带重力旋转冰晶 + 霜痕贴花 3s / 0.5s / 顿帧 60ms / 白闪 1 帧）
// ---------------------------------------------------------------------------

/**
 * 冰碎的可读性立法（Round 3，修 R2 遗留缺陷「近景 Bloom 糊白，碎片不可读」）。
 *
 * 这一发同时有四样东西挤在一格里：实心碎片、亮芯、溅射环、霜屑。R2 的做法是
 * 让它们各自尽量亮，结果亮芯 2.9 格宽、峰值提亮 2.6，加法混合叠在碎片上，
 * Bloom 再把这团能量摊开一圈——`readability.probe.mjs` 实测冰碎后 100ms
 * 有 28% 的近景像素三通道同时顶到 0.9 以上，硬边多面体的边缘能量塌到 0.041。
 *
 * 三条规矩，效果代码往后照抄：
 * 1. **碎片是主角，辉光是配角**：主体走 alpha 层（本来就被遮罩 pass 剔出 Bloom），
 *    并且渲染在加法层之上；亮芯与溅射环用 `bloom` 权重把交给 Bloom 的能量压掉大半。
 * 2. **亮芯先于碎片退场**：它的任务是给「咔嚓」一个视觉锚点，不是照亮现场。
 *    寿命 75ms，在碎片飞开之前就没了，两者不抢同一段时间窗。
 * 3. **峰值留出色调余量**：ACES 会把 >1 的通道全压向白，冰白的蓝调是「这是冰」
 *    的唯一线索，所以碎片本体的峰值刻意压在溢出点以下。
 */
const SHARD_BLOOM = {
  /** 亮芯：只把 45% 的能量交给 Bloom，剩下的留在 beauty pass 里当硬芯 */
  core: 0.45,
  /** 溅射环：细环，辉光一摊开就变成一圈白雾，压到 30% */
  ring: 0.3,
  /** 霜屑：小而多，全额进 Bloom 会在爆点糊出一团奶白 */
  dust: 0.5,
} as const;

export function playIceShatter(
  ctx: VfxContext,
  position: Vec3Like,
  options: { splashRadius?: number; direction?: Vec3Like } = {},
): void {
  const radius = options.splashRadius ?? 1;

  // 1) 主体：24 粒硬边多面体碎片，走 alpha 层——碎片要「实」，不能糊成一坨辉光
  const shardTiles = [ParticleTile.IceShardA, ParticleTile.IceShardB, ParticleTile.IceShardC];
  for (let i = 0; i < shardTiles.length; i++) {
    emit(ctx, VfxPriority.Combo, {
      count: 8,
      position,
      positionJitter: 0.12,
      direction: options.direction ?? UP,
      // 半球偏上：碎片朝天炸开再被重力拽下，读起来才有「壳被打碎」的分量
      coneAngle: Math.PI * 0.62,
      speed: 4.2 * radius,
      speedJitter: 1.8,
      acceleration: GRAVITY,
      drag: 0.9,
      life: 0.5,
      lifeJitter: 0.14,
      // 比 R2 大一档：碎片是这一发唯一要被「看清」的东西，
      // 近景里它得占到足够多的像素，刻面阶梯才分得出来
      sizeStart: 0.4 * radius,
      sizeEnd: 0.3 * radius,
      sizeJitter: 0.45,
      // 0.9 而不是 1.25：图集本身把冰晶的刻面编到了 0.42/0.61/0.85 三档亮度，
      // 再乘一个 >1 的增益，三档会一起越过 ACES 的拐点压成同一个白，
      // 碎片就退化成白纸片。压到 0.9 是让这三档在最终画面里仍然分得开。
      colorStart: boost(PALETTE.ice, 0.9),
      colorEnd: ICE_TAIL,
      // 指数 3：整段寿命里都是实心冰片，只在最后 ~15% 收掉。
      // 线性淡出会让碎片刚出生就半透明，在暖棕地面上退化成一团灰屑。
      colorCurve: 3,
      tile: shardTiles[i],
      randomRotation: true,
      spin: 11,
      blend: 'alpha',
    });
  }

  // 2) 亮芯：75ms 就没的十字辉光，配合白闪给「咔嚓」的听感一个视觉锚。
  // 尺寸从 R2 的 1.5→2.9 格收到 0.4→1.0：它要读成「一个点炸了」，
  // 而不是「这一格被照亮了」——后者正是把碎片盖住的那层白。
  emit(ctx, VfxPriority.Combo, {
    count: 1,
    position,
    life: 0.075,
    sizeStart: 0.4 * radius,
    sizeEnd: 1.0 * radius,
    colorStart: ICE_HOT,
    colorEnd: withAlpha(PALETTE.ice, 0),
    // 亮芯要「炸出来再瞬间消失」，尺寸走 0.5 次方先猛胀
    sizeCurve: 0.5,
    tile: ParticleTile.Flare,
    bloom: SHARD_BLOOM.core,
    blend: 'additive',
  });

  // 3) 溅射环：1 格溅射范围的可读边界（GDD 7.3 冰碎带 1 格溅射）。
  // 环本身是细线，能读出边界；糊白的从来不是这条线，而是它进 Bloom 之后
  // 摊开的那一圈——所以留住线，砍掉辉光。
  emit(ctx, VfxPriority.Combo, {
    count: 1,
    position: { x: position.x, y: position.y + 0.05, z: position.z },
    life: 0.3,
    sizeStart: 0.5 * radius,
    sizeEnd: 2.4 * radius,
    colorStart: boost(PALETTE.ice, 1.15),
    colorEnd: withAlpha(PALETTE.ice, 0),
    sizeCurve: 0.55,
    tile: ParticleTile.Ring,
    bloom: SHARD_BLOOM.ring,
    blend: 'additive',
  });

  // 4) 霜屑：慢速悬浮的细霜，给爆点留 0.9s 余韵。
  // 撒开一点（抖动 0.18 → 0.3）：堆在爆点正中央时，14 颗加法粒子叠起来
  // 等于又给碎片盖了一层白纱
  emit(ctx, VfxPriority.Combo, {
    count: 14,
    position,
    positionJitter: 0.3,
    coneAngle: Math.PI,
    speed: 1.6,
    speedJitter: 0.9,
    acceleration: { x: 0, y: -1.4, z: 0 },
    drag: 2.6,
    life: 0.9,
    lifeJitter: 0.25,
    sizeStart: 0.11,
    sizeEnd: 0.015,
    sizeJitter: 0.4,
    colorStart: boost(PALETTE.ice, 1.6),
    colorEnd: ICE_COOL,
    colorCurve: 1.8,
    tile: ParticleTile.Frost,
    randomRotation: true,
    spin: 4,
    bloom: SHARD_BLOOM.dust,
    blend: 'additive',
  });

  // 5) 霜痕贴花 3s
  ctx.decals.add({
    position: { x: position.x, y: 0.02, z: position.z },
    tile: DecalTile.Frost,
    size: 1.6 * radius,
    rotation: Math.random() * Math.PI * 2,
    color: withAlpha(PALETTE.ice, 0.75),
    life: 3,
    fadeOut: 1.2,
  });

  // 6) 顿帧 60ms + 白闪 1 帧。100ms 内的第二次冰碎只出粒子不出顿帧——立法在 ImpactDirector 里
  ctx.impact.play(IMPACT_PRESETS.iceShatter);
}

// ---------------------------------------------------------------------------
// 冻结（GDD 15.2：敌人材质切冰壳 + 12 粒霜花 / 0.3s）
// ---------------------------------------------------------------------------

export function playFreeze(ctx: VfxContext, position: Vec3Like, radius = 0.5): void {
  emit(ctx, VfxPriority.Combo, {
    count: 12,
    position,
    positionJitter: radius * 0.6,
    coneAngle: Math.PI,
    speed: 1.1,
    speedJitter: 0.5,
    drag: 3.4,
    life: 0.34,
    lifeJitter: 0.08,
    sizeStart: 0.02,
    sizeEnd: 0.2,
    sizeJitter: 0.35,
    colorStart: withAlpha(PALETTE.ice, 0),
    colorEnd: boost(PALETTE.ice, 2),
    tile: ParticleTile.Frost,
    randomRotation: true,
    spin: 2.5,
    blend: 'additive',
  });

  // 冰壳成型的收缩环：从外向内收，和「被封住」的语义一致
  emit(ctx, VfxPriority.Combo, {
    count: 1,
    position,
    life: 0.3,
    sizeStart: radius * 4,
    sizeEnd: radius * 1.6,
    colorStart: withAlpha(PALETTE.ice, 0),
    colorEnd: boost(PALETTE.ice, 1.4),
    tile: ParticleTile.Ring,
    blend: 'additive',
  });
}

// ---------------------------------------------------------------------------
// 冷凝喷雾（循环发射器，GDD 15.2：锥形低速半透明冷雾）
// ---------------------------------------------------------------------------

export interface MistParams {
  position: Vec3Like;
  direction: Vec3Like;
  range: number;
  coneAngle?: number;
}

/** 单帧的雾量。循环发射由 `LoopEmitter` 按 rate 调度，这里只管一次吐几粒。 */
export function emitCondenseMistPuff(ctx: VfxContext, params: MistParams, amount: number): number {
  const cone = params.coneAngle ?? 0.42;
  // 雾要「铺满射程再停住」：初速按射程算，阻尼把它刹在锥尾
  const drag = 2.2;
  const speed = params.range * drag * 0.62;
  // α 0.15–0.35 冰白（VISUAL_BIBLE 10.2）：雾要能被看穿，不许糊掉敌人轮廓

  return emit(ctx, VfxPriority.Persistent, {
    count: amount,
    position: params.position,
    positionJitter: 0.08,
    direction: params.direction,
    coneAngle: cone,
    speed,
    speedJitter: speed * 0.22,
    acceleration: { x: 0, y: -0.35, z: 0 },
    drag,
    life: 0.85,
    lifeJitter: 0.2,
    sizeStart: 0.28,
    sizeEnd: 1.05,
    sizeJitter: 0.3,
    colorStart: withAlpha(PALETTE.ice, 0.34),
    colorEnd: withAlpha(PALETTE.ice, 0),
    tile: ParticleTile.Soft,
    randomRotation: true,
    spin: 0.8,
    // 半透明冷雾走常规混合：加法会让雾在塔口堆成一团白，看不出锥形
    blend: 'alpha',
  });
}

// ---------------------------------------------------------------------------
// 液压破碎锤（占位：GDD 未单列粒子行，按「近程重击」语义给冲击环 + 尘土 + 螺栓）
// ---------------------------------------------------------------------------

export function playHammerImpact(
  ctx: VfxContext,
  position: Vec3Like,
  options: { shockwave?: boolean } = {},
): void {
  const scale = options.shockwave ? 1.55 : 1;

  emit(ctx, VfxPriority.Event, {
    count: 1,
    position: { x: position.x, y: position.y + 0.04, z: position.z },
    life: 0.26,
    sizeStart: 0.35 * scale,
    sizeEnd: 2.1 * scale,
    colorStart: withAlpha(PALETTE.oil, 0.9),
    colorEnd: withAlpha(PALETTE.oil, 0),
    tile: ParticleTile.ShockRing,
    blend: 'alpha',
  });

  emit(ctx, VfxPriority.Event, {
    count: 10,
    position,
    positionJitter: 0.1,
    direction: UP,
    coneAngle: Math.PI * 0.5,
    speed: 3.4 * scale,
    speedJitter: 1.4,
    acceleration: GRAVITY,
    drag: 1.1,
    life: 0.55,
    lifeJitter: 0.15,
    sizeStart: 0.2,
    sizeEnd: 0.12,
    sizeJitter: 0.5,
    colorStart: withAlpha(PALETTE.oil, 1),
    colorEnd: withAlpha(PALETTE.oil, 0),
    tile: ParticleTile.Clod,
    randomRotation: true,
    spin: 7,
    blend: 'alpha',
  });

  emit(ctx, VfxPriority.Event, {
    count: 6,
    position,
    direction: UP,
    coneAngle: Math.PI * 0.7,
    speed: 5,
    speedJitter: 2,
    acceleration: GRAVITY,
    drag: 0.5,
    life: 0.42,
    sizeStart: 0.12,
    sizeEnd: 0.08,
    colorStart: boost(PALETTE.coin, 1.2),
    colorEnd: withAlpha(PALETTE.coin, 0),
    tile: ParticleTile.Bolt,
    randomRotation: true,
    spin: 14,
    blend: 'alpha',
  });

  // 破碎锤**不给顿帧、不给震屏**（VISUAL_BIBLE 10.3）：
  // 打击感来自蓄力节奏 + 目标闪白 + 音效。只有当它把冻结目标打出冰碎时，
  // 才由 playIceShatter 吃那一份事件级冲击——这样 60ms 顿帧才保得住稀缺性。
}

// ---------------------------------------------------------------------------
// 超载 / 过热（占位：GDD 15.2 要求塔身自发光蓝→红 + 环绕电弧 + 扩散电磁环）
// 塔身自发光归模型材质管（R1-O1/O3），这里只出环境粒子部分。
// ---------------------------------------------------------------------------

export function playOverloadStart(ctx: VfxContext, position: Vec3Like, radiusCells = 1.5): void {
  // 扩散电磁环：3×3 影响范围的可读边界
  emit(ctx, VfxPriority.Event, {
    count: 1,
    position: { x: position.x, y: position.y + 0.06, z: position.z },
    life: 0.55,
    sizeStart: 0.6,
    sizeEnd: radiusCells * 2.4,
    colorStart: boost(PALETTE.electric, 2.4),
    colorEnd: withAlpha(PALETTE.electric, 0),
    tile: ParticleTile.Ring,
    blend: 'additive',
  });

  // 环绕电弧的火花：尖刺形状 = 电系，和冰的硬边碎片区分得开
  emit(ctx, VfxPriority.Event, {
    count: 26,
    position,
    positionJitter: 0.3,
    coneAngle: Math.PI,
    speed: 2.6,
    speedJitter: 1.6,
    acceleration: { x: 0, y: 1.2, z: 0 },
    drag: 2.8,
    life: 0.6,
    lifeJitter: 0.25,
    sizeStart: 0.34,
    sizeEnd: 0.05,
    sizeJitter: 0.5,
    colorStart: boost(PALETTE.electric, 2.6),
    colorEnd: withAlpha(PALETTE.electric, 0),
    colorCurve: 2.2,
    tile: ParticleTile.Spike,
    randomRotation: true,
    spin: 9,
    blend: 'additive',
  });
}

/** 过热停机：塔顶白蒸汽 1s + 指示灯熄灭（灯归塔材质管）。 */
export function playOverloadEnd(ctx: VfxContext, position: Vec3Like): void {
  emit(ctx, VfxPriority.Persistent, {
    count: 14,
    position: { x: position.x, y: position.y + 0.5, z: position.z },
    positionJitter: 0.12,
    direction: UP,
    coneAngle: 0.5,
    speed: 1.4,
    speedJitter: 0.5,
    drag: 1.6,
    life: 1,
    lifeJitter: 0.3,
    sizeStart: 0.22,
    sizeEnd: 0.95,
    sizeJitter: 0.3,
    colorStart: [1.1, 1.1, 1.15, 0.5],
    colorEnd: [0.8, 0.85, 0.9, 0],
    tile: ParticleTile.Steam,
    randomRotation: true,
    spin: 0.9,
    blend: 'alpha',
  });
}

/** 敌人死亡溶解的零件粒子（占位，等敌人模型的溶解着色器接上）。 */
export function playUnitDeath(ctx: VfxContext, position: Vec3Like): void {
  emit(ctx, VfxPriority.Persistent, {
    count: 8,
    position,
    direction: UP,
    coneAngle: Math.PI * 0.8,
    speed: 2.4,
    speedJitter: 1.2,
    acceleration: GRAVITY,
    drag: 0.8,
    life: 0.6,
    lifeJitter: 0.2,
    sizeStart: 0.13,
    sizeEnd: 0.09,
    sizeJitter: 0.4,
    colorStart: withAlpha(PALETTE.oil, 1),
    colorEnd: withAlpha(PALETTE.oil, 0),
    tile: ParticleTile.Bolt,
    randomRotation: true,
    spin: 12,
    blend: 'alpha',
  });
}

export { ShakeTier };
