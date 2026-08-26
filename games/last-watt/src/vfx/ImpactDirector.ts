import { PALETTE, type RGBA } from './palette';

/**
 * 屏幕冲击统一入口（GDD 17.2 第 12 项：顿帧 / 震动 / 闪光统一入口）。
 *
 * 两条硬规则写死在这里，任何效果都绕不过去（GDD 15.2 防糊规则 ①）：
 * 1. **顿帧全局 100ms 内最多 1 次** —— 后来的请求直接驳回，不排队、不延后；
 * 2. **震动不叠加，取最大档** —— 同帧多次自爆只抖一次，且不超过最大档。
 *
 * 本类不碰渲染：它只维护状态，由引擎读 `timeScale` / `shake` 施加到相机，
 * 由 UI 层读 `flash` / `vignette` 画全屏叠加层。这样换渲染后端不用改冲击逻辑。
 */

export enum ShakeTier {
  None = 0,
  /** 轻：大招、丢区 */
  Light = 1,
  /** 中：拆迁蟹自爆，全游戏最大档 */
  Medium = 2,
}

const SHAKE_AMPLITUDE: Record<ShakeTier, number> = {
  [ShakeTier.None]: 0,
  [ShakeTier.Light]: 0.35,
  [ShakeTier.Medium]: 1,
};

export interface FlashRequest {
  color: RGBA;
  /** 峰值保持时长，1 帧 ≈ 16.7 */
  holdMs?: number;
  /** 衰减时长 */
  decayMs?: number;
  /** 峰值不透明度 0..1 */
  intensity?: number;
}

export interface VignetteRequest {
  color: RGBA;
  intensity?: number;
  /** 淡入时长 */
  attackMs?: number;
  /** 保持时长；Infinity = 常驻（丢区），需手动 clearVignette */
  holdMs?: number;
  releaseMs?: number;
}

export interface ImpactState {
  /** 0 = 顿帧中（逻辑与粒子都应停住），1 = 正常 */
  timeScale: number;
  /** 屏幕空间抖动偏移，单位是「屏幕高度的比例」，engine 自行换算 */
  shake: { x: number; y: number };
  flash: { color: RGBA; alpha: number };
  vignette: { color: RGBA; alpha: number };
}

export interface ImpactStats {
  hitstopsAccepted: number;
  hitstopsRejected: number;
  shakesMerged: number;
}

/** 冲击预设：效果代码引用名字，数值集中在这里调（GDD M4「冲击节流参数调优」）。 */
export const IMPACT_PRESETS = {
  /** 冰碎：60ms 顿帧 + 1 帧白闪（GDD 15.2） */
  iceShatter: {
    hitstopMs: 60,
    flash: { color: PALETTE.ice, holdMs: 17, decayMs: 90, intensity: 0.62 } as FlashRequest,
  },
  /** 大招·主控过载：80ms 顿帧 + 全屏青闪 + 轻震 0.2s */
  ultimate: {
    hitstopMs: 80,
    flash: { color: PALETTE.electric, holdMs: 17, decayMs: 220, intensity: 0.7 } as FlashRequest,
    shake: { tier: ShakeTier.Light, durationMs: 200 },
  },
  /** 拆迁蟹自爆：60ms 顿帧 + 橙闪 + 中震（最大档） */
  sapperBlast: {
    hitstopMs: 60,
    flash: { color: PALETTE.fire, holdMs: 17, decayMs: 140, intensity: 0.5 },
    shake: { tier: ShakeTier.Medium, durationMs: 260 },
  },
} as const;

const TRANSPARENT: RGBA = [0, 0, 0, 0];

export class ImpactDirector {
  /** 顿帧最小间隔，GDD 立法值 */
  readonly hitstopCooldownMs = 100;

  private nowMs = 0;
  private hitstopRemainingMs = 0;
  private lastHitstopAtMs = -Infinity;

  private flashColor: RGBA = TRANSPARENT;
  private flashPeak = 0;
  private flashElapsedMs = 0;
  private flashHoldMs = 0;
  private flashDecayMs = 1;

  private shakeTier = ShakeTier.None;
  private shakeElapsedMs = 0;
  private shakeDurationMs = 0;
  private shakeSeed = 0;

  private vignetteColor: RGBA = TRANSPARENT;
  private vignettePeak = 0;
  private vignetteElapsedMs = 0;
  private vignetteAttackMs = 0;
  private vignetteHoldMs = 0;
  private vignetteReleaseMs = 1;

  private stats: ImpactStats = { hitstopsAccepted: 0, hitstopsRejected: 0, shakesMerged: 0 };

  /**
   * 请求顿帧。
   * @returns 是否被接受；100ms 冷却内的请求一律驳回（这是防糊立法，不是 bug）
   */
  requestHitstop(durationMs: number): boolean {
    if (durationMs <= 0) return false;
    if (this.nowMs - this.lastHitstopAtMs < this.hitstopCooldownMs) {
      this.stats.hitstopsRejected++;
      return false;
    }
    this.lastHitstopAtMs = this.nowMs;
    this.hitstopRemainingMs = durationMs;
    this.stats.hitstopsAccepted++;
    return true;
  }

