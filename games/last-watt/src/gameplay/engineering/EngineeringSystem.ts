/**
 * 挖沟 / 搭桥 (GDD §5.1, §5.2).
 *
 *  - dig:    one 可挖路段 cell becomes a trench. 50 gold, 3s, and the cell stays
 *            passable while the work is running.
 *  - bridge: one trench/water cell becomes road. 80 gold, 3s, passable only once
 *            finished. Sapper crabs blow these up and the charge is not refunded.
 *
 * Legality is the interesting part: after the operation every gate — including
 * gates that have not opened yet — must still have a route to the core. The
 * check runs against the board as it will look once all queued jobs finish, so
 * two digs that are each fine alone but fatal together are caught.
 */

import type { CellCoord, Seconds, TerrainName } from '../types';
import { CellFlag } from '../types';
import type { Grid } from '../grid/Grid';
import type { EngineeringOp, GameplayEvents } from '../events';
import { checkConnectivity, dependsOnPlayerBridges } from '../pathing/connectivity';

export interface EngineeringConfig {
  digCost: number;
  bridgeCost: number;
  digDuration: Seconds;
  bridgeDuration: Seconds;
  /** Terrain a completed dig leaves behind. */
  digResult: TerrainName;
  /** Terrain a completed bridge leaves behind. */
  bridgeResult: TerrainName;
  /** Unopened gates must stay connected too, or wave 10 soft-locks the run. */
  includeUnopenedGates: boolean;
}

export const DEFAULT_ENGINEERING_CONFIG: EngineeringConfig = {
  digCost: 50,
  bridgeCost: 80,
  digDuration: 3,
  bridgeDuration: 3,
  digResult: 'trench',
  bridgeResult: 'bridge',
  includeUnopenedGates: true,
};

export type RejectionReason =
  | 'out_of_bounds'
  | 'no_quota'
  | 'insufficient_gold'
  | 'not_diggable'
  | 'not_bridgeable'
  | 'under_construction'
  | 'would_block_path';

export type EngineeringWarning = 'bridge_dependent_route';

export interface OperationCheck extends CellCoord {
  op: EngineeringOp;
  ok: boolean;
  reason: RejectionReason | null;
  message: string;
  cost: number;
  duration: Seconds;
  quotaLeft: number;
  /** Gate ids that would lose their route; drives the red-button tooltip. */
  blockedGates: string[];
  warnings: EngineeringWarning[];
}

export interface EngineeringJob extends CellCoord {
  id: number;
  op: EngineeringOp;
  cost: number;
  duration: Seconds;
  remaining: Seconds;
  resultTerrain: TerrainName;
}

export interface EngineeringSystemOptions {
  grid: Grid;
  events?: GameplayEvents;
  config?: Partial<EngineeringConfig>;
  digQuota?: number;
  bridgeQuota?: number;
  /** Lets `check*` report `insufficient_gold`; the economy still owns the wallet. */
  getGold?: () => number;
}

const REASON_MESSAGES: Record<RejectionReason, string> = {
  out_of_bounds: '目标格不在场地内',
  no_quota: '工程次数已用完',
  insufficient_gold: '金币不足',
  not_diggable: '该格不是可挖路段',
  not_bridgeable: '该格不是沟壑或水面',
  under_construction: '该格正在施工',
  would_block_path: '会彻底堵死出怪口到核心的通路',
};

export class EngineeringSystem {
  readonly config: EngineeringConfig;

  private readonly grid: Grid;
  private readonly events: GameplayEvents | undefined;
  private readonly getGold: (() => number) | undefined;
  private readonly jobs: EngineeringJob[] = [];
  private nextJobId = 1;

  private digRemaining: number;
  private bridgeRemaining: number;

  constructor(options: EngineeringSystemOptions) {
    this.grid = options.grid;
    this.events = options.events;
    this.getGold = options.getGold;
    this.config = { ...DEFAULT_ENGINEERING_CONFIG, ...(options.config ?? {}) };
    this.digRemaining = options.digQuota ?? options.grid.def.engineering.digQuota;
    this.bridgeRemaining = options.bridgeQuota ?? options.grid.def.engineering.bridgeQuota;
  }

  get digLeft(): number {
    return this.digRemaining;
  }

