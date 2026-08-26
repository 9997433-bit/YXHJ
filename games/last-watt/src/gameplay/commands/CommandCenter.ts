/**
 * Player intent, in one place (GDD §14.1 bottom bar + 右下工程按钮).
 *
 * Two kinds of input reach the gameplay layer and they need different shapes:
 *
 *  - **Buttons** are stateful. 挖沟 arms a mode, the board highlights every
 *    legal target, and the *next* click on a cell performs the work. So the
 *    dig button is a tiny state machine, not a function call, and the HUD needs
 *    to read that state back (`armed`, `targets`, `buttons()`).
 *  - **Direct commands** (`dig(cx, cy)`, `build(defId, cx, cy)`) skip the arming
 *    step, which is what hotkeys, the tutorial script and the tests use.
 *
 * Everything returns a `CommandResult` with an enumerated reason and the ready
 * made Chinese message, so the UI never has to reproduce a rule to grey a
 * button out or explain a refusal.
 */

import type { CellCoord } from '../types';
import type { EngineeringOp, GameplayEvents } from '../events';
import type { EngineeringSystem, OperationCheck } from '../engineering/EngineeringSystem';
import type { BuildCheck, BuildSystem } from '../build/BuildSystem';
import type { Economy } from '../economy/Economy';
import type { WaveRunner } from '../waves/WaveRunner';

export type ToolKind = EngineeringOp | 'build';

export type CommandStatus =
  | 'ok'
  | 'nothing_armed'
  | 'no_target'
  | 'rejected'
  | 'not_ready'
  | 'insufficient_gold'
  | 'insufficient_battery'
  | 'no_charge'
  | 'wave_in_progress'
  | 'run_over';

export interface CommandResult {
  ok: boolean;
  status: CommandStatus;
  message: string;
  /** The legality report, when the command ran one. */
  check?: OperationCheck | BuildCheck;
}

/** What a HUD button needs to render itself without knowing any rules. */
export interface ButtonState {
  enabled: boolean;
  /** Gold price, 0 when free. */
  cost: number;
  /** Uses left, for the 角标 on the engineering buttons. */
  badge?: number;
  /** Why it is greyed out. */
  message: string;
  active?: boolean;
}

export interface CommandButtons {
  dig: ButtonState;
  bridge: ButtonState;
  startWave: ButtonState;
  repair: ButtonState;
  ultimate: ButtonState;
}

export interface CommandCenterOptions {
  engineering: EngineeringSystem;
  build: BuildSystem;
  economy: Economy;
  waves: WaveRunner;
  events?: GameplayEvents;
  startWave: (early: boolean) => boolean;
  fireUltimate?: () => boolean;
  activateTower?: (towerId: number) => boolean;
  upgradeTower?: (towerId: number, upgradeId: string) => boolean;
  /** Blocks everything once the run is decided. */
  isRunOver?: () => boolean;
}

const ok = (message = ''): CommandResult => ({ ok: true, status: 'ok', message });
const fail = (status: CommandStatus, message: string): CommandResult => ({
  ok: false,
  status,
  message,
});

export class CommandCenter {
  private readonly engineering: EngineeringSystem;
  private readonly build: BuildSystem;
  private readonly economy: Economy;
  private readonly waves: WaveRunner;
  private readonly events: GameplayEvents | undefined;
  private readonly startWaveFn: (early: boolean) => boolean;
  private readonly fireUltimateFn: (() => boolean) | undefined;
  private readonly activateTowerFn: ((towerId: number) => boolean) | undefined;
  private readonly upgradeTowerFn: ((towerId: number, upgradeId: string) => boolean) | undefined;
  private readonly isRunOver: () => boolean;

  private tool: ToolKind | null = null;
  private buildId: string | null = null;

  constructor(options: CommandCenterOptions) {
    this.engineering = options.engineering;
    this.build = options.build;
    this.economy = options.economy;
    this.waves = options.waves;
    this.events = options.events;
    this.startWaveFn = options.startWave;
    this.fireUltimateFn = options.fireUltimate;
    this.activateTowerFn = options.activateTower;
    this.upgradeTowerFn = options.upgradeTower;
    this.isRunOver = options.isRunOver ?? (() => false);
  }

