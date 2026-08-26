import type { CombatEventMap, CombatEventName } from '../combat/events';
import { createIceShatterScenario } from '../combat/scenarios';
import { GameplayEvents } from '../gameplay/events';
import { VfxSystem } from '../vfx/VfxSystem';
import { connectCombatToVfx } from '../vfx/combatBridge';
import { AudioEngine } from './AudioEngine';
import { connectGameAudio } from './bridge';
import { createHeadlessAudioContext } from './headlessContext';
import { SFX_IDS, VOICES } from './voices';

/**
 * 音频层无头自检。
 *
 * 盯的是耳朵不容易当场定位的那几件事：事件有没有落成音效、冰碎那一下和粒子
 * 是不是同一帧、连锁冰碎会不会把总线糊成一片、没有声卡时会不会把游戏拖崩。
 * 音色好不好听不在这里判——那要人听。
 */

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function check(results: CheckResult[], name: string, fn: () => string | void): void {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? 'ok' });
  } catch (error) {
    results.push({ name, ok: false, detail: (error as Error).message });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

class FakeCombatBus {
  private readonly listeners = new Map<CombatEventName, Set<(payload: never) => void>>();

  on<K extends CombatEventName>(
    name: K,
    listener: (payload: CombatEventMap[K]) => void,
  ): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as (payload: never) => void);
    return () => {
      set?.delete(listener as (payload: never) => void);
    };
  }

  emit<K extends CombatEventName>(name: K, payload: CombatEventMap[K]): void {
    for (const listener of this.listeners.get(name) ?? []) {
      (listener as (p: CombatEventMap[K]) => void)(payload);
    }
  }
}

const SHATTER: CombatEventMap['ice_shatter'] = {
  enemyId: 1,
  sourceId: 2,
  position: { x: 3.5, y: 4.5 },
  splashRadius: 1,
  direction: { x: 1, y: 0 },
  damage: 112,
  impact: { signal: 'ice_shatter', hitstop: 60, flash: '#BFF7FF', sfx: 'sfx_shatter_glass' },
};

