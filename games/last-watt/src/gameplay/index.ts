/**
 * `src/gameplay` public API — grid, pathing, engineering, waves.
 *
 * Owns: the board and its terrain, ground pathing, dig/bridge legality and
 * timers, substation zones and sluices, and the wave schedule.
 *
 * Does not own: towers and enemies (`src/combat`), cell coatings (combat),
 * gold / power / core integrity (economy), rendering (`src/engine`, `src/vfx`).
 *
 * Quick start:
 * ```ts
 * import { createGameplayWorld, MAP1_POWERHOUSE } from './gameplay';
 *
 * const world = createGameplayWorld({ map: MAP1_POWERHOUSE, getGold: () => wallet.gold });
 * world.events.on('wave_spawn', (request) => combat.spawn(request));
 * world.startWave();
 * // every fixed step:
 * world.tick(1 / 60);
 * ```
 */

// --- Value types -----------------------------------------------------------
export type {
  CellCoord,
  CellData,
  Rect,
  Seconds,
  TerrainCode,
  TerrainName,
  TerrainTraits,
  Vec2,
} from './types';
export {
  CellFlag,
  TERRAIN_CODES,
  TERRAIN_NAMES,
  TERRAIN_TRAITS,
  cellCenter,
  cellKey,
  manhattan,
  sameCell,
  terrainTraits,
} from './types';

// --- Events ----------------------------------------------------------------
export type {
  EngineeringJobPayload,
  EngineeringOp,
  GameplayEventMap,
  GameplayEventName,
  Listener,
  SpawnRequest,
} from './events';
export { GameplayEvents, Signal } from './events';

// --- Grid ------------------------------------------------------------------
export type { BarrierState, GateState, WalkabilityView, ZoneState } from './grid/Grid';
export { DIRECTIONS, Grid, UNKNOWN_LAYOUT_CHAR, gateActiveOn } from './grid/Grid';
export type {
  BarrierCell,
  BarrierDef,
  EngineeringDef,
  EngineeringQuotaGrant,
  GateDef,
  LegendEntry,
  MapDef,
  MapWaveModifiers,
  ParsedLayout,
  WaveOverrideDef,
  ZoneDef,
} from './grid/mapDef';
export {
  DEFAULT_LEGEND,
  MapDefError,
  loadMapDef,
  parseMapLayout,
  resolveLegend,
  validateMapDef,
  zoneCells,
} from './grid/mapDef';

// --- Pathing ---------------------------------------------------------------
export type { FlowField, FlowFieldOptions } from './pathing/flowField';
export {
  computeFlowField,
  costAt,
  directionAt,
  isReachable,
  isTarget,
  nextCell,
  straightLine,
  tracePath,
  tracePolyline,
} from './pathing/flowField';
export type { ConnectivityOptions, ConnectivityReport, TerrainOverrides } from './pathing/connectivity';
export {
  OverlayView,
  checkConnectivity,
  dependsOnPlayerBridges,
  floodReachable,
  playerBridgeIndices,
} from './pathing/connectivity';

// --- Engineering -----------------------------------------------------------
export type {
  EngineeringConfig,
  EngineeringJob,
  EngineeringSystemOptions,
  EngineeringWarning,
  OperationCheck,
  RejectionReason,
} from './engineering/EngineeringSystem';
export { DEFAULT_ENGINEERING_CONFIG, EngineeringSystem } from './engineering/EngineeringSystem';

// --- Waves -----------------------------------------------------------------
export type { BaseWaveDef, SpawnGroupDef, WaveTableDef } from './waves/baseWaveTable';
export { BASE_WAVE_TABLE, WaveTableError, loadWaveTable, validateWaveTable } from './waves/baseWaveTable';
export type { EnemyClass, EnemyWaveMeta } from './waves/enemyMeta';
export {
  DEFAULT_ENEMY_WAVE_META,
  ENEMY_CLASS_NAMES,
  ENEMY_ID_ALIASES,
  ENEMY_IDS,
  enemyMetaOf,
  isEnemyClass,
  normalizeEnemyId,
} from './waves/enemyMeta';
export type {
  GateSchedule,
  ResolvedSpawn,
  ResolvedWave,
  WaveEconomyRules,
  WavePlan,
  WavePlanOptions,
  WavePreviewEntry,
} from './waves/waveGenerator';
export {
  DEFAULT_ECONOMY_RULES,
  MAP_WAVE_MODIFIER_PRESETS,
  bountyMultiplierFor,
  buildWavePlan,
  gatesOpenAt,
} from './waves/waveGenerator';
export type { WaveClearResult, WavePhase, WaveRunnerOptions } from './waves/WaveRunner';
export { WaveRunner } from './waves/WaveRunner';

// --- Adapters & façade -----------------------------------------------------
export type { FlowFieldMovable } from './adapters/terrainQuery';
export { FlowFieldMovement, GridTerrainQuery, polylineToCore } from './adapters/terrainQuery';
export type { GameplayWorldOptions } from './world';
export { GameplayWorld, createGameplayWorld } from './world';

// --- Maps ------------------------------------------------------------------
export { MAP1_POWERHOUSE } from './maps/map1Powerhouse';

// --- data/ importers -------------------------------------------------------
export type { MapJson, WaveTableJson } from './data/importers';
export {
  DataImportError,
  TERRAIN_NAME_ALIASES,
  importMapDefJson,
  importWaveTableJson,
} from './data/importers';

// --- Self-check ------------------------------------------------------------
export type { CheckResult, SelfCheckReport } from './selfcheck';
export { formatSelfCheckReport, runGameplaySelfCheck } from './selfcheck';
