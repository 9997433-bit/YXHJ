/**
 * Importers for the authored tables under `games/last-watt/data/`.
 *
 * Those files are owned by the systems/data track and use their own snake_case
 * schema; this module is the one-way adapter into the gameplay types. Keeping
 * the translation here means neither side has to bend: `data/` stays a readable
 * design document, `MapDef`/`WaveTableDef` stay the runtime shape.
 *
 * Everything is validated on the way in — `loadMapDef` and `loadWaveTable` run
 * at the end of each import, so a malformed table fails loudly at load rather
 * than as a mystery pathing bug three systems later.
 */

import type { CellCoord, TerrainName } from '../types';
import { CellFlag } from '../types';
import type {
  BarrierCell,
  BarrierDef,
  EngineeringQuotaGrant,
  GateDef,
  LegendEntry,
  MapDef,
  MapWaveModifiers,
  ZoneDef,
} from '../grid/mapDef';
import { loadMapDef } from '../grid/mapDef';
import type { MilestoneId } from '../rules/scope';
import { MILESTONE_ORDER } from '../rules/scope';
import type { BaseWaveDef, SpawnGroupDef, WaveTableDef } from '../waves/baseWaveTable';
import { loadWaveTable } from '../waves/baseWaveTable';
import { normalizeEnemyId } from '../waves/enemyMeta';

// ---------------------------------------------------------------------------
// JSON shapes (only the fields the runtime consumes)
// ---------------------------------------------------------------------------

type Cell2 = [number, number];

export interface MapJson {
  id: string;
  name_cn?: string;
  grid_size: [number, number];
  legend: Record<string, { terrain: string; diggable?: boolean; bridgeable?: boolean }>;
  terrain_rows: string[];
  core: Cell2 | Cell2[];
  gates: Array<{
    id: string;
    name_cn?: string;
    cell: Cell2;
    active_from_wave?: number;
    active_waves?: number[];
    enabled_by_event?: string;
  }>;
  event_cells?: Array<{
    event: string;
    trigger?: { type: string; wave?: number; value?: number };
    active_from_milestone?: string;
    cells: Array<{ cell: Cell2; becomes: string }>;
  }>;
  /** Scope switches the design track owns; see `rules/scope.ts`. */
  milestone_gates?: { m1_zone_loss?: boolean };
  zones?: Array<{
    id: string;
    name_cn?: string;
    lost_below_integrity: number;
    active_from_milestone?: string;
    cells: Cell2[];
    on_lost?: { power_cap_delta?: number; open_event?: string };
  }>;
  engineering?: {
    dig_quota?: number;
    bridge_quota?: number;
    grants?: Array<{
      wave: number;
      type: 'dig' | 'bridge';
      count?: number;
      free?: boolean;
      recommended_cell?: Cell2;
    }>;
  };
  wave_multipliers?: {
    enemy_hp?: number;
    weight_fly_heal?: number;
    weight_demolisher?: number;
  };
  first_appearance_waves?: Record<string, number>;
}

export interface WaveTableJson {
  map_id?: string;
  waves: Array<{
    wave_no: number;
    reward?: number;
    teach?: string;
    script_events?: string[];
    spawns: Array<{
      enemy_id: string;
      count: number;
      interval_s?: number;
      start_delay_s?: number;
      gate_id?: string;
    }>;
  }>;
}

export class DataImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataImportError';
  }
}

// ---------------------------------------------------------------------------
// Terrain vocabulary
// ---------------------------------------------------------------------------

/** `data/` terrain names → gameplay terrain. */
export const TERRAIN_NAME_ALIASES: Readonly<Record<string, TerrainName>> = {
  wasteland: 'rock',
  foundation: 'ground',
  road: 'path',
  diggable_road: 'path',
  soft_earth: 'soft_soil',
  gully: 'trench',
  puddle_road: 'puddle',
  locked_road: 'rock',
  event_sealed: 'rock',
  core: 'core',
  bridge: 'bridge',
  water: 'water',
  spawn: 'spawn',
};

function toTerrain(name: string, context: string): TerrainName {
  const terrain = TERRAIN_NAME_ALIASES[name];
  if (!terrain) throw new DataImportError(`${context}: unknown terrain "${name}"`);
  return terrain;
}

/**
 * Canonical terrain vocabulary (INTEGRATION.md §3.7) — the `data/maps/*.json`
 * legend plus the two runtime-only terrains, `bridge` (a completed bridge job)
 * and `water` (a bridgeable water surface; no map1 legend letter uses it yet).
 */
