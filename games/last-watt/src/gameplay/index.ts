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

// --- Scope (milestone gates) -----------------------------------------------
export type { MilestoneId, ScopeRules } from './rules/scope';
export {
  CURRENT_MILESTONE,
  MILESTONE_ORDER,
  MILESTONE_SCOPE,
  SCOPE,
  milestoneAtLeast,
} from './rules/scope';

// --- Engineering -----------------------------------------------------------
export type {
  EngineeringConfig,
  EngineeringHint,
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
export type { EnemyRoute, RoutedMovable } from './adapters/routedMovement';
export { GROUND_ROUTE, RoutedMovement } from './adapters/routedMovement';
export type { GameplayWorldOptions } from './world';
export { GameplayWorld, createGameplayWorld } from './world';

// --- Economy (GDD §6, §10) -------------------------------------------------
export type { EconomyOptions, EconomyRules, EconomySnapshot, PowerContribution } from './economy/Economy';
export { DEFAULT_ECONOMY, Economy } from './economy/Economy';
export type { PowerContributionSource } from './economy/contributions';
export { contributionOf } from './economy/contributions';

// --- Building (GDD §7.1) ---------------------------------------------------
export type {
  BuildCheck,
  BuildRejectionReason,
  BuildSystemOptions,
  PlacedTower,
} from './build/BuildSystem';
export { BuildSystem } from './build/BuildSystem';

// --- Combat handshake ------------------------------------------------------
export type {
  BridgeDestroyedEvent,
  BuildingEffectsView,
  CombatBusPort,
  CombatContentView,
  CombatEnemyHandle,
  CombatPort,
  CombatSpawnOptions,
  CombatTowerHandle,
  EnemyKilledEvent,
  EnemyLeakedEvent,
  EnemySpawnedEvent,
  TowerDefView,
} from './integration/combatPort';
export type { CombatLinkOptions, DefeatReason, EnemyRecord } from './integration/CombatLink';
export { CombatLink } from './integration/CombatLink';
export type { StubCombatOptions, StubEnemyDef } from './integration/stubCombat';
export { STUB_ENEMY_DEFAULT, STUB_TOWERS, StubCombat, StubEnemy } from './integration/stubCombat';

// --- Player commands (GDD §14.1) -------------------------------------------
export type {
  ButtonState,
  CommandButtons,
  CommandCenterOptions,
  CommandResult,
  CommandStatus,
  ToolKind,
} from './commands/CommandCenter';
export { CommandCenter } from './commands/CommandCenter';

// --- Session ---------------------------------------------------------------
export type {
  BuildMenuItem,
  GameSessionOptions,
  RunStatus,
  SessionSnapshot,
} from './session/GameSession';
export { GameSession, createGameSession } from './session/GameSession';

// --- Maps ------------------------------------------------------------------
export { MAP1_POWERHOUSE } from './maps/map1Powerhouse';

// --- data/ importers -------------------------------------------------------
export type { CanonicalTerrainName, MapJson, WaveTableJson } from './data/importers';
export {
  CANONICAL_TERRAIN_NAMES,
  DataImportError,
  TERRAIN_NAME_ALIASES,
  importMapDefJson,
  importWaveTableJson,
  toCanonicalTerrain,
} from './data/importers';
export type { EngineeringCostDefaults, GameStateDefaultsJson } from './data/gameStateDefaults';
export { importEconomyRules, importEngineeringCosts } from './data/gameStateDefaults';

// --- Self-check ------------------------------------------------------------
export type { CheckResult, SelfCheckReport } from './selfcheck';
export { formatSelfCheckReport, runGameplaySelfCheck } from './selfcheck';
