/**
 * The combat content tables, plus the registry that indexes them.
 *
 * Everything here is plain data with no behaviour, which is what makes the
 * whole module swappable for a JSON/CSV load later (GDD §17.1) without
 * touching a line of the runtime.
 */

import type { EnemyDef } from '../entities/enemyDef';
import type { TowerDef, UpgradeDef } from '../entities/towerDef';
import type { ReactionTable } from '../reaction/spec';
import { StatusRegistry, type StatusDef } from '../status/statusDef';
import type { CombatVfxSignal } from '../types';
import { COMBAT_VFX_SIGNALS, VERB_EMITTED_SIGNALS } from '../vfxSignals';
import { ENEMY_DEFS } from './enemies';
import { resolveEnemyId, resolveTowerId, resolveUpgradeId } from './ids';
import { REACTION_TABLE } from './reactions';
import { STATUS_DEFS } from './statuses';
import { TOWER_DEFS } from './towers';
import { UPGRADE_DEFS } from './upgrades';

export { ENEMY_DEFS } from './enemies';
export {
  ENEMY_IDS,
  ENEMY_PHASE_IDS,
  LEGACY_ENEMY_IDS,
  LEGACY_TOWER_IDS,
  LEGACY_UPGRADE_IDS,
  TOWER_IDS,
  UPGRADE_IDS,
  isLegacyId,
  resolveEnemyId,
  resolveTowerId,
  resolveUpgradeId,
} from './ids';
export { REACTION_PARAMS, REACTION_TABLE } from './reactions';
export { PALETTE, STATUS_DEFS } from './statuses';
export { TOWER_DEFS } from './towers';
export { UPGRADE_DEFS } from './upgrades';
export * from './tuning';

export interface CombatContent {
  statuses: readonly StatusDef[];
  towers: readonly TowerDef[];
  upgrades: readonly UpgradeDef[];
  enemies: readonly EnemyDef[];
  reactions: ReactionTable;
}

export const DEFAULT_CONTENT: CombatContent = {
  statuses: STATUS_DEFS,
  towers: TOWER_DEFS,
  upgrades: UPGRADE_DEFS,
  enemies: ENEMY_DEFS,
  reactions: REACTION_TABLE,
};

/** Indexed, validated view of a content set. */
export class ContentRegistry {
  readonly statuses: StatusRegistry;
  readonly reactions: ReactionTable;
  private readonly towers = new Map<string, TowerDef>();
  private readonly upgrades = new Map<string, UpgradeDef>();
  private readonly enemies = new Map<string, EnemyDef>();

  constructor(content: CombatContent = DEFAULT_CONTENT) {
    this.statuses = new StatusRegistry(content.statuses);
    this.reactions = content.reactions;
    for (const def of content.towers) this.towers.set(def.id, def);
    for (const def of content.upgrades) this.upgrades.set(def.id, def);
    for (const def of content.enemies) this.enemies.set(def.id, def);
  }

  /** Canonical `data/towers.json` id for `id`, whether or not it is an alias. */
  towerId(id: string): string {
    return this.towers.has(id) ? id : resolveTowerId(id);
  }

  upgradeId(id: string): string {
    return this.upgrades.has(id) ? id : resolveUpgradeId(id);
  }

  enemyId(id: string): string {
    return this.enemies.has(id) ? id : resolveEnemyId(id);
  }

  tower(id: string): TowerDef {
    const def = this.towers.get(this.towerId(id));
    if (!def) throw new Error(`[combat] unknown tower id: ${id}`);
    return def;
  }

  upgrade(id: string): UpgradeDef {
    const def = this.upgrades.get(this.upgradeId(id));
    if (!def) throw new Error(`[combat] unknown upgrade id: ${id}`);
    return def;
  }

  enemy(id: string): EnemyDef {
    const def = this.enemies.get(this.enemyId(id));
    if (!def) throw new Error(`[combat] unknown enemy id: ${id}`);
    return def;
  }

  allTowers(): TowerDef[] {
    return [...this.towers.values()];
  }

