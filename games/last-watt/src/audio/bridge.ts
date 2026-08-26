import type { CombatEventMap, CombatEventName } from '../combat/events';
import type { GameplayEventMap, GameplayEventName } from '../gameplay/events';
import type { AudioEngine, SfxCue } from './AudioEngine';

/**
 * 事件 → 音效的绑定表。
 *
 * 这是 `src/audio` 里唯一认识战斗/玩法事件的文件，其余部分只认 `SfxId`。
 * 绑定的是**稳定信号**（`combat/vfxSignals.ts`）与玩法事件，不是反应行 id：
 * 理由与 `vfx/combatBridge.ts` 一样，反应表随时会拆行改名。
 *
 * ## 「与粒子同帧」是怎么保证的
 *
 * 本桥与 `connectCombatToVfx` 订阅的是**同一个** `combat.bus` 上的同一条信号。
 * `CombatEventBus.emit` 是同步的，一次 emit 会在同一个调用栈里依次通知两个订阅者，
 * 中间没有 rAF、没有 setTimeout、没有队列。因此粒子的 `emit` 与音效的 `play`
 * 落在同一个固定步长 tick、同一帧上——误差是 0 帧，而不是「调到 ≤1 帧」。
 * `selfcheck.ts` 的「同帧」一条就是盯死这件事的回归闸门。
 *
 * ```ts
 * const audio = new AudioEngine();
 * const off = connectGameAudio({ combat: combat.bus, gameplay: session.events, audio });
 * ```
 */

export interface CombatAudioSource {
  on<K extends CombatEventName>(
    name: K,
    listener: (payload: CombatEventMap[K]) => void,
  ): () => void;
}

export interface GameplayAudioSource {
  on<K extends GameplayEventName>(
    name: K,
    listener: (payload: GameplayEventMap[K]) => void,
  ): () => void;
}

export interface GameAudioOptions {
  audio: AudioEngine;
  combat?: CombatAudioSource;
  gameplay?: GameplayAudioSource;
}

export interface GameAudioBridge {
  /** 每条音效被请求的次数（含被节流挡下的），自检与调试用。 */
  readonly requested: Readonly<Record<string, number>>;
  detach(): void;
}

export function connectGameAudio(options: GameAudioOptions): GameAudioBridge {
  const { audio } = options;
  const unsubscribers: Array<() => void> = [];
  const requested: Record<string, number> = Object.create(null);

  const cue = (request: SfxCue): void => {
    requested[request.id] = (requested[request.id] ?? 0) + 1;
    audio.play(request);
  };

  if (options.combat) {
    const combat = options.combat;

    unsubscribers.push(
      combat.on('ice_shatter', (payload) => {
        // 溅射越大这一下越响：一发打穿三只和只碎一只，听感必须不一样
        const intensity = Math.min(0.65 + payload.splashRadius * 0.2, 1);
        cue({ id: 'sfx_shatter_glass', intensity, x: payload.position.x });
      }),
    );

    unsubscribers.push(
      combat.on('frozen', (payload) => {
        // `end` 是解冻，不出声：冰壳消失是视觉信息，再给一声会让人以为又冻上了
        if (payload.phase !== 'begin') return;
        cue({ id: 'sfx_freeze', intensity: 0.6, x: payload.position.x });
      }),
    );

    unsubscribers.push(
      combat.on('tower_built', (payload) => {
        cue({ id: 'sfx_build_place', intensity: 0.7, x: payload.cell.x });
      }),
    );
  }

  if (options.gameplay) {
    const gameplay = options.gameplay;

    unsubscribers.push(
      gameplay.on('wave_started', (payload) => {
        cue({ id: 'sfx_wave_start', intensity: payload.early ? 0.85 : 0.7 });
      }),
    );

    // 挖沟/搭桥完工也是「建筑落位」，共用同一记卡扣：M1 只有四条音效，
    // 与其为它新开一条，不如让玩家学会「这个声音 = 我刚改了地形/放了东西」
    unsubscribers.push(
      gameplay.on('engineering_completed', (payload) => {
        cue({ id: 'sfx_build_place', intensity: 0.5, x: payload.cx + 0.5 });
      }),
    );
  }

  return {
    requested,
    detach(): void {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    },
  };
}