  // -------------------------------------------------------------------------
  // Arming
  // -------------------------------------------------------------------------

  /** `'dig' | 'bridge' | 'build' | null`, for the HUD's pressed state. */
  get armed(): ToolKind | null {
    return this.tool;
  }

  get selectedBuildId(): string | null {
    return this.buildId;
  }

  /** The 挖沟 button. Pressing it again disarms, like every other tool. */
  armDig(): CommandResult {
    return this.armEngineering('dig');
  }

  armBridge(): CommandResult {
    return this.armEngineering('bridge');
  }

  selectBuild(defId: string): CommandResult {
    if (this.isRunOver()) return fail('run_over', '本局已结束');
    if (this.tool === 'build' && this.buildId === defId) {
      this.disarm();
      return ok();
    }
    if (!this.build.isUnlocked(defId)) {
      const wave = this.build.unlockWaveOf(defId);
      return fail('rejected', wave === null ? '没有这个图纸' : `图纸第 ${wave} 波解锁`);
    }
    this.tool = 'build';
    this.buildId = defId;
    this.events?.emit('tool_armed', { tool: 'build', defId });
    return ok();
  }

  disarm(): void {
    if (this.tool === null) return;
    this.tool = null;
    this.buildId = null;
    this.events?.emit('tool_armed', { tool: null });
  }

  /** Legal cells for whatever is armed; `[]` when nothing is. */
  targets(): CellCoord[] {
    if (this.tool === 'dig' || this.tool === 'bridge') return this.engineering.legalTargets(this.tool);
    if (this.tool === 'build' && this.buildId) return this.build.legalTargets(this.buildId);
    return [];
  }

