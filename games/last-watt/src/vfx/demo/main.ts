import { Hud } from '../../ui/Hud';
import { createEmptyHudState, type HudState } from '../../ui/hudState';
import { DegradeLevel } from '../budget';
import { VfxGym, type GymCounters } from './gym';

/**
 * Gym 入口：粒子试验台 + 真实 HUD + 计数面板。
 *
 * URL 参数：
 * - `?t=1.2`  固定步长快进到第 1.2 秒后停帧（截图 / 回归比对，逐帧可复现）
 * - 不带参数则实时运行，时间线跑完自动重来
 */

function mockHudState(): HudState {
  const state = createEmptyHudState();
  state.gold = 340;
  state.wave = { current: 7, total: 20, inProgress: true };
  state.nextWave = {
    preview: [
      { defId: 'scavenger', icon: 'enemy-bug', count: 12, label: '拾荒虫' },
      { defId: 'rat', icon: 'enemy-rat', count: 8, label: '疾行鼠群' },
      { defId: 'hauler', icon: 'enemy-hauler', count: 2, label: '装甲运输车' },
      { defId: 'scout-bee', icon: 'enemy-bee', count: 3, air: true, label: '侦察蜂' },
      { defId: 'sapper', icon: 'enemy-sapper', count: 2, threat: 'breaker', label: '爆破工兵' },
      { defId: 'medic', icon: 'enemy-medic', count: 1, threat: 'healer', label: '修理无人机' },
    ],
    earlyBonusPercent: 10,
    canCallEarly: true,
  };
  // 供电用了 11/14，剩 3 点空闲在给储能充电；再造一座冷凝塔（占 2）还够
  state.power = { used: 11, cap: 14, deficit: 0 };
  state.battery = { value: 62, max: 100, overloadCost: 20 };
  state.integrity = {
    value: 74,
    max: 100,
    thresholds: [
      { value: 80, label: 'A 区', lost: true },
      { value: 50, label: 'B 区', lost: false },
    ],
  };
  state.build = [
    { id: 'rivet', name: '铆钉机枪', icon: 'tower-rivet', cost: 50, powerCost: 0, targetsAir: true, unlocked: true, hotkey: '1' },
    { id: 'tar', name: '焦油喷洒', icon: 'tower-tar', cost: 70, powerCost: 0, targetsAir: false, unlocked: true, hotkey: '2' },
    { id: 'hammer', name: '破碎锤', icon: 'tower-hammer', cost: 120, powerCost: 1, targetsAir: false, unlocked: true, hotkey: '3' },
    { id: 'condenser', name: '冷凝喷射', icon: 'tower-condenser', cost: 130, powerCost: 2, targetsAir: false, unlocked: true, hotkey: '4' },
    { id: 'flamer', name: '火焰喷射', icon: 'tower-flamer', cost: 140, powerCost: 2, targetsAir: false, unlocked: true, hotkey: '5' },
    // 特斯拉占 4 点电但只剩 3 点空闲 → 灰显 + 缺 1 角标，正是 GDD 14.1 要的三态
    { id: 'tesla', name: '特斯拉', icon: 'tower-tesla', cost: 200, powerCost: 4, targetsAir: true, unlocked: true, hotkey: '6' },
    { id: 'capacitor', name: '电容站', icon: 'tower-capacitor', cost: 160, powerCost: 0, targetsAir: false, unlocked: true, hotkey: '7' },
    { id: 'generator', name: '发电机', icon: 'building-generator', cost: 100, powerCost: 0, targetsAir: false, unlocked: true, hotkey: '8' },
  ];
  state.selectedBuildId = 'condenser';
  state.ultimate = { charges: 1, maxCharges: 2 };
  state.engineering = { digLeft: 2, bridgeLeft: 1, digCost: 50, bridgeCost: 80, armed: null };
  state.inspector = {
    towerId: 'tower-42',
    name: '冷凝喷射塔',
    icon: 'tower-condenser',
    level: 1,
    stats: [
      { label: '射程', value: '3.2 格' },
      { label: '占电', value: '2 点' },
      { label: '效果', value: '湿冷 3 层 → 冻结' },
    ],
    upgrades: [
      { id: 'freeze', name: '冻结 2.5s', description: '冻结时间从 2s 提升到 2.5s', cost: 120 },
      { id: 'twin', name: '双喷口', description: '增加第二个喷口，覆盖两个方向', cost: 150 },
    ],
    priority: 'first',
    sellRefund: 91,
  };
  state.radio = { speaker: '老周', line: '这台冷凝塔的湿冷叠满了，赶紧上重锤——听我的，砸下去很爽。', id: 'r1' };
  return state;
}

function createCountersPanel(): { root: HTMLElement; update(c: GymCounters): void } {
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
    update(c) {
      const degradeName = DegradeLevel[c.degrade];
      root.textContent = [
        `t          ${c.time.toFixed(2)}s   timeScale ${c.timeScale.toFixed(0)}`,
        `粒子       ${c.particles} / 20000`,
        `循环发射器 ${c.loopEmitters} / 24`,
        `一次性     ${c.oneShotEmitters} / 40`,
        `贴花       ${c.decals} / 64`,
        `降级档     ${c.degrade} (${degradeName})`,
        `丢弃请求   ${c.droppedRequests}`,
        `顿帧 接受 ${c.hitstopsAccepted} / 驳回 ${c.hitstopsRejected}`,
      ].join('\n');
    },
  };
}

export function mountGym(container: HTMLElement): VfxGym {
  const params0 = new URLSearchParams(location.search);
  const width = Number(params0.get('w')) || 1280;
  const height = Number(params0.get('h')) || 720;

  container.style.position = 'relative';
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.background = '#0d0908';

  const gym = new VfxGym(container, width, height);
  const hud = new Hud(container);
  hud.setState(mockHudState());

  const counters = createCountersPanel();
  container.append(counters.root);

  const params = new URLSearchParams(location.search);
  const freezeAt = params.get('t');

  if (freezeAt !== null) {
    const seconds = Number(freezeAt);
    const result = gym.runTo(Number.isFinite(seconds) ? seconds : 1.2);
    counters.update(result);
    hud.applyImpact(gym.vfx.impact.state);
    hud.showComboTip('ice-shatter');
    document.title = `lw-gym t=${result.time.toFixed(2)} particles=${result.particles}`;
    document.body.dataset.gymReady = 'true';
  } else {
    const originalStep = gym.step.bind(gym);
    gym.step = (dtMs?: number) => {
      const c = originalStep(dtMs);
      counters.update(c);
      hud.applyImpact(gym.vfx.impact.state);
      // 时间线跑完循环重来，方便长时间盯着看
      if (c.time > 5.5) gym.reset();
      return c;
    };
    gym.start();
    hud.showComboTip('ice-shatter');
  }

  return gym;
}

const auto = document.getElementById('lw-gym');
if (auto) mountGym(auto);