  get bridgeLeft(): number {
    return this.bridgeRemaining;
  }

  get activeJobs(): readonly EngineeringJob[] {
    return this.jobs;
  }

  costOf(op: EngineeringOp): number {
    return op === 'dig' ? this.config.digCost : this.config.bridgeCost;
  }

  durationOf(op: EngineeringOp): Seconds {
    return op === 'dig' ? this.config.digDuration : this.config.bridgeDuration;
  }

  quotaOf(op: EngineeringOp): number {
    return op === 'dig' ? this.digRemaining : this.bridgeRemaining;
  }

  // -------------------------------------------------------------------------
  // Legality
  // -------------------------------------------------------------------------

  check(op: EngineeringOp, cx: number, cy: number): OperationCheck {
    const cost = this.costOf(op);
    const duration = this.durationOf(op);
    const quotaLeft = this.quotaOf(op);
    const base: OperationCheck = {
      cx,
      cy,
      op,
      ok: false,
      reason: null,
      message: '',
      cost,
      duration,
      quotaLeft,
      blockedGates: [],
      warnings: [],
    };

    const reject = (reason: RejectionReason, blockedGates: string[] = []): OperationCheck => ({
      ...base,
      reason,
      message: REASON_MESSAGES[reason],
      blockedGates,
    });

    if (!this.grid.isInside(cx, cy)) return reject('out_of_bounds');
    if (quotaLeft <= 0) return reject('no_quota');
    if (this.jobAt(cx, cy)) return reject('under_construction');
    if (op === 'dig' && !this.grid.isDiggable(cx, cy)) return reject('not_diggable');
    if (op === 'bridge' && !this.grid.isBridgeable(cx, cy)) return reject('not_bridgeable');

    const gold = this.getGold?.();
    if (gold !== undefined && gold < cost) return reject('insufficient_gold');

    const overrides = this.pendingOverrides();
    const candidateIndex = this.grid.index(cx, cy);
    overrides.set(candidateIndex, this.resultTerrainOf(op));
    const report = checkConnectivity(this.grid, {
      overrides,
      includeUnopenedGates: this.config.includeUnopenedGates,
    });
    if (!report.ok) return reject('would_block_path', report.blockedGates);

    // Bridges queued but not yet standing count as destructible too.
    const fragile = new Set<number>();
    for (const job of this.jobs) {
      if (job.op === 'bridge') fragile.add(this.grid.index(job.cx, job.cy));
    }
    if (op === 'bridge') fragile.add(candidateIndex);

    const warnings: EngineeringWarning[] = [];
    if (
      dependsOnPlayerBridges(this.grid, {
        overrides,
        removed: fragile,
        includeUnopenedGates: this.config.includeUnopenedGates,
      })
    ) {
      warnings.push('bridge_dependent_route');
    }

    return { ...base, ok: true, warnings };
  }

  checkDig(cx: number, cy: number): OperationCheck {
    return this.check('dig', cx, cy);
  }

  checkBridge(cx: number, cy: number): OperationCheck {
    return this.check('bridge', cx, cy);
  }

