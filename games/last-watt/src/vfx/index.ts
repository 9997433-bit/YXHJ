/**
 * `src/vfx` 对外出口。
 *
 * 玩法与战斗层只需要 `VfxSystem` 和 `events.ts` 里的事件名；
 * 其余导出是给引擎（挂场景、遮罩 pass、相机震动）和压测脚本用的。
 */

export { VfxSystem, type VfxSystemOptions } from './VfxSystem';
export {
  VfxPriority,
  type EmitterHandle,
  type Vec3Like,
  type VfxEventMap,
  type VfxEventName,
} from './events';
export {
  ImpactDirector,
  IMPACT_PRESETS,
  ShakeTier,
  type ImpactState,
  type ImpactStats,
} from './ImpactDirector';
export { VfxBudget, VFX_BUDGET, DegradeLevel, type BudgetSnapshot } from './budget';
export {
  GpuParticleSystem,
  Rng,
  type EmitParams,
  type ParticleBlend,
  type ParticleStats,
} from './GpuParticleSystem';
export { DecalManager, type DecalRequest } from './DecalManager';
export {
  ATLAS_SIZE,
  DecalTile,
  ParticleTile,
  buildDecalAtlas,
  buildParticleAtlas,
} from './atlas';
export {
  PALETTE,
  PALETTE_HEX,
  ShapeLanguage,
  boost,
  cssColor,
  hexToRgba,
  withAlpha,
  type PaletteKey,
  type RGBA,
} from './palette';
export { computeShakeOffset } from './cameraShake';
export {
  playFreeze,
  playHammerImpact,
  playIceShatter,
  playOverloadEnd,
  playOverloadStart,
  playUnitDeath,
  type VfxContext,
} from './effects';
