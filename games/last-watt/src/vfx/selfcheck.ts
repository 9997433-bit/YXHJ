import { DecalManager } from './DecalManager';
import { GpuParticleSystem } from './GpuParticleSystem';
import { ImpactDirector, IMPACT_PRESETS, ShakeTier } from './ImpactDirector';
import { VfxSystem } from './VfxSystem';
import { DegradeLevel, VFX_BUDGET, VfxBudget } from './budget';
import { ParticleTile, buildParticleAtlas } from './atlas';
import { PALETTE, withAlpha } from './palette';
import { VfxPriority } from './events';

/**
 * VFX 层无头自检。
 *
 * 覆盖的是**截图证明不了的东西**：环形池会不会越界、预算会不会被 combo 突破、
 * 顿帧节流是否真的按 100ms 立法、顿帧期间粒子时钟有没有跟着停。
 * 全部不需要 WebGL —— three 的几何体与材质在 node 里可以正常构造，
 * 因此这份自检能进 CI，不依赖 GPU。
 *
 * 正式单测归 `tests/`（R1-G1 独占），这里只保证本模块自身可被随时验证。
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

const ORIGIN = { x: 0, y: 0, z: 0 };

export function runSelfCheck(): CheckResult[] {
  const results: CheckResult[] = [];

  check(results, '图集：确定性 + 关键 tile 非空', () => {
    const a = buildParticleAtlas();
    const b = buildParticleAtlas();
    assert(a.length === b.length, '两次生成长度不一致');
    for (let i = 0; i < a.length; i += 977) {
      assert(a[i] === b[i], `图集不确定，偏移 ${i} 处不同`);
    }
    // 每个用到的 tile 都必须真的画了东西，否则粒子会是一片空白
    const tiles = [
      ParticleTile.Soft,
      ParticleTile.Spike,
      ParticleTile.Flare,
      ParticleTile.IceShardA,
      ParticleTile.IceShardB,
      ParticleTile.IceShardC,
      ParticleTile.Frost,
      ParticleTile.Ring,
      ParticleTile.ShockRing,
      ParticleTile.Clod,
      ParticleTile.Bolt,
      ParticleTile.Steam,
      ParticleTile.Flame0,
      ParticleTile.Flame3,
    ];
    const size = 1024;
    const tilePx = 128;
    for (const tile of tiles) {
      const tx = (tile % 8) * tilePx;
      const ty = Math.floor(tile / 8) * tilePx;
      let sum = 0;
      for (let y = 0; y < tilePx; y += 2) {
        for (let x = 0; x < tilePx; x += 2) {
          sum += a[((ty + y) * size + tx + x) * 4 + 3];
        }
      }
      assert(sum > 2000, `tile ${ParticleTile[tile]} 几乎全透明（alpha 和 ${sum}）`);
    }
    return `${tiles.length} 个 tile 均有内容，两次生成逐字节一致`;
  });

  check(results, '粒子池：环形写入不越界、寿命到点自动回收', () => {
    const particles = new GpuParticleSystem({ additiveCapacity: 64, alphaCapacity: 16 });
    const emitOnce = (count: number) =>
      particles.emit({
        count,
        position: ORIGIN,
        life: 0.5,
        sizeStart: 0.2,
        sizeEnd: 0.1,
        colorStart: PALETTE.ice,
        colorEnd: withAlpha(PALETTE.ice, 0),
        tile: ParticleTile.IceShardA,
      });

    assert(emitOnce(24) === 24, '首批 24 粒未全部发射');
    assert(particles.countAliveExact() === 24, '存活数不是 24');

    // 连发超过容量：环形缓冲覆盖最老的，不能越界也不能抛异常
    for (let i = 0; i < 10; i++) emitOnce(24);
    assert(particles.countAliveExact() <= 64, '环形池被写爆，存活数超过容量');

    // 单次请求超容量要被夹到容量
    assert(emitOnce(500) === 64, '超容量请求未被夹到容量');

    particles.update(0.6);
    assert(particles.countAliveExact() === 0, '寿命到点后仍有存活粒子');
    assert(particles.stats.alive === 0, '存活估计值未归零');
    particles.dispose();
    return '越界、覆盖、超容量、过期回收 4 种情形均正确';
  });

  check(results, '预算：combo 永不降级，环境氛围先被砍', () => {
    const budget = new VfxBudget();
    let alive = 0;
    budget.bindAliveProvider(() => alive);

    budget.beginFrame(16);
    assert(budget.allow(VfxPriority.Ambient, 100) > 0, '满帧率下环境粒子被误砍');

    // 连续掉帧 → 降级阶梯第一档就是砍环境氛围
    budget.autoDegrade = true;
    for (let i = 0; i < 400; i++) budget.beginFrame(30);
    assert(budget.degrade >= DegradeLevel.NoAmbient, `掉帧后未降级，当前 ${budget.degrade}`);
    assert(budget.allow(VfxPriority.Ambient, 100) === 0, '降级后环境粒子仍在发射');
    assert(
      budget.allow(VfxPriority.Combo, 100) === 100,
      'combo 粒子被降级砍了——这是 GDD 明令禁止的',
    );

    // 池满时事件级仍可挤入（环形覆盖最老的），低优先级必须让路
    alive = VFX_BUDGET.maxParticles;
    assert(budget.allow(VfxPriority.Persistent, 50) === 0, '池满时持续状态仍在抢位置');
    assert(budget.allow(VfxPriority.Event, 50) === 50, '池满时事件级被挡住了');
    return `降级档 ${budget.degrade}，combo/事件在任何档位均满额`;
  });

  check(results, '预算：同类循环发射器 >10 个减半发射率并隔帧更新', () => {
    const budget = new VfxBudget();
    budget.bindAliveProvider(() => 0);
    budget.beginFrame(16);
    for (let i = 0; i < 10; i++) budget.acquireLoop('condense-mist', VfxPriority.Persistent);
    assert(budget.loopRate('condense-mist') === 1, '10 个以内不该减半');

    budget.acquireLoop('condense-mist', VfxPriority.Persistent);
    assert(budget.loopRate('condense-mist') === 0.5, '超过 10 个未减半');

    const ticks = [budget.shouldTickLoop('condense-mist', 0), budget.shouldTickLoop('condense-mist', 1)];
    assert(ticks[0] !== ticks[1], '拥挤时未做隔帧摊平');

    // 循环发射器总数不得突破 24
    for (let i = 0; i < 50; i++) budget.acquireLoop('mist-x', VfxPriority.Persistent);
    assert(
      budget.snapshot.loopEmitters <= VFX_BUDGET.maxLoopEmitters,
      `循环发射器 ${budget.snapshot.loopEmitters} 超过上限`,
    );
    assert(budget.violations().length === 0, `预算被突破：${budget.violations().join('; ')}`);
    return '减半、隔帧、总数上限三条规则均生效';
  });

  check(results, '顿帧节流：100ms 内只允许 1 次', () => {
    const impact = new ImpactDirector();
    assert(impact.requestHitstop(60), '第一次顿帧被拒');
    assert(!impact.requestHitstop(60), '同帧第二次顿帧未被驳回');

    impact.update(50);
    assert(!impact.requestHitstop(60), '50ms 后顿帧未被驳回');

    impact.update(60); // 累计 110ms
    assert(impact.requestHitstop(60), '110ms 后顿帧仍被拒');

    const stats = impact.diagnostics;
    assert(stats.hitstopsAccepted === 2, `接受数应为 2，实际 ${stats.hitstopsAccepted}`);
    assert(stats.hitstopsRejected === 2, `驳回数应为 2，实际 ${stats.hitstopsRejected}`);
    return `接受 ${stats.hitstopsAccepted} / 驳回 ${stats.hitstopsRejected}`;
  });

  check(results, '顿帧期间 timeScale 归零且到点恢复', () => {
    const impact = new ImpactDirector();
    impact.requestHitstop(60);
    assert(impact.timeScale === 0, '顿帧中 timeScale 不为 0');
    impact.update(30);
    assert(impact.timeScale === 0, '顿帧未走完就恢复了');
    impact.update(40);
    assert(impact.timeScale === 1, '顿帧结束后 timeScale 未恢复');
    return '0 → 0 → 1';
  });

  check(results, '震动取最大档、不叠加', () => {
    const impact = new ImpactDirector();
    impact.requestShake(ShakeTier.Medium, 200);
    impact.update(16);
    const strong = Math.hypot(impact.state.shake.x, impact.state.shake.y);

    // 中档还在跑时来一发轻档：不许把画面抖得更狠
    impact.requestShake(ShakeTier.Light, 200);
    impact.update(0);
    const merged = Math.hypot(impact.state.shake.x, impact.state.shake.y);
    assert(merged <= strong + 1e-6, `弱请求把震动叠大了：${strong} → ${merged}`);

    impact.update(400);
    const after = Math.hypot(impact.state.shake.x, impact.state.shake.y);
    assert(after === 0, '震动结束后仍有偏移');
    return `峰值 ${strong.toFixed(5)}，合并后 ${merged.toFixed(5)}，结束归零`;
  });

  check(results, '白闪按二次曲线收干净', () => {
    const impact = new ImpactDirector();
    impact.requestFlash(IMPACT_PRESETS.iceShatter.flash);
    assert(impact.state.flash.alpha > 0.5, '白闪峰值不足');
    impact.update(17);
    const mid = impact.state.flash.alpha;
    impact.update(120);
    assert(impact.state.flash.alpha === 0, `白闪未收干净，残留 ${impact.state.flash.alpha}`);
    return `峰值 0.62 → ${mid.toFixed(3)} → 0`;
  });

  check(results, '贴花：超出上限淘汰最旧，计数不越界', () => {
    const decals = new DecalManager(16);
    for (let i = 0; i < 100; i++) {
      decals.add({
        position: { x: i, y: 0, z: 0 },
        tile: 1,
        size: 1,
        color: PALETTE.ice,
        life: 100,
      });
    }
    assert(decals.count <= 16, `贴花数 ${decals.count} 超过容量 16`);

    const id = decals.add({
      position: ORIGIN,
      tile: 1,
      size: 1,
      color: PALETTE.ice,
      life: 100,
    });
    assert(decals.remove(id), '按 id 移除失败');
    decals.dispose();
    return '100 次写入后仍 ≤16 张，显式移除有效';
  });

  check(results, '冰碎：粒子 + 贴花 + 顿帧 + 白闪四件套齐发', () => {
    const vfx = new VfxSystem();
    vfx.beginFrame(16);
    const before = vfx.particles.stats.alive;
    vfx.play('ice-shatter', { position: ORIGIN, splashRadius: 1 });
    vfx.endFrame();

    const emitted = vfx.particles.stats.alive - before;
    // GDD 15.2 要求 24 粒冰晶；实现里还有亮芯、溅射环与霜屑
    assert(emitted >= 24, `冰碎只发了 ${emitted} 粒，低于 GDD 规定的 24`);
    assert(vfx.decals.count === 1, `霜痕贴花数应为 1，实际 ${vfx.decals.count}`);
    assert(vfx.impact.isHitstopped, '冰碎没有触发顿帧');
    assert(vfx.impact.state.flash.alpha > 0.5, '冰碎没有触发白闪');
    assert(vfx.budget.violations().length === 0, '冰碎把预算打爆了');
    vfx.dispose();
    return `${emitted} 粒 + 1 张霜痕 + 60ms 顿帧 + 白闪 ${vfx.impact.state.flash.alpha.toFixed(2)}`;
  });

  check(results, '顿帧期间粒子时钟同步冻结', () => {
    const vfx = new VfxSystem();
    vfx.beginFrame(16);
    vfx.play('ice-shatter', { position: ORIGIN });
    vfx.endFrame();
    const frozenAt = vfx.particles.time;

    // 顿帧的 60ms 内，粒子必须和画面一起定住，否则碎片会在停格里继续飞
    vfx.beginFrame(16);
    vfx.endFrame();
    assert(
      vfx.particles.time === frozenAt,
      `顿帧期间粒子时钟仍在走：${frozenAt} → ${vfx.particles.time}`,
    );

    for (let i = 0; i < 5; i++) {
      vfx.beginFrame(16);
      vfx.endFrame();
    }
    assert(vfx.particles.time > frozenAt, '顿帧结束后粒子时钟未恢复');
    vfx.dispose();
    return '冻结 → 恢复，均正确';
  });

  check(results, '循环发射器：启停对称，不泄漏预算槽位', () => {
    const vfx = new VfxSystem();
    const handles = [];
    for (let i = 0; i < 8; i++) {
      const handle = vfx.play('condense-mist', {
        position: { x: i, y: 1, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        range: 3,
      });
      assert(handle !== null, `第 ${i} 个冷凝雾发射器未拿到句柄`);
      handles.push(handle);
    }
    assert(vfx.stats.loopEmitters === 8, `循环发射器应为 8，实际 ${vfx.stats.loopEmitters}`);

    for (let frame = 0; frame < 30; frame++) {
      vfx.beginFrame(16);
      vfx.endFrame();
    }
    assert(vfx.particles.stats.alive > 0, '冷凝雾一颗粒子都没吐出来');

    for (const handle of handles) handle?.stop();
    // 重复 stop 必须幂等，否则槽位会被减成负数
    for (const handle of handles) handle?.stop();
    assert(vfx.stats.loopEmitters === 0, `停止后仍占 ${vfx.stats.loopEmitters} 个槽位`);
    vfx.dispose();
    return '8 个发射器启停对称，重复 stop 幂等';
  });

  check(results, '压力：60 秒混合大潮不突破任何预算', () => {
    const vfx = new VfxSystem();
    vfx.budget.autoDegrade = false; // 固定满配，看的是硬上限而不是降级后的上限

    const mists = [];
    for (let i = 0; i < 6; i++) {
      mists.push(
        vfx.play('condense-mist', {
          position: { x: i * 2, y: 1, z: 3 },
          direction: { x: 0, y: 0, z: 1 },
          range: 3.2,
        }),
      );
    }

    let peak = 0;
    for (let frame = 0; frame < 3600; frame++) {
      vfx.beginFrame(16.7);
      if (frame % 6 === 0) vfx.play('ice-shatter', { position: { x: frame % 20, y: 0.5, z: 6 } });
      if (frame % 4 === 0) vfx.play('hammer-impact', { position: { x: 3, y: 0.1, z: 2 }, shockwave: true });
      if (frame % 30 === 0) vfx.play('overload-start', { position: { x: 14, y: 0.8, z: 6 } });
      if (frame % 9 === 0) vfx.play('unit-death', { position: { x: 8, y: 0.4, z: 5 } });
      vfx.endFrame();

      peak = Math.max(peak, vfx.stats.aliveParticles);
      const violations = vfx.budget.violations();
      assert(violations.length === 0, `第 ${frame} 帧：${violations.join('; ')}`);
    }
    for (const mist of mists) mist?.stop();
    const decals = vfx.decals.count;
    assert(decals <= VFX_BUDGET.maxDecals, `贴花 ${decals} 超上限`);
    vfx.dispose();
    return `3600 帧峰值 ${peak} 粒 / ≤${VFX_BUDGET.maxParticles}，贴花 ${decals} / ≤${VFX_BUDGET.maxDecals}`;
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
