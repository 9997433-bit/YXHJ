import type { CombatEventMap, CombatEventName } from '../combat/events';
import { ShakeTier, type FlashRequest } from './ImpactDirector';
import { PALETTE, PALETTE_HEX, hexToRgba, type PaletteKey, type RGBA } from './palette';
import type { EmitterHandle, Vec3Like } from './events';
import type { VfxSystem } from './VfxSystem';

/**
 * 战斗事件 → 粒子演出的桥。
 *
 * 战斗层「只发事件不碰粒子」，本文件是那句话的兑现处：它是 `src/vfx` 里唯一
 * 知道战斗事件长什么样的文件，其余效果代码继续只认 `VfxEventMap`。
 *
 * 优先绑 `combat/vfxSignals.ts` 的三条**稳定信号**（`ice_shatter` / `frozen` /
 * `overload`），而不是反应行 id：反应表随时可能拆行改名，稳定信号不会。
 * 反应行只在「声明了屏幕冲击但没有专属信号」时才走通用路径，
 * 因此 `ice_shatter` 的 60ms 顿帧不会被行事件再放一次。
 *
 * ```ts
 * const bridge = connectCombatToVfx(combat.bus, vfx, {
 *   mistTowers: [TOWER_IDS.condenserJet],
 *   onComboFirstSeen: (combo) => hud.showComboTip(combo),
 * });
 * // 局末
 * bridge.detach();
 * ```
 */

/** 网格坐标，1 单位 = 1 格；与 `combat/types.ts` 的 `Vec2` 结构一致。 */
export interface CellPoint {
  x: number;
  y: number;
}

/**
 * 只要求「能订阅」，不要求是 `CombatEventBus` 本尊：
 * 录像回放、测试替身都能接上来。
 */
export interface CombatEventSource {
  on<K extends CombatEventName>(
    name: K,
    listener: (payload: CombatEventMap[K]) => void,
  ): () => void;
}

export interface CombatVfxBridgeOptions {
  /**
   * 网格坐标 → 世界坐标。默认 `(x, height, y)`，与 `engine/grid/coords.ts`
   * 的约定一致（战斗的 y 轴就是世界的 z 轴，1 格 = 1 世界单位）。
   */
  toWorld?(cell: CellPoint, height: number, out: Vec3Like): Vec3Like;
  /**
   * 走冷凝雾循环发射器的塔 id。塔 id 归 `data/towers.json` 管，
   * 所以这里由接线方给；默认值同时认 R2 的规范 id 与 R1 的旧名。
   */
  mistTowers?: readonly string[];
  /** combo 首次触发（GDD 14.2 提示条）：`(combo) => hud.showComboTip(combo)`。 */
  onComboFirstSeen?(comboId: string, tip: string | undefined, position: Vec3Like): void;
}

export interface CombatVfxBridge {
  /** 已播放的效果计数，按事件名分组；自检与调试用。 */
  readonly played: Readonly<Record<string, number>>;
  /** 当前挂着的冷凝雾发射器数量。 */
  readonly activeLoops: number;
  /** 退订全部事件并停掉所有循环发射器。 */
  detach(): void;
}

/** 世界空间的锚点高度，按「这个演出长在什么部位」取值。 */
const HEIGHT = {
  /** 敌人躯干：冰碎、冰壳、死亡零件 */
  body: 0.45,
  /** 贴地：锤击冲击环 */
  ground: 0.06,
  /** 炮口：冷凝雾 */
  muzzle: 0.55,
  /** 塔顶：超载电磁环、过热白汽 */
  towerHead: 0.75,
} as const;

/** 冷凝塔停火多久算「喷雾结束」。冷凝塔攻击间隔 0.5s，留一档余量避免一炮一断。 */
const MIST_HOLD_MS = 700;

/** 冷凝喷雾的锥角，对齐冷凝塔的 halfAngle 28°。 */
const MIST_CONE_RAD = (28 * Math.PI) / 180;

/** 全场超载（大招）时最多点亮几座塔的环，防止一次事件吃掉整帧预算。 */
const GLOBAL_OVERLOAD_RING_CAP = 8;

const DEFAULT_MIST_TOWERS = ['condenser_jet', 'condenser'] as const;

