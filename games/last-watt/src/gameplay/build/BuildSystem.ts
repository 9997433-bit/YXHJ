/**
 * 建塔 / 卖塔 — the cell-occupancy half of the combat handshake
 * (GDD §6.1, §6.2, §7.1; SYSTEMS.md §5).
 *
 * Combat owns tower *entities*; this owns the board and the wallet side of
 * placing one: the cell is marked occupied (so `isBuildable` turns false and
 * `buildVersion` bumps, without touching the walkability version that the flow
 * field caches on), the gold is spent and the permanent power draw is booked.
 *
 * Every tower in v1 is 1×1 and builds instantly — construction time belongs to
 * engineering operations only (SYSTEMS.md §5).
 */

import type { CellCoord } from '../types';
import { CellFlag } from '../types';
import type { GameplayEvents } from '../events';
import type { Grid } from '../grid/Grid';
import type { Economy } from '../economy/Economy';
import type { PowerContributionSource } from '../economy/contributions';
import { contributionOf } from '../economy/contributions';
import type { CombatContentView, CombatTowerHandle, TowerDefView } from '../integration/combatPort';

export type BuildRejectionReason =
  | 'out_of_bounds'
  | 'unknown_tower'
  | 'not_buildable'
  | 'occupied'
  | 'under_construction'
  | 'zone_unpowered'
  | 'locked'
  | 'insufficient_gold'
  | 'insufficient_power';

const REASON_MESSAGES: Record<BuildRejectionReason, string> = {
  out_of_bounds: '目标格不在场地内',
  unknown_tower: '没有这个图纸',
  not_buildable: '该格不能建造',
  occupied: '该格已被占用',
  under_construction: '该格正在施工',
  zone_unpowered: '该变电区已断电',
  locked: '图纸尚未解锁',
  insufficient_gold: '金币不足',
  insufficient_power: '供电上限不足',
};

export interface BuildCheck extends CellCoord {
  defId: string;
  ok: boolean;
  reason: BuildRejectionReason | null;
  message: string;
  cost: number;
  powerCost: number;
  /** Points of supply still missing; drives the §14.1 grey-out badge. */
  powerDeficit: number;
}

export interface PlacedTower extends CellCoord {
  /** Combat's entity id. */
  towerId: number;
  defId: string;
  cost: number;
  powerCost: number;
  /** False while its substation is down (GDD §10). It still draws power. */
  powered: boolean;
  zoneId: string | null;
}

export interface BuildSystemOptions {
  grid: Grid;
  economy: Economy;
  /** Defaults to an empty catalogue until `attachCombat` supplies the real one. */
  content?: CombatContentView;
  events?: GameplayEvents;
  /**
   * Creates the combat-side entity. Defaults to handing out synthetic ids so
   * the board, the wallet and the power grid can be driven with no combat
   * module attached (headless tests, `selfcheck.ts`).
   */
  createTower?: (defId: string, cell: CellCoord) => CombatTowerHandle;
  /** Refund for a sale; defaults to GDD §6.1's flat 70% of the base cost. */
  removeTower?: (towerId: number) => number;
  /** Blueprint unlock schedule (GDD §11). Defaults to `ui.unlockWave`. */
  isUnlocked?: (defId: string, wave: number) => boolean;
  /** The wave the player is preparing for; 1 before the run starts. */
  currentWave?: () => number;
}

/** Before combat is attached every blueprint is simply unknown. */
const EMPTY_CONTENT: CombatContentView = {
  tower(id: string): never {
    throw new Error(`[gameplay] no tower catalogue attached (asked for ${id})`);
  },
  allTowers: () => [],
};

export class BuildSystem {
  private readonly grid: Grid;
  private readonly economy: Economy;
  private readonly events: GameplayEvents | undefined;
  private readonly isUnlockedAt: (defId: string, wave: number) => boolean;
  private readonly currentWave: () => number;

  private content: CombatContentView;
  private createTower: (defId: string, cell: CellCoord) => CombatTowerHandle;
  private removeTower: ((towerId: number) => number) | undefined;

  private readonly byCell = new Map<number, PlacedTower>();
  private readonly byId = new Map<number, PlacedTower>();
  private nextSyntheticId = 1;

