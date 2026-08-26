import type { CombatEventMap, CombatEventName } from '../../combat/events';
import { Engine } from '../../engine/Engine';
import { Hud } from '../../ui/Hud';
import { createEmptyHudState } from '../../ui/hudState';
import { VfxSystem } from '../VfxSystem';
import { attachVfxToEngine } from '../engineBridge';
import { connectCombatToVfx, type CombatEventSource } from '../combatBridge';

/**
 * 引擎接线试验台。
 *
 * Gym（`./index.html`）验证的是粒子本身，这一页验证的是**接线**：真 `Engine`、
 * 真 `PostPipeline`（含自发光遮罩 pass）、`attachVfxToEngine` 的每帧协议、
 * `connectCombatToVfx` 的事件映射，全都是生产代码，只有战斗事件是假的。
 *
 * 看什么：
 * - 冰碎那一下画面「咔」一顿：顿帧冻住的是逻辑时钟，帧率不掉（右上角 tick 停、frame 继续涨）；
 * - 冰晶碎片带辉光但不糊成方块：遮罩 pass 没有把粒子换成代理材质；
 * - 冷凝雾在塔口持续喷，塔一停火 0.7s 自动收。
 *
 * URL 参数：
 * - `?t=2.64` 用固定步长快进到第 2.64 秒（冰碎那一帧）停帧，逐帧可复现，给截图回归用
 */

const FIXED_DT = 1 / 60;

/** 只要能订阅就够：本页不启动 `CombatSystem`，用一段脚本假扮它。 */
class ScriptedCombatBus implements CombatEventSource {
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

/** 一格 = 一世界单位，坐标沿用战斗层的格坐标。 */
const CONDENSER = { x: 6.5, y: 5.5 };
const CAPACITOR = { x: 13.5, y: 5.5 };
const VICTIM = { x: 9.5, y: 5.5 };

interface ScriptedEvent {
  at: number;
  run(bus: ScriptedCombatBus): void;
}

/** 一轮 6 秒：喷雾 → 冻结 → 冰碎 → 击杀 → 超载开/关。 */
const TIMELINE: ScriptedEvent[] = [
  ...[0.2, 0.7, 1.2, 1.7].map((at) => ({
    at,
    run: (bus: ScriptedCombatBus) =>
      bus.emit('tower_fired', {
        towerId: 1,
        defId: 'condenser_jet',
        from: CONDENSER,
        to: VICTIM,
        attackKind: 'cone',
      }),
  })),
  {
    at: 2.0,
    run: (bus) =>
      bus.emit('frozen', {
        phase: 'begin',
        enemyId: 42,
        position: VICTIM,
        radius: 0.45,
        duration: 2,
      }),
  },
  {
    at: 2.6,
    run: (bus) =>
      bus.emit('ice_shatter', {
        enemyId: 42,
        sourceId: 2,
        position: VICTIM,
        splashRadius: 1,
        direction: { x: -1, y: 0 },
        damage: 112,
        impact: { signal: 'ice_shatter', hitstop: 60, flash: '#BFF7FF', tip: 'tip_shatter' },
      }),
  },
  {
    at: 2.62,
    run: (bus) =>
      bus.emit('combo_first_seen', { comboId: 'shatter', position: VICTIM, tip: 'tip_shatter' }),
  },
  {
    at: 2.9,
    run: (bus) =>
      bus.emit('enemy_killed', {
        enemyId: 42,
        defId: 'scavenger_bug',
        bounty: 5,
        position: VICTIM,
      }),
  },
  {
    at: 3.6,
    run: (bus) =>
      bus.emit('overload', {
        phase: 'begin',
        scope: 'radius',
        origin: CAPACITOR,
        radiusCells: 1,
        towers: [{ towerId: 1, defId: 'condenser_jet', position: CONDENSER }],
        duration: 1.2,
        overheat: 3,
      }),
  },
  {
    at: 4.8,
    run: (bus) =>
      bus.emit('overload', {
        phase: 'end',
        scope: 'radius',
        origin: CAPACITOR,
        radiusCells: 1,
        towers: [{ towerId: 1, defId: 'condenser_jet', position: CONDENSER }],
        duration: 0,
        overheat: 3,
        endReason: 'expired',
      }),
  },
];

const LOOP_SECONDS = 6;

function createReadout(): { root: HTMLElement; update(text: string): void } {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:absolute',
    'top:16px',
    'right:16px',
    'padding:10px 12px',
    'font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#bfe9f5',
    'background:rgba(8,10,12,0.82)',
    'border:1px solid rgba(53,224,255,0.35)',
    'border-radius:4px',
    'white-space:pre',
    'z-index:30',
    'pointer-events:none',
  ].join(';');
  return {
    root,
    update(text) {
      root.textContent = text;
    },
  };
}

