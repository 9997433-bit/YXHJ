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
import { ENEMY_DEFS } from './enemies';
import { REACTION_TABLE } from './reactions';
import { STATUS_DEFS } from './statuses';
import { TOWER_DEFS } from './towers';
import { UPGRADE_DEFS } from './upgrades';

export { ENEMY_DEFS } from './enemies';
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

  tower(id: string): TowerDef {
    const def = this.towers.get(id);
    if (!def) throw new Error(`[combat] unknown tower id: ${id}`);
    return def;
  }

  upgrade(id: string): UpgradeDef {
    const def = this.upgrades.get(id);
    if (!def) throw new Error(`[combat] unknown upgrade id: ${id}`);
    return def;
  }

  enemy(id: string): EnemyDef {
    const def = this.enemies.get(id);
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

    return problems;
  }
}