export function runSelfCheck(): CheckResult[] {
  const results: CheckResult[] = [];

  check(results, '音色表：四条 M1 音效都真的搭出了节点图', () => {
    const built: string[] = [];
    for (const id of SFX_IDS) {
      const harness = createHeadlessAudioContext();
      const audio = new AudioEngine({ context: harness.context, autoUnlock: false });
      assert(audio.play({ id, intensity: 1 }), `${id} 首次发声就被挡下了`);

      const kinds = new Set(harness.log.nodes.map((node) => node.kind));
      assert(harness.log.starts.length > 0, `${id} 一个源节点都没排程`);
      assert(kinds.has('gain'), `${id} 没有包络`);
      // 每条音效都必须自带衰减：常亮的增益节点会把声音卡在那里不停
      const envelopes = harness.log.nodes.filter((node) =>
        node.automation.some((entry) => entry.startsWith('gain~exp')),
      );
      assert(envelopes.length > 0, `${id} 的增益没有衰减段`);
      built.push(`${id}(${harness.log.starts.length} 源/${harness.log.nodes.length} 节点)`);
      audio.dispose();
    }
    assert(SFX_IDS.length === 4, `M1 音效应为 4 条，实际 ${SFX_IDS.length}`);
    return built.join('  ');
  });

  check(results, '音效互相区分：冰碎的音区不与冻结重叠', () => {
    const freq = (id: keyof typeof VOICES): number[] => {
      const harness = createHeadlessAudioContext();
      const audio = new AudioEngine({ context: harness.context, autoUnlock: false });
      audio.play({ id, intensity: 1 });
      const values: number[] = [];
      for (const node of harness.log.nodes) {
        for (const entry of node.automation) {
          const match = /^frequency[~a-z]*@[\d.]+=([\d.]+)$/.exec(entry);
          if (match) values.push(Number(match[1]));
        }
      }
      audio.dispose();
      return values;
    };

    const shatter = freq('sfx_shatter_glass');
    const freeze = freq('sfx_freeze');
    // 「关画面仅听声音能确认碎裂」要求碎裂在音区上独一份：
    // 它的分音全部在 2kHz 以上，冻结的一切都在 3kHz 以下
    const shatterTop = shatter.filter((f) => f >= 2000).length;
    assert(shatterTop >= 5, `冰碎的高频分音只有 ${shatterTop} 个，听不出玻璃`);
    assert(Math.max(...freeze) < 3000, `冻结的最高频 ${Math.max(...freeze)} 侵入了冰碎音区`);
    return `冰碎高频分音 ${shatterTop} 个，冻结上限 ${Math.max(...freeze)}Hz`;
  });

  check(results, '同帧：冰碎的粒子与音效在同一次事件派发里落地', () => {
    const vfx = new VfxSystem();
    const harness = createHeadlessAudioContext();
    const audio = new AudioEngine({ context: harness.context, autoUnlock: false });
    const bus = new FakeCombatBus();

    const vfxBridge = connectCombatToVfx(bus, vfx);
    const audioBridge = connectGameAudio({ combat: bus, audio });

    vfx.beginFrame(16.7);
    const beforeParticles = vfx.particles.stats.emittedThisFrame;
    const beforeSfx = audio.diagnostics.played.sfx_shatter_glass;

    bus.emit('ice_shatter', SHATTER);

    // 关键：这两个断言在 endFrame 之前跑。事件派发是同步的，所以粒子和音效
    // 必须已经**都**发生了——中间只要有人排了个队，这里就抓得到
    const particles = vfx.particles.stats.emittedThisFrame - beforeParticles;
    const sfx = audio.diagnostics.played.sfx_shatter_glass - beforeSfx;
    assert(particles >= 24, `同一帧里只发了 ${particles} 粒粒子`);
    assert(sfx === 1, `同一帧里音效发了 ${sfx} 次`);
    assert(vfx.impact.isHitstopped, '同一帧里没有顿帧');

    // 音效排在当前音频时刻上，不是「下一帧再说」
    const scheduled = audio.diagnostics.lastScheduledAt;
    assert(
      Math.abs(scheduled - harness.context.currentTime) < 1 / 60,
      `音效排到了 ${scheduled}，偏离当前音频时刻超过一帧`,
    );
    vfx.endFrame();

    audioBridge.detach();
    vfxBridge.detach();
    vfx.dispose();
    audio.dispose();
    return `粒子 ${particles} 粒 / 音效 1 次 / 顿帧 1 次，同一次派发内`;
  });

  check(results, '节流：连锁冰碎并成一声，不叠成削波', () => {
    const harness = createHeadlessAudioContext();
    const audio = new AudioEngine({ context: harness.context, autoUnlock: false });

    // 一发溅射打穿 5 只，战斗层会在同一帧连发 5 条信号
    let played = 0;
    for (let i = 0; i < 5; i++) if (audio.play({ id: 'sfx_shatter_glass' })) played++;
    assert(played === 1, `同帧 5 条冰碎发了 ${played} 声`);
    assert(audio.diagnostics.throttled === 4, `节流计数 ${audio.diagnostics.throttled}，应为 4`);

    // 过了节流窗口必须能再响，不能把后面的冰碎一起吃掉
    harness.advance(0.06);
    assert(audio.play({ id: 'sfx_shatter_glass' }), '节流窗口过后仍然发不出声');

    // 不同 id 各走各的窗口：建造被冰碎挡住会让操作失去回执
    assert(audio.play({ id: 'sfx_build_place' }), '建造音效被别的音效的节流窗口挡住了');
    audio.dispose();
    return `5 条并 1 声，60ms 后恢复，跨 id 不互相挡`;
  });

  check(results, '没有声卡也不拖垮游戏：降级成计数器', () => {
    // context: null = 明确「这台机器没有 WebAudio」，走降级路径
    const audio = new AudioEngine({ context: null, autoUnlock: false });
    assert(!audio.available, '降级模式下不该声称有音频');
    assert(audio.play({ id: 'sfx_wave_start' }), '降级模式下 play 应当照常记账');
    assert(audio.diagnostics.played.sfx_wave_start === 1, '降级模式下没有记账');
    audio.unlock();
    audio.dispose();
    return '无上下文时 play/unlock/dispose 均不抛异常';
  });

  check(results, '静音：不再排任何节点，但记账继续', () => {
    const harness = createHeadlessAudioContext();
    const audio = new AudioEngine({ context: harness.context, autoUnlock: false });
    audio.setMuted(true);
    const before = harness.log.nodes.length;
    audio.play({ id: 'sfx_wave_start' });
    assert(harness.log.nodes.length === before, '静音时仍然搭了音色节点');
    assert(audio.diagnostics.played.sfx_wave_start === 1, '静音时不该丢掉事件记账');

    audio.setMuted(false);
    harness.advance(1);
    audio.play({ id: 'sfx_wave_start' });
    assert(harness.log.nodes.length > before, '解除静音后没有恢复发声');
    audio.dispose();
    return '静音零节点、解除即恢复';
  });

  check(results, '玩法事件：开波与建造各自接上', () => {
    const harness = createHeadlessAudioContext();
    const audio = new AudioEngine({ context: harness.context, autoUnlock: false });
    const bus = new FakeCombatBus();
    const gameplay = new GameplayEvents();
    const bridge = connectGameAudio({ combat: bus, gameplay, audio });

    bus.emit('tower_built', { towerId: 1, defId: 'mg_rivet', cell: { x: 4.5, y: 6.5 } });
    gameplay.emit('wave_started', { wave: 1, early: false, reward: 0 });
    harness.advance(0.1);
    gameplay.emit('engineering_completed', {
      jobId: 1,
      op: 'dig',
      cx: 8,
      cy: 5,
      cost: 30,
      duration: 2,
      terrain: 'gully',
    });

    const played = audio.diagnostics.played;
    assert(played.sfx_wave_start === 1, `开波音效发了 ${played.sfx_wave_start} 次`);
    assert(played.sfx_build_place === 2, `落位音效发了 ${played.sfx_build_place} 次，应为 2`);
    assert(bridge.requested.sfx_build_place === 2, '桥没有记下建造请求');

    bridge.detach();
    bus.emit('tower_built', { towerId: 2, defId: 'mg_rivet', cell: { x: 5.5, y: 6.5 } });
    assert(audio.diagnostics.played.sfx_build_place === 2, 'detach 之后还在响');
    audio.dispose();
    return '建造 / 挖沟完工 / 开波三处接通，detach 干净';
  });

  check(results, '接线：真战斗系统跑出来的冰碎，桥真的听得见', () => {
    // 上面那些用的是 FakeCombatBus，证明的是「桥订阅得对」。这一条换成真的
    // CombatSystem 跑完整条 GDD §7.3.1 冷却→冻结→碎裂链，证明的是「事件名、
    // 载荷字段、发射时机」三样都对得上——桥订阅了一个真实存在的信号，
    // 而不是一个拼错的字符串（拼错了 `on` 也不会报错，只会永远安静）。
    const harness = createHeadlessAudioContext();
    const audio = new AudioEngine({ context: harness.context, autoUnlock: false });
    const { system } = createIceShatterScenario();
    const bridge = connectGameAudio({ combat: system.bus, audio });

    for (let t = 0; t < 6 * 60; t++) {
      system.update(1 / 60);
      // 音频时钟跟着仿真走，否则 6 秒里的每一声都会撞上节流窗口
      harness.advance(1 / 60);
    }

    const played = audio.diagnostics.played;
    assert(played.sfx_shatter_glass >= 1, '真战斗跑完一次冰碎，音效一声没响');
    assert(played.sfx_freeze >= 1, '真战斗冻结了目标，冻结音效没响');
    // 冻结的 `end` 相位也走同一条 `frozen` 事件；出声两次说明桥没滤掉解冻
    assert(
      played.sfx_freeze <= bridge.requested.sfx_freeze,
      '记账数比实际发声还少，节流统计错位',
    );

    bridge.detach();
    audio.dispose();
    return `真战斗 6s：冰碎 ${played.sfx_shatter_glass} 声 / 冻结 ${played.sfx_freeze} 声`;
  });

  check(results, '声像：按格坐标分左右，且不做满偏', () => {
    const pan = (x: number): number => {
      const harness = createHeadlessAudioContext();
      const audio = new AudioEngine({ context: harness.context, autoUnlock: false });
      audio.play({ id: 'sfx_build_place', x });
      const panner = harness.log.nodes.find((node) => node.kind === 'panner');
      const value = Number(/=(-?[\d.]+)$/.exec(panner?.automation[0] ?? '')?.[1] ?? NaN);
      audio.dispose();
      return value;
    };

    const left = pan(0);
    const right = pan(19.5);
    assert(left < 0 && right > 0, `左右声像方向反了：${left} / ${right}`);
    assert(Math.abs(left) <= 0.6 && Math.abs(right) <= 0.6, '声像满偏，会让一侧完全听不见');
    return `左 ${left.toFixed(2)} / 右 ${right.toFixed(2)}`;
  });

  return results;
}

export function formatReport(results: CheckResult[]): string {
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  lines.push('');
  lines.push(`${results.length - failed}/${results.length} 通过${failed ? `，${failed} 项失败` : ''}`);
  return lines.join('\n');
}