export function mountIntegrationDemo(container: HTMLElement): () => void {
  const engine = new Engine(container, { testbed: false });
  const vfx = new VfxSystem();
  const hud = new Hud(container);
  hud.setState(createEmptyHudState());

  const bridge = attachVfxToEngine(engine, vfx, {
    onImpact: (impact) => hud.applyImpact(impact),
  });

  const bus = new ScriptedCombatBus();
  const combat = connectCombatToVfx(bus, vfx, {
    mistTowers: ['condenser_jet'],
    onComboFirstSeen: (comboId) => hud.showComboTip(comboId),
  });

  const readout = createReadout();
  container.append(readout.root);

  // 时间线挂在固定步长上，跟战斗层同一条时钟：顿帧期间它也该停住
  let simTime = 0;
  let ticks = 0;
  let frames = 0;
  let fired = new Set<number>();

  const offTick = engine.onFixedUpdate(() => {
    ticks += 1;
    const before = simTime;
    simTime += FIXED_DT;
    if (simTime >= LOOP_SECONDS) {
      simTime -= LOOP_SECONDS;
      fired = new Set();
    }
    for (let i = 0; i < TIMELINE.length; i++) {
      const event = TIMELINE[i];
      if (fired.has(i) || event.at < before || event.at >= simTime) continue;
      fired.add(i);
      event.run(bus);
    }
  });

  const offRender = engine.onRender(({ timeScale }) => {
    frames += 1;
    const stats = vfx.stats;
    readout.update(
      [
        `t          ${simTime.toFixed(2)}s`,
        `timeScale  ${timeScale.toFixed(0)}${timeScale === 0 ? '  ← 顿帧中' : ''}`,
        `tick/frame ${ticks} / ${frames}`,
        `粒子       ${stats.aliveParticles}`,
        `循环发射器 ${stats.loopEmitters}  (冷凝雾 ${combat.activeLoops})`,
        `贴花       ${stats.decals}`,
        `顿帧 接受 ${vfx.impact.diagnostics.hitstopsAccepted} / 驳回 ${vfx.impact.diagnostics.hitstopsRejected}`,
      ].join('\n'),
    );
  });

  const freezeAt = new URLSearchParams(location.search).get('t');
  if (freezeAt === null) {
    engine.start();
  } else {
    // 固定步长快进：同一个 `t` 永远得到同一帧画面，才能拿去做截图比对。
    // 顿帧期间 simTime 不走，所以这里按帧数封顶，不然会在顿帧里空转
    const target = Number.isFinite(Number(freezeAt)) ? Number(freezeAt) : 2.64;
    const maxFrames = Math.ceil(target / FIXED_DT) + 240;
    for (let i = 0; i < maxFrames && simTime < target; i++) engine.loop.step(FIXED_DT);
    document.title = `lw-integration t=${simTime.toFixed(2)} particles=${vfx.stats.aliveParticles}`;
    document.body.dataset.demoReady = 'true';

    // 定住之后还要不停重画同一帧：渲染器没有 preserveDrawingBuffer，
    // 一帧画完就被清掉，截图工具抓到的会是黑屏。step(0) 不推进任何时钟。
    const repaint = (): void => {
      engine.loop.step(0);
      requestAnimationFrame(repaint);
    };
    requestAnimationFrame(repaint);
  }

  return () => {
    offTick();
    offRender();
    combat.detach();
    bridge.detach();
    hud.dispose();
    vfx.dispose();
    engine.dispose();
    readout.root.remove();
  };
}

const stage = document.getElementById('lw-stage');
if (stage) mountIntegrationDemo(stage);