  /**
   * Routes a click on the board through whatever is armed. A successful
   * engineering job disarms (the charge is spent); building stays armed so the
   * player can drop a row of machine guns.
   */
  clickCell(cx: number, cy: number): CommandResult {
    switch (this.tool) {
      case null:
        return fail('nothing_armed', '先选一个工具');
      case 'dig':
      case 'bridge': {
        const result = this.engineeringAt(this.tool, cx, cy);
        if (result.ok) this.disarm();
        return result;
      }
      case 'build': {
        if (!this.buildId) return fail('nothing_armed', '先选一个图纸');
        return this.buildAt(this.buildId, cx, cy);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Direct commands
  // -------------------------------------------------------------------------

  dig(cx: number, cy: number): CommandResult {
    return this.engineeringAt('dig', cx, cy);
  }

  bridge(cx: number, cy: number): CommandResult {
    return this.engineeringAt('bridge', cx, cy);
  }

  buildAt(defId: string, cx: number, cy: number): CommandResult {
    if (this.isRunOver()) return fail('run_over', '本局已结束');
    const result = this.build.place(defId, cx, cy);
    if (!result.ok) return { ok: false, status: 'rejected', message: result.message, check: result };
    return { ...ok(), check: result };
  }

  sellAt(cx: number, cy: number): CommandResult {
    const refund = this.build.sellAt(cx, cy);
    if (refund <= 0 && !this.build.towerAt(cx, cy)) return fail('no_target', '这里没有可卖的建筑');
    return ok(`返还 ${refund}`);
  }

  sell(towerId: number): CommandResult {
    const refund = this.build.sell(towerId);
    if (refund <= 0) return fail('no_target', '这里没有可卖的建筑');
    return ok(`返还 ${refund}`);
  }

  upgrade(towerId: number, upgradeId: string): CommandResult {
    if (!this.upgradeTowerFn) return fail('not_ready', '战斗系统未接入');
    return this.upgradeTowerFn(towerId, upgradeId)
      ? ok()
      : fail('rejected', '无法升级（已升级或图纸不符）');
  }

  /** 电容站超载 (GDD §7.3.4): combat checks the battery through the port. */
  overload(towerId: number): CommandResult {
    if (!this.activateTowerFn) return fail('not_ready', '战斗系统未接入');
    if (this.economy.battery < this.economy.rules.overloadBatteryCost) {
      return fail('insufficient_battery', '储能不足');
    }
    return this.activateTowerFn(towerId) ? ok() : fail('rejected', '电容站尚未就绪');
  }

  /** 主控过载 (GDD §9). */
  ultimate(): CommandResult {
    if (this.isRunOver()) return fail('run_over', '本局已结束');
    if (this.economy.ultimateCharges <= 0) return fail('no_charge', '大招未充能');
    if (!this.fireUltimateFn) return fail('not_ready', '战斗系统未接入');
    if (!this.fireUltimateFn()) return fail('rejected', '大招释放失败');
    return ok();
  }

  startWave(options: { early?: boolean } = {}): CommandResult {
    if (this.isRunOver()) return fail('run_over', '本局已结束');
    if (this.waves.state !== 'preparing') return fail('wave_in_progress', '本波尚未结束');
    return this.startWaveFn(options.early ?? false) ? ok() : fail('not_ready', '没有下一波了');
  }

  /** 波间修复：100 金 = +20 完整度 (GDD §10). */
  repair(): CommandResult {
    if (this.isRunOver()) return fail('run_over', '本局已结束');
    if (this.waves.state !== 'preparing') return fail('wave_in_progress', '只能在波间修复');
    if (this.economy.integrity >= this.economy.rules.maxIntegrity) {
      return fail('rejected', '核心完整');
    }
    if (!this.economy.canAfford(this.economy.rules.repairCost)) {
      return fail('insufficient_gold', '金币不足');
    }
    return this.economy.repair() ? ok() : fail('rejected', '修复失败');
  }

  // -------------------------------------------------------------------------
  // Button state
  // -------------------------------------------------------------------------

  buttons(): CommandButtons {
    const preparing = this.waves.state === 'preparing';
    const over = this.isRunOver();
    return {
      dig: this.engineeringButton('dig'),
      bridge: this.engineeringButton('bridge'),
      startWave: {
        enabled: !over && preparing && this.waves.nextWave !== null,
        cost: 0,
        message: over ? '本局已结束' : preparing ? '' : '本波进行中',
      },
      repair: {
        enabled:
          !over &&
          preparing &&
          this.economy.integrity < this.economy.rules.maxIntegrity &&
          this.economy.canAfford(this.economy.rules.repairCost),
        cost: this.economy.rules.repairCost,
        message: preparing ? '' : '只能在波间修复',
      },
      ultimate: {
        enabled: !over && this.economy.ultimateCharges > 0,
        cost: 0,
        badge: this.economy.ultimateCharges,
        message: this.economy.ultimateCharges > 0 ? '' : '大招未充能',
      },
    };
  }

  private engineeringButton(op: EngineeringOp): ButtonState {
    const cost = this.engineering.costOf(op);
    const quota = this.engineering.quotaOf(op);
    const affordable = this.economy.canAfford(cost);
    const hasTargets = quota > 0 && affordable && this.engineering.legalTargets(op).length > 0;
    return {
      enabled: !this.isRunOver() && hasTargets,
      cost,
      badge: quota,
      active: this.tool === op,
      message: quota <= 0 ? '工程次数已用完' : !affordable ? '金币不足' : hasTargets ? '' : '没有可施工的格子',
    };
  }

  private armEngineering(op: EngineeringOp): CommandResult {
    if (this.isRunOver()) return fail('run_over', '本局已结束');
    if (this.tool === op) {
      this.disarm();
      return ok();
    }
    if (this.engineering.quotaOf(op) <= 0) return fail('rejected', '工程次数已用完');
    if (!this.economy.canAfford(this.engineering.costOf(op))) {
      return fail('insufficient_gold', '金币不足');
    }
    this.tool = op;
    this.buildId = null;
    this.events?.emit('tool_armed', { tool: op });
    return ok();
  }

  private engineeringAt(op: EngineeringOp, cx: number, cy: number): CommandResult {
    if (this.isRunOver()) return fail('run_over', '本局已结束');
    const result = this.engineering.begin(op, cx, cy);
    if (!result.ok) {
      return {
        ok: false,
        status: result.reason === 'insufficient_gold' ? 'insufficient_gold' : 'rejected',
        message: result.message,
        check: result,
      };
    }
    return { ...ok(), check: result };
  }
}