  constructor(options: BuildSystemOptions) {
    this.grid = options.grid;
    this.economy = options.economy;
    this.content = options.content ?? EMPTY_CONTENT;
    this.events = options.events;
    this.createTower = options.createTower ?? (() => ({ id: (this.nextSyntheticId += 1) }));
    this.removeTower = options.removeTower;
    this.isUnlockedAt = options.isUnlocked ?? ((defId, wave) => this.unlockedByTable(defId, wave));
    this.currentWave = options.currentWave ?? (() => 1);
  }

  /**
   * Takes the tower catalogue and the entity factory from combat. Called by
   * `GameSession.attachCombat`; before that the menu is empty and every
   * placement is refused with `unknown_tower`.
   */
  attachCombat(combat: {
    content: CombatContentView;
    buildTower(defId: string, cell: CellCoord): CombatTowerHandle;
    sellTower(towerId: number): number;
  }): void {
    this.content = combat.content;
    this.createTower = (defId, cell) => combat.buildTower(defId, cell);
    this.removeTower = (towerId) => combat.sellTower(towerId);
  }

  get catalogue(): TowerDefView[] {
    return this.content.allTowers();
  }

  towerDef(defId: string): TowerDefView | null {
    try {
      return this.content.tower(defId);
    } catch {
      return null;
    }
  }

  get towers(): readonly PlacedTower[] {
    return [...this.byId.values()];
  }

  towerAt(cx: number, cy: number): PlacedTower | undefined {
    return this.byCell.get(this.grid.index(cx, cy));
  }

  towerById(towerId: number): PlacedTower | undefined {
    return this.byId.get(towerId);
  }

  towersInZone(zoneId: string): PlacedTower[] {
    return [...this.byId.values()].filter((tower) => tower.zoneId === zoneId);
  }

  // -------------------------------------------------------------------------
  // Legality
  // -------------------------------------------------------------------------

  check(defId: string, cx: number, cy: number): BuildCheck {
    const base: BuildCheck = {
      cx,
      cy,
      defId,
      ok: false,
      reason: null,
      message: '',
      cost: 0,
      powerCost: 0,
      powerDeficit: 0,
    };
    const reject = (reason: BuildRejectionReason, extra: Partial<BuildCheck> = {}): BuildCheck => ({
      ...base,
      ...extra,
      reason,
      message: REASON_MESSAGES[reason],
    });

    if (!this.grid.isInside(cx, cy)) return reject('out_of_bounds');

    let def: TowerDefView;
    try {
      def = this.content.tower(defId);
    } catch {
      return reject('unknown_tower');
    }

    const priced: BuildCheck = { ...base, cost: def.cost, powerCost: def.powerCost };
    const rejectPriced = (reason: BuildRejectionReason, extra: Partial<BuildCheck> = {}): BuildCheck => ({
      ...priced,
      ...extra,
      reason,
      message: REASON_MESSAGES[reason],
    });

    if (!this.isUnlockedAt(def.id, this.currentWave())) return rejectPriced('locked');
    if (this.towerAt(cx, cy)) return rejectPriced('occupied');
    if (this.grid.isOccupied(cx, cy)) return rejectPriced('occupied');
    if (this.grid.hasFlag(cx, cy, CellFlag.UnderConstruction)) return rejectPriced('under_construction');
    if (!this.grid.isPowered(cx, cy)) return rejectPriced('zone_unpowered');
    if (!this.grid.isBuildable(cx, cy)) return rejectPriced('not_buildable');
    if (!this.economy.canAfford(def.cost)) return rejectPriced('insufficient_gold');
    if (!this.economy.canDraw(def.powerCost)) {
      const missing = this.economy.powerUsed + def.powerCost - this.economy.powerCap;
      return rejectPriced('insufficient_power', { powerDeficit: Math.max(0, missing) });
    }

    return { ...priced, ok: true };
  }

