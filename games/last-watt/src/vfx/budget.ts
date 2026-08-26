import { VfxPriority } from './events';

/**
 * 粒子预算与降级立法（GDD 15.3）。
 *
 * 这些数字是程序约束，不是建议值：超限时按「事件 > combo > 持续状态 > 环境氛围」丢弃，
 * 且**事件与 combo 粒子永不降级**——玩家读战场靠的就是它们。
 */
export const VFX_BUDGET = {
  /** 同屏活跃发射器总数 */
  maxEmitters: 64,
  /** 其中循环发射器 */
  maxLoopEmitters: 24,
  /** 其中一次性发射器 */
  maxOneShotEmitters: 40,
  /** GPU 粒子总量 */
  maxParticles: 20_000,
  /** 贴花上限 */
  maxDecals: 64,
  /** 动态点光上限 */
  maxDynamicLights: 8,
  /** 同类循环发射器超过这个数就减半发射率、隔帧更新 */
  sameKindLoopThreshold: 10,
} as const;

/**
 * 降级阶梯，顺序写死（GDD 15.3「未达 60fps 时降级顺序」）。
 * 升档只在连续掉帧时发生，降档要更迟钝，避免在 60fps 边缘反复横跳。
 */
export enum DegradeLevel {
  /** 满配 */
  None = 0,
  /** 砍环境氛围粒子 */
  NoAmbient = 1,
  /** 再砍循环特效发射率 */
  HalfLoopRate = 2,
  /** 再砍贴花上限 */
  FewerDecals = 3,
  /** 再砍动态点光 */
  FewerLights = 4,
}

export interface BudgetSnapshot {
  aliveParticles: number;
  loopEmitters: number;
  oneShotEmitters: number;
  degrade: DegradeLevel;
  frameMsEma: number;
  droppedRequests: number;
}

const TARGET_FRAME_MS = 1000 / 60;

export class VfxBudget {
  private loopKinds = new Map<string, number>();
  private loopCount = 0;
  private oneShotCount = 0;
  private aliveProvider: () => number = () => 0;
  private frameMsEma = TARGET_FRAME_MS;
  private overBudgetFrames = 0;
  private healthyFrames = 0;
  private droppedRequests = 0;
  private frameIndex = 0;

  degrade: DegradeLevel = DegradeLevel.None;
  /** 关掉自动降级（压测/录屏时需要固定画质） */
  autoDegrade = true;

  bindAliveProvider(fn: () => number): void {
    this.aliveProvider = fn;
  }

  beginFrame(frameMs: number): void {
    this.frameIndex++;
    this.oneShotCount = 0;
    this.droppedRequests = 0;
    // 20 帧时间常数：单帧毛刺不该触发降级
    this.frameMsEma += (frameMs - this.frameMsEma) * 0.05;

    if (!this.autoDegrade) return;

    if (this.frameMsEma > TARGET_FRAME_MS * 1.08) {
      this.overBudgetFrames++;
      this.healthyFrames = 0;
      if (this.overBudgetFrames > 30 && this.degrade < DegradeLevel.FewerLights) {
        this.degrade++;
        this.overBudgetFrames = 0;
      }
    } else if (this.frameMsEma < TARGET_FRAME_MS * 0.88) {
      this.healthyFrames++;
      this.overBudgetFrames = 0;
      // 恢复要慢：180 帧（约 3 秒）稳住才升回去
      if (this.healthyFrames > 180 && this.degrade > DegradeLevel.None) {
        this.degrade--;
        this.healthyFrames = 0;
      }
    }
  }

  /**
   * 一次发射请求能拿到多少粒子。
   * @returns 允许的粒子数；0 表示整条请求被丢弃
   */
  allow(priority: VfxPriority, requested: number): number {
    const alive = this.aliveProvider();
    const headroom = VFX_BUDGET.maxParticles - alive;

    if (headroom <= 0) {
      // 池满时只有事件级还能挤进来（环形缓冲会覆盖最老的粒子）
      if (priority < VfxPriority.Event) {
        this.droppedRequests++;
        return 0;
      }
      return requested;
    }

    if (priority >= VfxPriority.Combo) {
      // combo 与事件永不降级，也不受发射器计数限制
      this.oneShotCount++;
      return Math.min(requested, headroom);
    }

    if (priority === VfxPriority.Ambient && this.degrade >= DegradeLevel.NoAmbient) {
      this.droppedRequests++;
      return 0;
    }

    if (this.oneShotCount >= VFX_BUDGET.maxOneShotEmitters) {
      this.droppedRequests++;
      return 0;
    }

    // 低优先级只能吃掉剩余额度的一部分，给随时可能到来的 combo 留位置
    const share = priority === VfxPriority.Ambient ? 0.25 : 0.5;
    const cap = Math.floor(headroom * share);
    this.oneShotCount++;
    const granted = Math.min(requested, cap);
    if (granted < requested) this.droppedRequests++;
    return granted;
  }