  /** Every legal target for an operation, for highlighting the board. */
  legalTargets(op: EngineeringOp): CellCoord[] {
    const targets: CellCoord[] = [];
    this.grid.forEachCell((cx, cy) => {
      const quickReject = op === 'dig' ? !this.grid.isDiggable(cx, cy) : !this.grid.isBridgeable(cx, cy);
      if (quickReject) return;
      if (this.check(op, cx, cy).ok) targets.push({ cx, cy });
    });
    return targets;
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * Starts a job when legal. The gold is *not* deducted here — the economy owns
   * the wallet and reacts to `engineering_started`.
   */
  begin(op: EngineeringOp, cx: number, cy: number): OperationCheck & { job?: EngineeringJob } {
    const check = this.check(op, cx, cy);
    if (!check.ok) {
      this.events?.emit('engineering_rejected', {
        cx,
        cy,
        op,
        reason: check.reason ?? 'would_block_path',
      });
      return check;
    }

    if (op === 'dig') this.digRemaining -= 1;
    else this.bridgeRemaining -= 1;

    const job: EngineeringJob = {
      id: this.nextJobId,
      op,
      cx,
      cy,
      cost: check.cost,
      duration: check.duration,
      remaining: check.duration,
      resultTerrain: this.resultTerrainOf(op),
    };
    this.nextJobId += 1;
    this.jobs.push(job);
    this.grid.setFlag(cx, cy, CellFlag.UnderConstruction, true);

    this.events?.emit('engineering_started', {
      jobId: job.id,
      op,
      cx,
      cy,
      cost: job.cost,
      duration: job.duration,
    });

    return { ...check, quotaLeft: this.quotaOf(op), job };
  }

  beginDig(cx: number, cy: number): OperationCheck & { job?: EngineeringJob } {
    return this.begin('dig', cx, cy);
  }

  beginBridge(cx: number, cy: number): OperationCheck & { job?: EngineeringJob } {
    return this.begin('bridge', cx, cy);
  }

  /** Advances construction; returns the jobs that finished this tick. */
  tick(dt: Seconds): EngineeringJob[] {
    if (this.jobs.length === 0) return [];
    const finished: EngineeringJob[] = [];

    for (let i = this.jobs.length - 1; i >= 0; i -= 1) {
      const job = this.jobs[i] as EngineeringJob;
      job.remaining -= dt;
      if (job.remaining > 0) continue;
      this.jobs.splice(i, 1);
      finished.push(job);
    }

    if (finished.length === 0) return finished;

    // Oldest first, so listeners see completions in the order they were queued.
    finished.reverse();
    for (const job of finished) {
      this.grid.setFlag(job.cx, job.cy, CellFlag.UnderConstruction, false);
      this.grid.setTerrain(job.cx, job.cy, job.resultTerrain, { silent: true });
      if (job.op === 'bridge') this.grid.setFlag(job.cx, job.cy, CellFlag.PlayerBridge, true);
      this.events?.emit('engineering_completed', {
        jobId: job.id,
        op: job.op,
        cx: job.cx,
        cy: job.cy,
        cost: job.cost,
        duration: job.duration,
        terrain: job.resultTerrain,
      });
    }

    this.grid.bumpVersion();
    this.events?.emit('terrain_changed', {
      cells: finished.map((job) => ({ cx: job.cx, cy: job.cy })),
      reason: 'engineering',
    });
    return finished;
  }

  /**
   * Sapper crab payload (GDD §8.1). The charge is *not* returned — that is what
   * makes re-routing an ongoing fight rather than a one-off decision.
   */
  destroyBridge(cx: number, cy: number, byEnemy?: number): boolean {
    if (!this.grid.isPlayerBridge(cx, cy)) return false;
    this.grid.setFlag(cx, cy, CellFlag.PlayerBridge, false);
    this.grid.setTerrain(cx, cy, this.grid.baseTerrainAt(cx, cy), { silent: true });
    this.grid.bumpVersion();
    this.events?.emit('bridge_destroyed', { cx, cy, byEnemy });
    this.events?.emit('terrain_changed', { cells: [{ cx, cy }], reason: 'bridge_destroyed' });
    return true;
  }

  /** Mid-run replenishment (GDD §5.2: map 1 hands out one extra dig at wave 15). */
  grantQuota(dig: number, bridge: number, wave = 0): void {
    if (dig === 0 && bridge === 0) return;
    this.digRemaining += dig;
    this.bridgeRemaining += bridge;
    this.events?.emit('engineering_quota_granted', { dig, bridge, wave });
  }

  applyGrantsForWave(wave: number): void {
    for (const grant of this.grid.def.engineering.grants ?? []) {
      if (grant.wave === wave) this.grantQuota(grant.dig ?? 0, grant.bridge ?? 0, wave);
    }
  }

  jobAt(cx: number, cy: number): EngineeringJob | undefined {
    return this.jobs.find((job) => job.cx === cx && job.cy === cy);
  }

  private resultTerrainOf(op: EngineeringOp): TerrainName {
    return op === 'dig' ? this.config.digResult : this.config.bridgeResult;
  }

  /** Terrain the board will have once every running job completes. */
  private pendingOverrides(): Map<number, TerrainName> {
    const overrides = new Map<number, TerrainName>();
    for (const job of this.jobs) {
      overrides.set(this.grid.index(job.cx, job.cy), job.resultTerrain);
    }
    return overrides;
  }
}