  /** Every cell this blueprint may be dropped on, for board highlighting. */
  legalTargets(defId: string): CellCoord[] {
    const targets: CellCoord[] = [];
    this.grid.forEachCell((cx, cy) => {
      if (!this.grid.isBuildable(cx, cy)) return;
      if (this.check(defId, cx, cy).ok) targets.push({ cx, cy });
    });
    return targets;
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  place(defId: string, cx: number, cy: number): BuildCheck & { tower?: PlacedTower } {
    const check = this.check(defId, cx, cy);
    if (!check.ok) {
      this.events?.emit('build_rejected', { cx, cy, defId, reason: check.reason ?? 'not_buildable' });
      return check;
    }

    const def = this.content.tower(defId);
    this.economy.spend(def.cost, 'build');
    this.economy.addDraw(def.powerCost);
    this.economy.addContribution(contributionOf(def, this.fissureAdjacent(cx, cy)));

    const handle = this.createTower(def.id, { cx, cy });
    const tower: PlacedTower = {
      cx,
      cy,
      towerId: handle.id,
      defId: def.id,
      cost: def.cost,
      powerCost: def.powerCost,
      powered: this.grid.isPowered(cx, cy),
      zoneId: this.grid.zoneIdAt(cx, cy),
    };

    // Occupancy bumps `buildVersion` only: a tower must never re-route enemies.
    this.grid.setOccupied(cx, cy, true);
    this.byCell.set(this.grid.index(cx, cy), tower);
    this.byId.set(tower.towerId, tower);

    this.events?.emit('tower_placed', {
      cx,
      cy,
      towerId: tower.towerId,
      defId: tower.defId,
      cost: tower.cost,
      powerCost: tower.powerCost,
    });
    return { ...check, tower };
  }

  sellAt(cx: number, cy: number): number {
    const tower = this.towerAt(cx, cy);
    return tower ? this.sell(tower.towerId) : 0;
  }

  /** @returns the refund paid, or 0 when there was nothing to sell. */
  sell(towerId: number): number {
    const tower = this.byId.get(towerId);
    if (!tower) return 0;

    const def = this.content.tower(tower.defId);
    // Combat knows about purchased upgrades, so it is the authority on value.
    const refund = this.removeTower
      ? this.removeTower(towerId)
      : Math.floor(tower.cost * this.economy.rules.sellRefundRatio);

    this.byId.delete(towerId);
    this.byCell.delete(this.grid.index(tower.cx, tower.cy));
    this.grid.setOccupied(tower.cx, tower.cy, false);

    this.economy.releaseDraw(tower.powerCost);
    this.economy.removeContribution(contributionOf(def, this.fissureAdjacent(tower.cx, tower.cy)));
    this.economy.earn(refund, 'sell');

    this.events?.emit('tower_removed', {
      cx: tower.cx,
      cy: tower.cy,
      towerId,
      defId: tower.defId,
      refund,
    });
    return refund;
  }

  /**
   * Marks every tower inside a lost substation as offline (GDD §10). Their
   * power draw is deliberately *not* released — decision D11: the only way out
   * is to sell, which is exactly the pressure §6.3-3 asks for.
   *
   * @returns the towers whose state changed, for `combat.setTowerPowered`.
   */
  setZonePowered(zoneId: string, powered: boolean): PlacedTower[] {
    const changed: PlacedTower[] = [];
    for (const tower of this.byId.values()) {
      if (tower.zoneId !== zoneId || tower.powered === powered) continue;
      tower.powered = powered;
      changed.push(tower);
      this.events?.emit('tower_power_changed', {
        cx: tower.cx,
        cy: tower.cy,
        towerId: tower.towerId,
        defId: tower.defId,
        powered,
      });
    }
    return changed;
  }

  /** Blueprint availability for the build menu (GDD §14.1). */
  isUnlocked(defId: string): boolean {
    return this.isUnlockedAt(defId, this.currentWave());
  }

  private unlockedByTable(defId: string, wave: number): boolean {
    let unlockWave: number | undefined;
    try {
      unlockWave = this.content.tower(defId).ui.unlockWave;
    } catch {
      return false;
    }
    return (unlockWave ?? 1) <= Math.max(1, wave);
  }

  /** Map 3 (GDD §5.2): a generator next to a fissure supplies 8 instead of 6. */
  private fissureAdjacent(cx: number, cy: number): PowerContributionSource {
    if (this.grid.isGeothermal(cx, cy)) return 'fissure';
    for (const neighbour of this.grid.neighbors4(cx, cy)) {
      if (this.grid.isGeothermal(neighbour.cx, neighbour.cy)) return 'fissure';
    }
    return 'plain';
  }
}