/** 这些状态下的塔停止工作，挂在它身上的循环发射器必须一起停。 */
const STOPPED_TOWER_STATES = new Set(['overheated', 'disabled', 'unpowered']);

const PALETTE_BY_HEX = new Map<string, RGBA>(
  (Object.keys(PALETTE_HEX) as PaletteKey[]).map((key) => [
    PALETTE_HEX[key].toUpperCase(),
    PALETTE[key],
  ]),
);

/**
 * 战斗表里的闪光色是十六进制字符串。能对上六色立法的就换成立法色，
 * 对不上的才现场解析——这样调表的人写错一个色号，画面上立刻是「陌生颜色」，
 * 而不是悄悄多出第七种颜色。
 */
function impactColor(hex: string): RGBA {
  return PALETTE_BY_HEX.get(hex.toUpperCase()) ?? hexToRgba(hex);
}

function defaultToWorld(cell: CellPoint, height: number, out: Vec3Like): Vec3Like {
  out.x = cell.x;
  out.y = height;
  out.z = cell.y;
  return out;
}

export function connectCombatToVfx(
  source: CombatEventSource,
  vfx: VfxSystem,
  options: CombatVfxBridgeOptions = {},
): CombatVfxBridge {
  const toWorld = options.toWorld ?? defaultToWorld;
  const mistTowers = new Set(options.mistTowers ?? DEFAULT_MIST_TOWERS);

  const played: Record<string, number> = Object.create(null);
  const unsubscribers: Array<() => void> = [];
  /** towerId → 正在喷的冷凝雾；键是塔而不是发射器，方便按塔停。 */
  const mists = new Map<number, { handle: EmitterHandle; idleMs: number }>();

  const position: Vec3Like = { x: 0, y: 0, z: 0 };
  const direction: Vec3Like = { x: 0, y: 1, z: 0 };

  const count = (name: string): void => {
    played[name] = (played[name] ?? 0) + 1;
  };

  const on = <K extends CombatEventName>(
    name: K,
    listener: (payload: CombatEventMap[K]) => void,
  ): void => {
    unsubscribers.push(source.on(name, listener));
  };

  const stopMist = (towerId: number): void => {
    const mist = mists.get(towerId);
    if (!mist) return;
    mist.handle.stop();
    mists.delete(towerId);
  };

  // -------------------------------------------------------------------------
  // 稳定信号（combat/vfxSignals.ts）
  // -------------------------------------------------------------------------

  on('ice_shatter', (payload) => {
    toWorld(payload.position, HEIGHT.body, position);
    // 攻击方向只用来给碎片一点偏向：主轴仍然朝上，
    // 否则碎片会横着扫进地面，读起来像扬尘而不是「壳被打碎」
    direction.x = payload.direction.x * 0.55;
    direction.y = 1;
    direction.z = payload.direction.y * 0.55;
    vfx.play('ice-shatter', {
      position,
      splashRadius: Math.max(payload.splashRadius, 1),
      direction,
    });
    count('ice-shatter');
  });

  on('frozen', (payload) => {
    // `end` 是解冻：冰壳消失由敌人材质负责，粒子层不再补一发，
    // 免得「冰碎」和「冻结结束」在同一帧撞成两团冰白
    if (payload.phase !== 'begin') return;
    toWorld(payload.position, HEIGHT.body, position);
    vfx.play('freeze', { position, radius: Math.max(payload.radius, 0.3) });
    count('freeze');
  });

  on('overload', (payload) => {
    if (payload.phase === 'begin') {
      if (payload.origin) {
        toWorld(payload.origin, HEIGHT.towerHead, position);
        vfx.play('overload-start', { position, radiusCells: payload.radiusCells });
        count('overload-start');
        return;
      }
      // 全场超载（GDD §9 大招）没有原点，就在被点亮的塔上各起一环
      for (const tower of payload.towers.slice(0, GLOBAL_OVERLOAD_RING_CAP)) {
        toWorld(tower.position, HEIGHT.towerHead, position);
        vfx.play('overload-start', { position, radiusCells: 1 });
        count('overload-start');
      }
      return;
    }

    // 过热才有白蒸汽：大招的「零过热」不该冒烟，那是它免账单的可读证据
    if (payload.overheat <= 0) return;
    for (const tower of payload.towers) {
      toWorld(tower.position, HEIGHT.towerHead, position);
      vfx.play('overload-end', { position });
      count('overload-end');
    }
  });

  // -------------------------------------------------------------------------
  // 通用事件
  // -------------------------------------------------------------------------

  on('reaction_triggered', (payload) => {
    // 声明了稳定信号的行由上面的专属处理器负责，包含它自己的顿帧与闪光。
    // 这里只兜底剩下的行，否则冰碎会被请求两次顿帧（第二次必被 100ms 立法驳回，
    // 但驳回计数会失真，遮住真正的节流问题）。
    if (payload.impact.signal) return;

    const preset: { hitstopMs?: number; flash?: FlashRequest; shake?: { tier: ShakeTier; durationMs: number } } = {};
    if (payload.impact.hitstop) preset.hitstopMs = payload.impact.hitstop;
    if (payload.impact.flash) {
      preset.flash = {
        color: impactColor(payload.impact.flash),
        holdMs: 17,
        decayMs: 140,
        intensity: 0.45,
      };
    }
    if (payload.impact.shake === 'light') preset.shake = { tier: ShakeTier.Light, durationMs: 200 };
    if (payload.impact.shake === 'medium') preset.shake = { tier: ShakeTier.Medium, durationMs: 260 };

    if (preset.hitstopMs === undefined && !preset.flash && !preset.shake) return;
    vfx.impact.play(preset);
    count('screen-impact');
  });

  on('combo_first_seen', (payload) => {
    if (!options.onComboFirstSeen) return;
    toWorld(payload.position, HEIGHT.body, position);
    options.onComboFirstSeen(payload.comboId, payload.tip, position);
  });

  on('enemy_killed', (payload) => {
    toWorld(payload.position, HEIGHT.body, position);
    vfx.play('unit-death', { position });
    count('unit-death');
  });

  on('tower_fired', (payload) => {
    if (payload.attackKind === 'melee') {
      // `melee_miss` 是空挥，没有命中点，不出冲击环
      toWorld(payload.to, HEIGHT.ground, position);
      vfx.play('hammer-impact', { position });
      count('hammer-impact');
      return;
    }

    if (payload.attackKind !== 'cone' || !mistTowers.has(payload.defId)) return;

    toWorld(payload.from, HEIGHT.muzzle, position);
    const dx = payload.to.x - payload.from.x;
    const dz = payload.to.y - payload.from.y;
    const length = Math.hypot(dx, dz) || 1;
    direction.x = dx / length;
    direction.y = 0;
    direction.z = dz / length;

    const existing = mists.get(payload.towerId);
    if (existing) {
      // 同一座塔连续开火只是「继续喷」：换朝向、把停火计时清零，不再起第二个发射器
      existing.handle.setTransform(position, direction);
      existing.idleMs = 0;
      return;
    }

    const handle = vfx.play('condense-mist', {
      position,
      direction,
      range: Math.max(length, 1.5),
      coneAngle: MIST_CONE_RAD,
    });
    // 拿不到句柄说明循环发射器预算满了；这是立法允许的降级，不补偿
    if (handle) {
      mists.set(payload.towerId, { handle, idleMs: 0 });
      count('condense-mist');
    }
  });

  on('tower_state_changed', (payload) => {
    // 停机的塔不该继续喷雾——这是「这座塔现在没在工作」最直接的读数。
    // `overloaded` 不在此列：超载中的塔喷得更凶，不是停机。
    if (STOPPED_TOWER_STATES.has(payload.state)) stopMist(payload.towerId);
  });

  on('tower_sold', (payload) => stopMist(payload.towerId));

  // 真实时间计时：顿帧期间不该把喷雾判定成停火
  unsubscribers.push(
    vfx.addFrameHook((realDtMs) => {
      for (const [towerId, mist] of mists) {
        mist.idleMs += realDtMs;
        if (mist.idleMs >= MIST_HOLD_MS) stopMist(towerId);
      }
    }),
  );

  return {
    played,
    get activeLoops(): number {
      return mists.size;
    },
    detach(): void {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
      for (const towerId of [...mists.keys()]) stopMist(towerId);
    },
  };
}