  allEnemies(): EnemyDef[] {
    return [...this.enemies.values()];
  }

  allUpgrades(): UpgradeDef[] {
    return [...this.upgrades.values()];
  }

  /**
   * Cross-table integrity check. Cheap enough to run on boot in dev builds and
   * it turns a typo in a data table into one clear message instead of an
   * undefined three systems downstream.
   */
  validate(): string[] {
    const problems: string[] = [];

    for (const tower of this.towers.values()) {
      for (const upgradeId of tower.upgrades) {
        const upgrade = this.upgrades.get(upgradeId);
        if (!upgrade) problems.push(`tower ${tower.id} references missing upgrade ${upgradeId}`);
        else if (upgrade.towerId !== tower.id) {
          problems.push(`upgrade ${upgradeId} claims tower ${upgrade.towerId} but is listed on ${tower.id}`);
        }
      }
      const statuses =
        tower.attack.kind === 'cone' ? (tower.attack.applyStatuses ?? []) : [];
      for (const application of statuses) {
        if (!this.statuses.tryGet(application.status)) {
          problems.push(`tower ${tower.id} applies unknown status ${application.status}`);
        }
      }
    }

    for (const enemy of this.enemies.values()) {
      for (const spawn of enemy.onDeathSpawn ?? []) {
        if (!this.enemies.has(spawn.defId)) {
          problems.push(`enemy ${enemy.id} death-spawns unknown enemy ${spawn.defId}`);
        }
      }
      for (const phase of enemy.phases ?? []) {
        for (const spawn of phase.spawnOnEnter ?? []) {
          if (!this.enemies.has(spawn.defId)) {
            problems.push(`enemy ${enemy.id} phase ${phase.id} spawns unknown enemy ${spawn.defId}`);
          }
        }
      }
    }

    const rowIds = new Set<string>();
    for (const row of this.reactions) {
      if (rowIds.has(row.id)) problems.push(`duplicate reaction row id ${row.id}`);
      rowIds.add(row.id);
    }

    problems.push(...this.validateIdAliases());
    problems.push(...this.validateVfxSignals());
    return problems;
  }

  /**
   * A canonical id must never be shadowed by an alias, or a lookup would
   * silently resolve to the wrong def once someone deletes a legacy row.
   */
  private validateIdAliases(): string[] {
    const problems: string[] = [];
    const check = (
      kind: string,
      defs: Map<string, { id: string }>,
      resolver: (id: string) => string,
    ): void => {
      for (const id of defs.keys()) {
        const resolved = resolver(id);
        if (resolved !== id) problems.push(`${kind} id ${id} is also an alias for ${resolved}`);
      }
    };
    check('tower', this.towers, resolveTowerId);
    check('upgrade', this.upgrades, resolveUpgradeId);
    check('enemy', this.enemies, resolveEnemyId);
    return problems;
  }

  /**
   * Each stable VFX signal needs exactly one producer. Two rows declaring
   * `ice_shatter` would double-fire the burst; zero producers means `src/vfx`
   * is listening to an event nothing sends.
   */
  private validateVfxSignals(): string[] {
    const problems: string[] = [];
    const producers = new Map<CombatVfxSignal, string[]>();
    const declare = (signal: CombatVfxSignal, by: string): void => {
      const list = producers.get(signal);
      if (list) list.push(by);
      else producers.set(signal, [by]);
    };

    for (const row of this.reactions) {
      if (row.impact?.signal) declare(row.impact.signal, `reaction row ${row.id}`);
    }
    for (const status of this.statuses.all()) {
      if (status.signal) declare(status.signal, `status ${status.id}`);
    }
    for (const signal of VERB_EMITTED_SIGNALS) declare(signal, 'overloadTowers effect');

    for (const signal of COMBAT_VFX_SIGNALS) {
      const by = producers.get(signal) ?? [];
      if (by.length === 0) problems.push(`vfx signal ${signal} has no producer`);
      else if (by.length > 1) problems.push(`vfx signal ${signal} declared by ${by.join(', ')}`);
    }
    return problems;
  }
}