  /** 闪光不排队：同时来多个取「当前 alpha 更高」的那个。 */
  requestFlash(req: FlashRequest): void {
    const peak = req.intensity ?? 0.6;
    if (peak <= this.currentFlashAlpha()) return;
    this.flashColor = req.color;
    this.flashPeak = peak;
    this.flashHoldMs = req.holdMs ?? 17;
    this.flashDecayMs = Math.max(req.decayMs ?? 100, 1);
    this.flashElapsedMs = 0;
  }

  /** 震动取最大档，不叠加（GDD 15.2 防糊规则 ①）。 */
  requestShake(tier: ShakeTier, durationMs: number): void {
    if (tier === ShakeTier.None || durationMs <= 0) return;
    const active = this.shakeElapsedMs < this.shakeDurationMs;
    if (active) {
      this.stats.shakesMerged++;
      if (tier < this.shakeTier) {
        // 已有更强的震动在跑，弱请求整个丢掉。
        // 注意不能「只续时长不降档」：衰减包络是 1 - elapsed/duration，
        // 拉长 duration 会把当前振幅顶上去，等于从后门实现了叠加。
        return;
      }
    }
    this.shakeTier = tier;
    this.shakeDurationMs = durationMs;
    this.shakeElapsedMs = 0;
    this.shakeSeed = (this.shakeSeed + 1) % 997;
  }

  requestVignette(req: VignetteRequest): void {
    this.vignetteColor = req.color;
    this.vignettePeak = req.intensity ?? 0.35;
    this.vignetteAttackMs = req.attackMs ?? 120;
    this.vignetteHoldMs = req.holdMs ?? 300;
    this.vignetteReleaseMs = Math.max(req.releaseMs ?? 400, 1);
    this.vignetteElapsedMs = 0;
  }

  clearVignette(releaseMs = 400): void {
    this.vignetteHoldMs = 0;
    this.vignetteAttackMs = 0;
    this.vignetteReleaseMs = Math.max(releaseMs, 1);
    this.vignetteElapsedMs = 0;
    this.vignettePeak = this.currentVignetteAlpha();
  }

  /** 一次性播放预设。 */
  play(preset: {
    hitstopMs?: number;
    flash?: FlashRequest;
    shake?: { tier: ShakeTier; durationMs: number };
  }): void {
    if (preset.hitstopMs) this.requestHitstop(preset.hitstopMs);
    if (preset.flash) this.requestFlash(preset.flash);
    if (preset.shake) this.requestShake(preset.shake.tier, preset.shake.durationMs);
  }

  /**
   * @param realDtMs 真实帧时长（**不要**乘 timeScale，否则顿帧永远出不来）
   */
  update(realDtMs: number): ImpactState {
    this.nowMs += realDtMs;
    this.hitstopRemainingMs = Math.max(0, this.hitstopRemainingMs - realDtMs);
    this.flashElapsedMs += realDtMs;
    this.shakeElapsedMs += realDtMs;
    this.vignetteElapsedMs += realDtMs;
    return this.state;
  }

  get timeScale(): number {
    return this.hitstopRemainingMs > 0 ? 0 : 1;
  }

  get isHitstopped(): boolean {
    return this.hitstopRemainingMs > 0;
  }

  get state(): ImpactState {
    return {
      timeScale: this.timeScale,
      shake: this.currentShakeOffset(),
      flash: { color: this.flashColor, alpha: this.currentFlashAlpha() },
      vignette: { color: this.vignetteColor, alpha: this.currentVignetteAlpha() },
    };
  }

  get diagnostics(): ImpactStats {
    return { ...this.stats };
  }

  private currentFlashAlpha(): number {
    if (this.flashPeak <= 0) return 0;
    const t = this.flashElapsedMs;
    if (t <= this.flashHoldMs) return this.flashPeak;
    const k = (t - this.flashHoldMs) / this.flashDecayMs;
    if (k >= 1) return 0;
    // 二次衰减：白闪收得干净，不留一层灰纱
    return this.flashPeak * (1 - k) * (1 - k);
  }

  private currentVignetteAlpha(): number {
    if (this.vignettePeak <= 0) return 0;
    const t = this.vignetteElapsedMs;
    if (t < this.vignetteAttackMs) return this.vignettePeak * (t / this.vignetteAttackMs);
    if (this.vignetteHoldMs === Infinity) return this.vignettePeak;
    const held = this.vignetteAttackMs + this.vignetteHoldMs;
    if (t < held) return this.vignettePeak;
    const k = (t - held) / this.vignetteReleaseMs;
    return k >= 1 ? 0 : this.vignettePeak * (1 - k);
  }

  private currentShakeOffset(): { x: number; y: number } {
    if (this.shakeElapsedMs >= this.shakeDurationMs || this.shakeTier === ShakeTier.None) {
      return { x: 0, y: 0 };
    }
    const k = 1 - this.shakeElapsedMs / this.shakeDurationMs;
    const envelope = k * k;
    const amp = SHAKE_AMPLITUDE[this.shakeTier] * 0.012 * envelope;
    const t = this.shakeElapsedMs / 1000;
    const s = this.shakeSeed;
    // 双频正弦：比随机抖动更可控，也不会在低帧率下变成瞬移
    const x = Math.sin(t * 97 + s) * 0.7 + Math.sin(t * 41.3 + s * 2.1) * 0.3;
    const y = Math.cos(t * 88.6 + s * 1.7) * 0.7 + Math.cos(t * 53.9 + s) * 0.3;
    return { x: x * amp, y: y * amp };
  }
}
