/**
 * VFX 事件契约。
 *
 * 战斗 / 玩法 / 工程系统只发事件，不碰粒子。任何一方想加演出，
 * 先在这里加一条事件，再在 `effects/` 里实现，避免 gameplay 代码里长出粒子调用。
 *
 * 约定：坐标一律是世界坐标（表现层 3D），网格坐标由调用方先换算。
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 效果优先级。预算不足时按这个顺序丢弃（GDD 15.3）。 */
export enum VfxPriority {
  /** 环境氛围：第一个被砍 */
  Ambient = 0,
  /** 持续状态（湿/油/冷雾）：可降发射率 */
  Persistent = 1,
  /** combo 反馈：永不降级 */
  Combo = 2,
  /** 关键事件（丢区、大招、Boss）：永不降级 */
  Event = 3,
}

export interface VfxEventMap {
  /** 冻结成立：湿冷叠满 3 层 */
  freeze: { position: Vec3Like; radius?: number };
  /** 冰碎：冻结目标吃到 ≥40 单发 */
  'ice-shatter': { position: Vec3Like; splashRadius?: number; direction?: Vec3Like };
  /** 冷凝喷雾：锥形循环发射器，返回句柄用于停止 */
  'condense-mist': { position: Vec3Like; direction: Vec3Like; range: number; coneAngle?: number };
  /** 液压破碎锤命中 */
  'hammer-impact': { position: Vec3Like; shockwave?: boolean };
  /** 电容站超载开始 */
  'overload-start': { position: Vec3Like; radiusCells?: number };
  /** 超载结束（过热停机白蒸汽） */
  'overload-end': { position: Vec3Like };
  /** 敌人死亡溶解的零件粒子 */
  'unit-death': { position: Vec3Like };
}

export type VfxEventName = keyof VfxEventMap;

/** 循环类效果返回的句柄；一次性效果返回 null。 */
export interface EmitterHandle {
  readonly id: number;
  readonly alive: boolean;
  /** 每帧跟随塔口/敌人移动 */
  setTransform(position: Vec3Like, direction?: Vec3Like): void;
  stop(): void;
}