export type CanonicalTerrainName =
  | 'wasteland'
  | 'foundation'
  | 'road'
  | 'diggable_road'
  | 'soft_earth'
  | 'gully'
  | 'puddle_road'
  | 'locked_road'
  | 'event_sealed'
  | 'core'
  | 'bridge'
  | 'water';

/**
 * Outbound half of the one-way translation layer: internal `TerrainName` is an
 * implementation enum, so anything that crosses a module boundary is spelled in
 * the canonical vocabulary instead (INTEGRATION.md §3, §4.2-2).
 *
 * The inbound table is many-to-one — `diggable_road`, `locked_road` and
 * `event_sealed` all collapse onto a runtime terrain — so this direction picks
 * the plain-terrain spelling and loses the authoring distinction. That is
 * intentional: once a cell has been dug or bridged, "it used to be a locked
 * road" is map-authoring history, not runtime state.
 */
export const CANONICAL_TERRAIN_NAMES: Readonly<Record<TerrainName, CanonicalTerrainName>> = {
  ground: 'foundation',
  path: 'road',
  puddle: 'puddle_road',
  soft_soil: 'soft_earth',
  trench: 'gully',
  water: 'water',
  bridge: 'bridge',
  rock: 'wasteland',
  core: 'core',
  spawn: 'road',
};

export function toCanonicalTerrain(terrain: TerrainName): CanonicalTerrainName {
  return CANONICAL_TERRAIN_NAMES[terrain];
}

/** `data/` first-appearance class keys → gameplay enemy classes. */
const CLASS_KEY_ALIASES: Readonly<Record<string, string>> = {
  flyer: 'flying',
  demolisher: 'sapper',
  healer: 'healer',
};

// ---------------------------------------------------------------------------
// Map import
// ---------------------------------------------------------------------------

export function importMapDefJson(json: MapJson): MapDef {
  const [cols, rows] = json.grid_size;
  const context = `map "${json.id}"`;

  // The layout characters keep their authored meaning; only the terrain
  // vocabulary is translated. `diggable` on a legend entry becomes a cell flag.
  const legend: Record<string, LegendEntry> = {};
  for (const [char, entry] of Object.entries(json.legend)) {
    legend[char] = {
      terrain: toTerrain(entry.terrain, `${context} legend "${char}"`),
      flags: entry.diggable ? CellFlag.Diggable : 0,
    };
  }

  const coreCells: CellCoord[] = (isCellList(json.core) ? json.core : [json.core]).map(toCoord);
  // The core is the flow-field goal, so it has to be enterable whatever the
  // authored legend says about it.
  for (const cell of coreCells) {
    const char = charAt(json.terrain_rows, cell, context);
    legend[char] = { terrain: 'core', core: true };
  }

  const barriers: BarrierDef[] = [];
  const barrierByEvent = new Map<string, number>();
  for (const event of json.event_cells ?? []) {
    const cells: BarrierCell[] = event.cells.map((entry) => {
      const coord = toCoord(entry.cell);
      const terrain = toTerrain(entry.becomes, `${context} event "${event.event}"`);
      return { ...coord, terrain, diggable: entry.becomes === 'diggable_road' };
    });
    const def: BarrierDef = { id: event.event, openTerrain: 'path', cells, label: event.event };
    if (event.trigger?.type === 'wave_start' && event.trigger.wave !== undefined) {
      def.openAtWave = event.trigger.wave;
    }
    const milestone = toMilestone(event.active_from_milestone, `${context} event "${event.event}"`);
    if (milestone) def.activeFromMilestone = milestone;
    barrierByEvent.set(event.event, barriers.length);
    barriers.push(def);
  }

  const gates: GateDef[] = json.gates.map((gate) => ({
    id: gate.id,
    openWave: gate.active_from_wave ?? gate.active_waves?.[0] ?? 1,
    activeWaves: gate.active_waves,
    cells: [toCoord(gate.cell)],
    label: gate.name_cn,
  }));

  const zones: ZoneDef[] = (json.zones ?? []).map((zone) => {
    const milestone = toMilestone(zone.active_from_milestone, `${context} zone "${zone.id}"`);
    return {
      id: zone.id,
      label: zone.name_cn,
      cells: zone.cells.map(toCoord),
      triggerIntegrity: zone.lost_below_integrity,
      powerPenalty: Math.abs(zone.on_lost?.power_cap_delta ?? 0),
      opensBarrier: zone.on_lost?.open_event,
      ...(milestone ? { activeFromMilestone: milestone } : {}),
    };
  });

  const grants: EngineeringQuotaGrant[] = (json.engineering?.grants ?? []).map((grant) => ({
    wave: grant.wave,
    dig: grant.type === 'dig' ? (grant.count ?? 1) : 0,
    bridge: grant.type === 'bridge' ? (grant.count ?? 1) : 0,
    free: grant.free ?? false,
    ...(grant.recommended_cell ? { recommendedCell: toCoord(grant.recommended_cell) } : {}),
  }));

  const zoneLossGates = importZoneLossGates(json);
  const def: MapDef = {
    id: json.id,
    name: json.name_cn ?? json.id,
    cols,
    rows,
    layout: json.terrain_rows,
    legend,
    gates,
    barriers,
    zones,
    ...(zoneLossGates ? { zoneLossByMilestone: zoneLossGates } : {}),
    engineering: {
      digQuota: json.engineering?.dig_quota ?? 0,
      bridgeQuota: json.engineering?.bridge_quota ?? 0,
      grants,
    },
    waveModifiers: importWaveModifiers(json),
  };

  // Referenced but undeclared events would silently disable a zone's shortcut.
  for (const zone of zones) {
    if (zone.opensBarrier && !barrierByEvent.has(zone.opensBarrier)) {
      throw new DataImportError(
        `${context}: zone "${zone.id}" opens event "${zone.opensBarrier}" which has no event_cells entry`,
      );
    }
  }

  return loadMapDef(def);
}

