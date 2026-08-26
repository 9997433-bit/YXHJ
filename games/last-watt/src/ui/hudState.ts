import type { IconName } from './icons';

/**
 * HUD 数据契约（GDD 第 14 章信息架构）。
 *
 * 单向数据流：玩法层每帧（或状态变化时）推一份 `HudState` 进来，HUD 只读不改；
 * 玩家的输入通过 `HudCallbacks` 回到玩法层。HUD 自己**不持有任何游戏状态**，
 * 因此可以被自检、截图脚本用假数据直接驱动。
 */

export interface WavePreviewEntry {
  /** 敌人定义 id，用于埋点与调试 */
  defId: string;
  icon: IconName;
  count: number;
  /** 飞行单位：预览里要跳出来提醒玩家检查对空 */
  air?: boolean;
  /** 破阵类型：拆（爆破工兵）/ 疗（修理无人机） */
  threat?: 'breaker' | 'healer';
  label?: string;
}

export interface BuildItemState {
  id: string;
  name: string;
  icon: IconName;
  cost: number;
  /** 常驻占用的供电点数，0 表示不耗电 */
  powerCost: number;
  targetsAir: boolean;
  /** 本波是否已解锁（GDD 2.2：图纸逐波解锁） */
  unlocked: boolean;
  /** 解锁波次。未解锁时角标要写出来——只说「锁着」等于没说 */
  unlockWave?: number;
  hotkey?: string;
}

export type TargetPriority = 'first' | 'strongest' | 'air';

export interface TowerUpgradeOption {
  id: string;
  name: string;
  description: string;
  cost: number;
}

export interface TowerInspectState {
  towerId: string;
  name: string;
  icon: IconName;
  level: number;
  stats: { label: string; value: string }[];
  upgrades: TowerUpgradeOption[];
  priority: TargetPriority;
  /** 卖出返还（GDD 6.1：现价 70%） */
  sellRefund: number;
  /** 电容站专属：超载按钮 */
  overload?: { cost: number; available: boolean };
}

export interface ZoneThreshold {
  /** 完整度阈值，GDD 第 10 章的 80 / 50 */
  value: number;
  label: string;
  lost: boolean;
}

export interface HudState {
  gold: number;
  wave: { current: number; total: number; inProgress: boolean };
  nextWave: {
    preview: WavePreviewEntry[];
    /** 提前开波奖励百分比，GDD 6.1 为 10 */
    earlyBonusPercent: number;
    canCallEarly: boolean;
  };
  power: {
    used: number;
    cap: number;
    /** >0 时说明刚才有一次超上限的建造尝试，供电条要闪警红 */
    deficit: number;
  };
  battery: {
    value: number;
    max: number;
    /** 超载门槛，环上常亮细刻（GDD 7.1：每次 20） */
    overloadCost: number;
  };
  integrity: {
    value: number;
    max: number;
    thresholds: ZoneThreshold[];
  };
  build: BuildItemState[];
  selectedBuildId: string | null;
  ultimate: { charges: number; maxCharges: number };
  engineering: {
    digLeft: number;
    bridgeLeft: number;
    digCost: number;
    bridgeCost: number;
    /** 当前处于「已选中待落点」状态的工程操作 */
    armed: 'dig' | 'bridge' | null;
  };
  inspector: TowerInspectState | null;
  radio: { speaker: string; line: string; id: string } | null;
}

export interface HudCallbacks {
  onBuildSelect?(id: string): void;
  onCallWaveEarly?(): void;
  onUltimate?(): void;
  onEngineering?(kind: 'dig' | 'bridge'): void;
  onUpgrade?(towerId: string, upgradeId: string): void;
  onSell?(towerId: string): void;
  onOverload?(towerId: string): void;
  onTargetPriority?(towerId: string, priority: TargetPriority): void;
  onCloseInspector?(): void;
}

/** 空状态：HUD 挂载后到第一份真实状态之间显示这个，避免 undefined 分支散落各处。 */
export function createEmptyHudState(): HudState {
  return {
    gold: 0,
    wave: { current: 0, total: 20, inProgress: false },
    nextWave: { preview: [], earlyBonusPercent: 10, canCallEarly: false },
    power: { used: 0, cap: 8, deficit: 0 },
    battery: { value: 0, max: 100, overloadCost: 20 },
    integrity: {
      value: 100,
      max: 100,
      thresholds: [
        { value: 80, label: 'A 区', lost: false },
        { value: 50, label: 'B 区', lost: false },
      ],
    },
    build: [],
    selectedBuildId: null,
    ultimate: { charges: 0, maxCharges: 2 },
    engineering: { digLeft: 0, bridgeLeft: 0, digCost: 50, bridgeCost: 80, armed: null },
    inspector: null,
    radio: null,
  };
}
