import { BoxGeometry, Mesh, MeshStandardMaterial, Points, Scene, type ShaderMaterial } from 'three';

import type { CombatEventMap, CombatEventName } from '../combat/events';
import { Loop } from '../engine/core/Loop';
import { EmissiveMask } from '../engine/postfx/EmissiveMask';
import { getBloomMaskPolicy, hideFromBloomMask } from '../engine/postfx/bloomMask';
import { DecalManager } from './DecalManager';
import { GpuParticleSystem } from './GpuParticleSystem';
import { ImpactDirector, IMPACT_PRESETS, ShakeTier } from './ImpactDirector';
import { VfxSystem } from './VfxSystem';
import { DegradeLevel, VFX_BUDGET, VfxBudget } from './budget';
import { ParticleTile, buildParticleAtlas } from './atlas';
import { PALETTE, withAlpha } from './palette';
import { VfxPriority } from './events';
import { connectCombatToVfx, type CombatEventSource } from './combatBridge';

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

/** 战斗事件桥的测试替身：只要能订阅就够，不需要拉起整个 CombatSystem。 */
class FakeCombatBus implements CombatEventSource {
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
    const peak = IMPACT_PRESETS.iceShatter.flash.intensity ?? 0;
    impact.requestFlash(IMPACT_PRESETS.iceShatter.flash);
    assert(impact.state.flash.alpha === peak, '白闪没有立刻到峰值');
    // 上限是可读性立法：白闪盖的是整块屏幕，超过这个值冰碎头两帧的碎片会被一起洗白
    assert(peak <= 0.4, `冰碎白闪峰值 ${peak} 过高，会把碎片糊掉`);
    impact.update(17);
    const mid = impact.state.flash.alpha;
    impact.update(120);
    assert(impact.state.flash.alpha === 0, `白闪未收干净，残留 ${impact.state.flash.alpha}`);
    return `峰值 ${peak} → ${mid.toFixed(3)} → 0`;
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
    assert(vfx.impact.state.flash.alpha > 0.2, '冰碎没有触发白闪');
    assert(vfx.budget.violations().length === 0, '冰碎把预算打爆了');
    vfx.dispose();
    return `${emitted} 粒 + 1 张霜痕 + 60ms 顿帧 + 白闪 ${vfx.impact.state.flash.alpha.toFixed(2)}`;
  });

  check(results, '粒子：bloom 权重进 attribute，遮罩 pass 切 uniform', () => {
    const particles = new GpuParticleSystem({ additiveCapacity: 8, alphaCapacity: 8 });
    const [additive, alpha] = particles.root.children as [Points, Points];

    particles.emit({
      count: 1,
      position: ORIGIN,
      life: 1,
      sizeStart: 1,
      sizeEnd: 1,
      colorStart: PALETTE.ice,
      colorEnd: PALETTE.ice,
      tile: ParticleTile.Flare,
      bloom: 0.3,
    });
    const written = additive.geometry.getAttribute('aBloom').array[0];
    assert(Math.abs(written - 0.3) < 1e-6, `bloom 权重没写进 attribute：${written}`);

    // 不传就是全额：既有效果不会因为多了这个字段而变暗
    particles.emit({
      count: 1,
      position: ORIGIN,
      life: 1,
      sizeStart: 1,
      sizeEnd: 1,
      colorStart: PALETTE.ice,
      colorEnd: PALETTE.ice,
      tile: ParticleTile.Frost,
    });
    assert(additive.geometry.getAttribute('aBloom').array[1] === 1, '默认 bloom 权重不是 1');

    const uniforms = (points: Points) =>
      (points.material as ShaderMaterial).uniforms as Record<string, { value: number }>;
    particles.setMaskPass(true);
    assert(uniforms(additive).uMaskPass.value === 1, '加法层没有进入遮罩 pass 模式');
    assert(uniforms(alpha).uMaskPass.value === 1, '常规层没有进入遮罩 pass 模式');
    assert(uniforms(alpha).uCull.value === 1, '常规层在遮罩 pass 里没有被剔除');
    assert(uniforms(additive).uCull.value === 0, '加法层被误剔出 Bloom——它本来就是光');

    particles.setMaskPass(false);
    assert(uniforms(additive).uMaskPass.value === 0, '遮罩 pass 结束后没有还原');
    assert(uniforms(alpha).uCull.value === 0, '遮罩 pass 结束后常规层仍被剔除');
    particles.dispose();
    return '权重落盘、默认全额、遮罩 pass 开关对称';
  });

  check(results, '冰碎：辉光让位给碎片（R2「Bloom 糊白」的回归闸门）', () => {
    const vfx = new VfxSystem();
    const [additive, alpha] = vfx.particles.root.children as [Points, Points];

    assert(
      alpha.renderOrder > additive.renderOrder,
      `实心碎片必须画在加法辉光之上，现在 ${alpha.renderOrder} vs ${additive.renderOrder}`,
    );

    vfx.beginFrame(16.7);
    vfx.play('ice-shatter', { position: ORIGIN, splashRadius: 1 });
    vfx.endFrame();

    // 亮芯 / 溅射环 / 霜屑都在加法层，全都必须打过折：
    // 只要有一条走全额，近景那一发就会重新糊回一团白
    const weights = additive.geometry.getAttribute('aBloom').array as ArrayLike<number>;
    const born = additive.geometry.getAttribute('aTime').array as ArrayLike<number>;
    let checked = 0;
    for (let i = 0; i < weights.length; i++) {
      if (born[i * 2 + 1] <= 0) continue;
      assert(weights[i] < 1, `加法层第 ${i} 颗粒子仍在全额进 Bloom`);
      checked++;
    }
    assert(checked >= 15, `加法层只发了 ${checked} 粒，冰碎的辉光层不见了`);

    // 碎片本身走 alpha 层，遮罩 pass 会整层剔除，所以它天然不进 Bloom；
    // 这里盯的是「碎片还在」，别把可读性修成把主体删了
    const shards = alpha.geometry.getAttribute('aTime').array as ArrayLike<number>;
    let alive = 0;
    for (let i = 0; i < shards.length / 2; i++) if (shards[i * 2 + 1] > 0) alive++;
    assert(alive >= 24, `冰晶碎片只剩 ${alive} 粒，低于 GDD 规定的 24`);

    vfx.dispose();
    return `碎片 ${alive} 粒画在辉光之上，辉光 ${checked} 粒全部限额进 Bloom`;
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

  check(results, '自发光遮罩：粒子/贴花保留自己的着色器，普通网格照常代理', () => {
    const scene = new Scene();
    const vfx = new VfxSystem({ additiveCapacity: 64, alphaCapacity: 64, decalCapacity: 8 });
    vfx.attachTo(scene);

    const lit = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    const gizmo = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    hideFromBloomMask(gizmo);
    scene.add(lit, gizmo);

    const particles = vfx.particles.root.children[0] as Mesh;
    assert(
      getBloomMaskPolicy(particles)?.skipMaterialSwap === true,
      '粒子层没有声明跳过遮罩材质替换',
    );
    assert(
      getBloomMaskPolicy(vfx.decals.mesh)?.skipMaterialSwap === true,
      '贴花层没有声明跳过遮罩材质替换',
    );

    const particleMaterial = particles.material;
    const decalMaterial = vfx.decals.mesh.material;
    const litMaterial = lit.material;

    const mask = new EmissiveMask();
    mask.apply(scene);
    // 换掉粒子材质 = 20,000 颗粒子退回出生点 + 遮罩图上一片黑方块
    assert(particles.material === particleMaterial, '粒子材质在遮罩 pass 里被换掉了');
    assert(vfx.decals.mesh.material === decalMaterial, '贴花材质在遮罩 pass 里被换掉了');
    assert(lit.material !== litMaterial, '普通网格没有换成代理材质，遮罩会吃到光照反照率');
    assert(!gizmo.visible, 'hidden 策略的对象仍进了遮罩 pass');

    mask.revert();
    assert(lit.material === litMaterial, '遮罩 pass 结束后没有还原真实材质');
    assert(gizmo.visible, 'hidden 策略的对象没有被还原可见');

    mask.dispose();
    vfx.dispose();
    return '粒子/贴花保留自身材质，普通网格代理并还原，hidden 子树被排除';
  });

  check(results, '引擎帧协议：冰碎顿帧冻结逻辑 tick，渲染照常出帧', () => {
    const loop = new Loop();
    const vfx = new VfxSystem();
    const dt = 1 / 60;

    let ticks = 0;
    let frames = 0;
    let fired = false;

    loop.onFrameBegin.add(({ realDelta }) => {
      // 这一行就是「引擎采纳 timeScale」，整份自检就是为了盯死它
      loop.timeScale = vfx.beginFrame(realDelta * 1000).timeScale;
    });
    loop.onFixedUpdate.add(() => {
      ticks += 1;
      if (fired) return;
      fired = true;
      vfx.play('ice-shatter', { position: ORIGIN });
    });
    loop.onRender.add(() => vfx.endFrame());
    loop.onPresent.add(() => {
      frames += 1;
    });

    loop.step(dt);
    assert(fired, '第一帧没有跑逻辑 tick');
    const ticksAtShatter = ticks;
    const framesAtShatter = frames;

    // 60ms 顿帧 ≈ 3.6 个 60fps 帧：这 3 帧里逻辑必须完全停住
    for (let i = 0; i < 3; i++) loop.step(dt);
    assert(ticks === ticksAtShatter, `顿帧期间跑了 ${ticks - ticksAtShatter} 个逻辑 tick`);
    assert(frames === framesAtShatter + 3, '顿帧把渲染也停了——顿帧只冻结模拟，不冻结画面');
    assert(loop.timeScale === 0, '顿帧期间 timeScale 不是 0');

    // 顿帧走完必须自己恢复，不需要任何人手动重置
    for (let i = 0; i < 3; i++) loop.step(dt);
    assert(loop.timeScale === 1, '顿帧结束后 timeScale 未恢复');
    assert(ticks > ticksAtShatter, '顿帧结束后逻辑没有恢复推进');

    loop.dispose();
    vfx.dispose();
    return `顿帧 3 帧内 0 tick / ${frames - framesAtShatter} 帧画面，之后恢复到 ${ticks} tick`;
  });

  check(results, '战斗事件桥：稳定信号 → 粒子，冲击不被重复请求', () => {
    const vfx = new VfxSystem();
    const bus = new FakeCombatBus();
    const bridge = connectCombatToVfx(bus, vfx, { mistTowers: ['condenser_jet'] });

    vfx.beginFrame(16.7);
    bus.emit('ice_shatter', {
      enemyId: 1,
      sourceId: 2,
      position: { x: 3.5, y: 4.5 },
      splashRadius: 1,
      direction: { x: 1, y: 0 },
      damage: 112,
      impact: { signal: 'ice_shatter', hitstop: 60, flash: '#BFF7FF' },
    });
    assert(
      vfx.particles.stats.emittedThisFrame >= 24,
      `冰碎信号只发了 ${vfx.particles.stats.emittedThisFrame} 粒`,
    );
    assert(vfx.decals.count === 1, '冰碎信号没有留下霜痕贴花');
    assert(vfx.impact.isHitstopped, '冰碎信号没有触发顿帧');

    // 同一行还会发一条 reaction_triggered；带稳定信号的行必须被桥忽略，
    // 否则这里会多出一次被 100ms 立法驳回的顿帧请求
    bus.emit('reaction_triggered', {
      rowId: 'ice_shatter',
      position: { x: 3.5, y: 4.5 },
      impact: { signal: 'ice_shatter', hitstop: 60, flash: '#BFF7FF' },
    });
    assert(
      vfx.impact.diagnostics.hitstopsRejected === 0,
      '带稳定信号的反应行又请求了一次顿帧',
    );

    bus.emit('frozen', {
      phase: 'begin',
      enemyId: 1,
      position: { x: 3.5, y: 4.5 },
      radius: 0.4,
      duration: 2,
    });
    bus.emit('overload', {
      phase: 'begin',
      scope: 'radius',
      origin: { x: 8.5, y: 6.5 },
      radiusCells: 1,
      towers: [{ towerId: 9, defId: 'mg_rivet', position: { x: 8.5, y: 5.5 } }],
      duration: 6,
      overheat: 3,
    });
    bus.emit('enemy_killed', {
      enemyId: 1,
      defId: 'scavenger_bug',
      bounty: 5,
      position: { x: 3.5, y: 4.5 },
    });
    assert(bridge.played['freeze'] === 1, '冻结信号没有接上');
    assert(bridge.played['overload-start'] === 1, '超载信号没有接上');
    assert(bridge.played['unit-death'] === 1, '击杀没有接上');

    // 冷凝塔连续开火只维持一个循环发射器
    const shot = {
      towerId: 7,
      defId: 'condenser_jet',
      from: { x: 2.5, y: 2.5 },
      to: { x: 5.5, y: 2.5 },
      attackKind: 'cone',
    };
    bus.emit('tower_fired', shot);
    bus.emit('tower_fired', shot);
    assert(bridge.activeLoops === 1, `冷凝雾发射器应为 1，实际 ${bridge.activeLoops}`);
    vfx.endFrame();

    // 停火 700ms 后自动收掉，不需要战斗层发「我停了」
    for (let i = 0; i < 45; i++) {
      vfx.beginFrame(16.7);
      vfx.endFrame();
    }
    assert(bridge.activeLoops === 0, '停火后冷凝雾没有自动停');
    assert(vfx.stats.loopEmitters === 0, '循环发射器槽位泄漏');

    bridge.detach();
    vfx.dispose();
    return `冰碎/冻结/超载/击杀四条信号接通，冷凝雾启停对称`;
  });

  check(results, '战斗事件桥：只有无稳定信号的行才吃通用屏幕冲击', () => {
    const vfx = new VfxSystem();
    const bus = new FakeCombatBus();
    const bridge = connectCombatToVfx(bus, vfx);

    vfx.beginFrame(16.7);
    // 大招·主控过载：80ms 顿帧 + 电青闪 + 轻震，全部写在行的 impact 里
    bus.emit('reaction_triggered', {
      rowId: 'master_overload',
      position: { x: 10.5, y: 6.5 },
      impact: { hitstop: 80, flash: '#35E0FF', shake: 'light' },
    });
    assert(vfx.impact.isHitstopped, '通用路径没有吃到行声明的顿帧');
    assert(vfx.impact.state.flash.alpha > 0.4, '通用路径没有吃到行声明的闪光');
    vfx.endFrame();

    vfx.beginFrame(16.7);
    const shake = Math.hypot(vfx.impact.state.shake.x, vfx.impact.state.shake.y);
    assert(shake > 0, '通用路径没有吃到行声明的震动');
    vfx.endFrame();

    // 什么冲击都没声明的行不该惊动 ImpactDirector
    const accepted = vfx.impact.diagnostics.hitstopsAccepted;
    bus.emit('reaction_triggered', {
      rowId: 'oil_cell_coats',
      position: { x: 4.5, y: 4.5 },
      impact: { vfx: 'fx_oil_step' },
    });
    assert(
      vfx.impact.diagnostics.hitstopsAccepted === accepted &&
        vfx.impact.diagnostics.hitstopsRejected === 0,
      '没有声明冲击的行也去请求了顿帧',
    );

    bridge.detach();
    vfx.dispose();
    return `顿帧 80ms + 闪光 + 震动 ${shake.toFixed(5)}，无冲击行静默`;
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