  /** 循环发射器登记。同类超过阈值仍允许存在，但发射率会被 `loopRate` 砍半。 */
  acquireLoop(kind: string, priority: VfxPriority): boolean {
    if (this.loopCount >= VFX_BUDGET.maxLoopEmitters && priority < VfxPriority.Event) {
      this.droppedRequests++;
      return false;
    }
    this.loopKinds.set(kind, (this.loopKinds.get(kind) ?? 0) + 1);
    this.loopCount++;
    return true;
  }

  releaseLoop(kind: string): void {
    const n = this.loopKinds.get(kind);
    if (n === undefined) return;
    if (n <= 1) this.loopKinds.delete(kind);
    else this.loopKinds.set(kind, n - 1);
    this.loopCount = Math.max(0, this.loopCount - 1);
  }

  /** 同类循环发射器 >10 个时发射率减半（GDD 15.2 防糊规则 ③）。 */
  loopRate(kind: string): number {
    let rate = 1;
    if ((this.loopKinds.get(kind) ?? 0) > VFX_BUDGET.sameKindLoopThreshold) rate *= 0.5;
    if (this.degrade >= DegradeLevel.HalfLoopRate) rate *= 0.5;
    return rate;
  }

  /** 隔帧更新：同类循环发射器过多时，用帧奇偶把负载摊开。 */
  shouldTickLoop(kind: string, emitterIndex: number): boolean {
    const crowded = (this.loopKinds.get(kind) ?? 0) > VFX_BUDGET.sameKindLoopThreshold;
    if (!crowded && this.degrade < DegradeLevel.HalfLoopRate) return true;
    return (this.frameIndex + emitterIndex) % 2 === 0;
  }

  get decalCap(): number {
    return this.degrade >= DegradeLevel.FewerDecals
      ? Math.floor(VFX_BUDGET.maxDecals / 2)
      : VFX_BUDGET.maxDecals;
  }

  get dynamicLightCap(): number {
    return this.degrade >= DegradeLevel.FewerLights
      ? Math.floor(VFX_BUDGET.maxDynamicLights / 2)
      : VFX_BUDGET.maxDynamicLights;
  }

  get snapshot(): BudgetSnapshot {
    return {
      aliveParticles: this.aliveProvider(),
      loopEmitters: this.loopCount,
      oneShotEmitters: this.oneShotCount,
      degrade: this.degrade,
      frameMsEma: this.frameMsEma,
      droppedRequests: this.droppedRequests,
    };
  }

  /** 违反预算时返回问题列表，供 bench / 自检断言（GDD M3 验收：计数器全程不超预算）。 */
  violations(): string[] {
    const out: string[] = [];
    const s = this.snapshot;
    if (s.aliveParticles > VFX_BUDGET.maxParticles) {
      out.push(`粒子总量 ${s.aliveParticles} > ${VFX_BUDGET.maxParticles}`);
    }
    if (s.loopEmitters > VFX_BUDGET.maxLoopEmitters) {
      out.push(`循环发射器 ${s.loopEmitters} > ${VFX_BUDGET.maxLoopEmitters}`);
    }
    if (s.oneShotEmitters > VFX_BUDGET.maxOneShotEmitters) {
      out.push(`一次性发射器 ${s.oneShotEmitters} > ${VFX_BUDGET.maxOneShotEmitters}`);
    }
    if (s.loopEmitters + s.oneShotEmitters > VFX_BUDGET.maxEmitters) {
      out.push(`发射器总数 ${s.loopEmitters + s.oneShotEmitters} > ${VFX_BUDGET.maxEmitters}`);
    }
    return out;
  }
}
