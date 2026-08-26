/**
 * `src/combat` — towers, enemies, statuses and the data-driven reaction table.
 *
 * Public surface for the rest of the game. Import from here, not from files
 * inside the module.
 *
 *   const combat = new CombatSystem({ terrain, movement, power });
 *   combat.buildTower('hydraulic_hammer', { cx: 4, cy: 6 });
 *   combat.spawnEnemy('armored_hauler', { position, path });
 *   combat.update(dt);
 */

export { CombatSystem, type CombatSystemOptions } from './combatSystem';
export {
  CombatStats,
  resolveArmor,
  type DamageRequest,
  type DamageResult,
} from './damage';
export {
  CombatEventBus,
  type CombatEventListener,
  type CombatEventMap,
  type CombatEventName,
} from './events';
export { CoatingField, type CoatingExpiry } from './terrain';
export {
  InfiniteBattery,
  OpenFieldTerrain,
  PolylineMovement,
  type MovementDriver,
  type PowerSupply,
  type TerrainQuery,
} from './ports';

export { Enemy, type EnemySpawnOptions } from './entities/enemy';
export type { DeathSpawn, EnemyBehaviour, EnemyDef, EnemyPhase } from './entities/enemyDef';
export { Tower, type TowerState } from './entities/tower';
export { patchTowerDef } from './entities/towerDef';
export type {
  ActivationDef,
  AttackDef,
  BuildingEffects,
  ChainAttack,
  ConeAttack,
  MeleeAttack,
  PaintAttack,
  ProjectileAttack,
  StatusApplication,
  TowerDef,
  UpgradeDef,
  UpgradePatch,
} from './entities/towerDef';
export type { Projectile } from './entities/projectile';

export { StatusRegistry, type StatusDef, type StatusInstance, type StatusModifiers } from './status/statusDef';
export { StatusSet, type StatusApplyResult } from './status/statusSet';

export { ReactionEngine } from './reaction/engine';
export { evaluateCondition } from './reaction/conditions';
export { executeEffect, resolveNumber } from './reaction/effects';
export type {
  ConditionSpec,
  EffectSpec,
  NumberSource,
  ReactionRow,
  ReactionTable,
} from './reaction/spec';
export type {
  AttackSource,
  MutableHit,
  ReactionContext,
  ReactionRuntime,
} from './reaction/context';

export {
  ContentRegistry,
  DEFAULT_CONTENT,
  ENEMY_DEFS,
  PALETTE,
  REACTION_PARAMS,
  REACTION_TABLE,
  STATUS_DEFS,
  TOWER_DEFS,
  UPGRADE_DEFS,
  type CombatContent,
} from './data';

export {
  acquireTarget,
  enemiesInCone,
  enemiesInRadius,
  nearestEnemy,
} from './targeting';

export * from './types';
export { createIceShatterScenario, runIceShatterProbe, type ShatterProbeReport } from './scenarios';