function toMilestone(value: string | undefined, context: string): MilestoneId | undefined {
  if (value === undefined) return undefined;
  if (!(MILESTONE_ORDER as readonly string[]).includes(value)) {
    throw new DataImportError(`${context}: unknown milestone "${value}"`);
  }
  return value as MilestoneId;
}

/**
 * `milestone_gates` keys are named after the milestone they answer for, so they
 * import as a per-milestone table rather than a single boolean — building M2
 * must not read M1's switch.
 */
function importZoneLossGates(json: MapJson): Partial<Record<MilestoneId, boolean>> | undefined {
  const m1 = json.milestone_gates?.m1_zone_loss;
  return m1 === undefined ? undefined : { M1: m1 };
}

function importWaveModifiers(json: MapJson): MapWaveModifiers {
  const multipliers = json.wave_multipliers ?? {};
  const flyHeal = multipliers.weight_fly_heal ?? 1;

  const firstAppearance: Record<string, number> = {};
  for (const [key, wave] of Object.entries(json.first_appearance_waves ?? {})) {
    firstAppearance[CLASS_KEY_ALIASES[key] ?? normalizeEnemyId(key)] = wave;
  }

  return {
    hpMultiplier: multipliers.enemy_hp ?? 1,
    countMultipliers: {
      flying: flyHeal,
      healer: flyHeal,
      sapper: multipliers.weight_demolisher ?? 1,
    },
    firstAppearance,
    injectOnFirstAppearance: true,
  };
}

// ---------------------------------------------------------------------------
// Wave table import
// ---------------------------------------------------------------------------

/**
 * @param gateIds gate order of the target map, used to turn `gate_id` strings
 *                into the generator's gate indices. Unknown ids fall back to
 *                `'spread'` so a partially authored table still runs.
 */
export function importWaveTableJson(json: WaveTableJson, gateIds: readonly string[] = []): WaveTableDef {
  const waves: BaseWaveDef[] = json.waves.map((wave) => {
    const groups: SpawnGroupDef[] = wave.spawns.map((spawn) => {
      const gateIndex = spawn.gate_id ? gateIds.indexOf(spawn.gate_id) : -1;
      return {
        enemy: normalizeEnemyId(spawn.enemy_id),
        count: spawn.count,
        interval: spawn.interval_s ?? 1,
        delay: spawn.start_delay_s ?? 0,
        gate: gateIndex >= 0 ? gateIndex : 'spread',
      };
    });

    return {
      wave: wave.wave_no,
      groups,
      reward: wave.reward,
      script: wave.script_events?.[0],
      note: wave.teach,
    };
  });

  return loadWaveTable({ id: json.map_id ?? 'imported', waves });
}

// ---------------------------------------------------------------------------

function isCellList(value: Cell2 | Cell2[]): value is Cell2[] {
  return Array.isArray(value[0]);
}

function toCoord(cell: Cell2): CellCoord {
  return { cx: cell[0], cy: cell[1] };
}

function charAt(rows: readonly string[], cell: CellCoord, context: string): string {
  const row = rows[cell.cy];
  const char = row?.[cell.cx];
  if (!char) throw new DataImportError(`${context}: cell ${cell.cx},${cell.cy} is outside the layout`);
  return char;
}
