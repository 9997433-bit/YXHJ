import { Vector3 } from 'three';

import type { CombatEventMap, CombatEventName } from '../../combat/events';
import { Engine } from '../../engine/Engine';
import { ParticleTile } from '../atlas';
import { connectCombatToVfx, type CombatEventSource } from '../combatBridge';
import { attachVfxToEngine } from '../engineBridge';
import { VfxPriority } from '../events';
import { IMPACT_PRESETS } from '../ImpactDirector';
import { PALETTE, boost, withAlpha, type RGBA } from '../palette';
import { VfxSystem } from '../VfxSystem';

/**
 * 冰碎近景可读性探针（R2 遗留缺陷「冰碎 Bloom 糊白，碎片不可读」的量化闸门）。
 *
 * 「好看」没法自动化，「读不出碎片」可以：糊白的画面有三个共同特征——
 * 大片像素三通道同时顶到接近 1、边缘能量塌掉（硬边多面体的轮廓被辉光填平）、
 * 冰白的蓝调被拉成中性白。本页在真 `Engine`（含双 composer 自发光遮罩 Bloom）
 * 里放一发冰碎，在固定的几个时刻读回默认帧缓冲，算出这三个数。
 *
 * 白闪是 DOM 层（`ImpactOverlay`），不在画布里，所以采样时按
 * `ImpactDirector` 当前的 flash alpha 在数值上合成回去——不然会漏算
 * 「糊白」里由白闪贡献的那一半。
 *
 * URL 参数：
 * - `?tuning=r2` 用 Round 2 的参数重放同一发，做 A/B 对照（实现见 `playIceShatterR2`）
 * - `?post=<url>` 算完把报告 POST 过去，给 `readability.probe.mjs` 收集
 *
 * 逐帧可复现：固定步长 + 固定粒子随机种子 + 关相机震动，同一次提交跑两遍数字一致。
 */

const FIXED_DT = 1 / 60;
const PARTICLE_SEED = 0x5eed1ce;

/** 受害者所在格；棋盘中央偏左，保证 3 格采样窗完整落在画面内。 */
const VICTIM = { x: 9.5, y: 5.5 };
const VICTIM_HEIGHT = 0.45;

/** 采样时刻，单位是「冰碎之后的毫秒」。60ms 顿帧期间粒子定住，是最容易糊的一段。 */
const SAMPLE_MS = [17, 100, 200, 350] as const;

/** 采样窗边长 = 3 格，冰碎溅射 1 格 + 碎片飞散范围都在里面。 */
const SAMPLE_CELLS = 3;

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

// ---------------------------------------------------------------------------
// Round 2 的冰碎参数，原样留档
// ---------------------------------------------------------------------------

/**
 * `effects.ts` 在 Round 2 时的冰碎实现，逐字段抄进探针当对照组。
 *
 * 留一份副本而不是 git 里翻旧版，是因为 A/B 必须在**同一次运行、同一台机器、
 * 同一个 SwiftShader** 下出数：跨提交比对的数字没法证明是参数改好了还是环境变了。
 */
function playIceShatterR2(vfx: VfxSystem, position: Vector3, radius: number): void {
  const ICE_TAIL: RGBA = [
    PALETTE.electric[0] * 0.9,
    PALETTE.electric[1] * 1.1,
    PALETTE.electric[2] * 1.3,
    0,
  ];
  const gravity = { x: 0, y: -14, z: 0 };
  const emit = (params: Parameters<VfxSystem['particles']['emit']>[0]): void => {
    vfx.particles.emit(params, vfx.budget.allow(VfxPriority.Combo, params.count));
  };

  for (const tile of [ParticleTile.IceShardA, ParticleTile.IceShardB, ParticleTile.IceShardC]) {
    emit({
      count: 8,
      position,
      positionJitter: 0.12,
      direction: { x: 0, y: 1, z: 0 },
      coneAngle: Math.PI * 0.62,
      speed: 4.2 * radius,
      speedJitter: 1.8,
      acceleration: gravity,
      drag: 0.9,
      life: 0.5,
      lifeJitter: 0.14,
      sizeStart: 0.34 * radius,
      sizeEnd: 0.26 * radius,
      sizeJitter: 0.45,
      colorStart: boost(PALETTE.ice, 1.25),
      colorEnd: ICE_TAIL,
      colorCurve: 3,
      tile,
      randomRotation: true,
      spin: 11,
      blend: 'alpha',
    });
  }

  emit({
    count: 1,
    position,
    life: 0.16,
    sizeStart: 1.5 * radius,
    sizeEnd: 2.9 * radius,
    colorStart: boost(PALETTE.ice, 2.6),
    colorEnd: withAlpha(PALETTE.ice, 0),
    sizeCurve: 0.5,
    tile: ParticleTile.Flare,
    blend: 'additive',
  });

  emit({
    count: 1,
    position: { x: position.x, y: position.y + 0.05, z: position.z },
    life: 0.3,
    sizeStart: 0.5 * radius,
    sizeEnd: 2.4 * radius,
    colorStart: boost(PALETTE.ice, 1.9),
    colorEnd: withAlpha(PALETTE.ice, 0),
    sizeCurve: 0.55,
    tile: ParticleTile.Ring,
    blend: 'additive',
  });

  emit({
    count: 14,
    position,
    positionJitter: 0.18,
    coneAngle: Math.PI,
    speed: 1.6,
    speedJitter: 0.9,
    acceleration: { x: 0, y: -1.4, z: 0 },
    drag: 2.6,
    life: 0.9,
    lifeJitter: 0.25,
    sizeStart: 0.11,
    sizeEnd: 0.015,
    sizeJitter: 0.4,
    colorStart: boost(PALETTE.ice, 2.2),
    colorEnd: withAlpha(PALETTE.ice, 0),
    colorCurve: 1.8,
    tile: ParticleTile.Frost,
    randomRotation: true,
    spin: 4,
    blend: 'additive',
  });

  vfx.impact.play(IMPACT_PRESETS.iceShatter);
}

// ---------------------------------------------------------------------------
// 采样与度量
// ---------------------------------------------------------------------------

export interface ReadabilitySample {
  /** 冰碎之后的毫秒 */
  atMs: number;
  /** 三通道同时 ≥0.90 的像素占比：糊白的直接读数 */
  blownFraction: number;
  /** Sobel 边缘能量均值：碎片的硬边还在不在 */
  edgeEnergy: number;
  /** 采样窗平均亮度 */
  meanLuma: number;
  /**
   * 「认得出是冰」的像素占比：够亮 + 蓝明显压过红。
   *
   * 不能用整窗平均色来判断冰白有没有褪成中性白——糊白时整窗被辉光顶成一片
   * 偏冷的亮色，平均值反而漂亮；辉光收掉之后暖棕地面露出来，平均值必然转红。
   * 真正要问的是「画面里还有没有一块认得出是冰的东西」。
   */
  coldFraction: number;
  /** 上面这些冰像素的平均 (蓝 − 红)：冰白褪成纯白时趋近 0 */
  coldChroma: number;
  /**
   * 冰像素上的边缘能量：这团冰**有没有形状**。
   *
   * 「一坨糊白的辉光」和「一把硬边碎片」的冰像素占比可以一样高，区别只在
   * 前者内部是平的。这是本探针对「碎片可读」最贴近的单一读数。
   */
  coldEdgeEnergy: number;
  /** 本帧 DOM 白闪的不透明度，已合成进上面这些数 */
  flashAlpha: number;
}

/** 判定「这个像素读得出是冰」的门槛。 */
const COLD = { minLuma: 0.25, minChroma: 0.06 } as const;

export interface ReadabilityReport {
  tuning: string;
  gpu: string;
  viewport: { width: number; height: number };
  window: { x: number; y: number; size: number };
  samples: ReadabilitySample[];
  /** `?png=1` 时每个采样时刻的画面（已把 DOM 白闪合成进去），data URL。 */
  frames?: { atMs: number; png: string }[];
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(Math.max(v, 0), 1);
}

/**
 * 读回默认帧缓冲的一块方形区域并算出四个读数。
 *
 * 必须在 `loop.step()` 之后、把控制权交回浏览器之前调用：画布没开
 * `preserveDrawingBuffer`，一旦让出主线程内容就被清掉了。
 */
function measure(
  gl: WebGL2RenderingContext,
  x: number,
  y: number,
  size: number,
  flash: { color: RGBA; alpha: number },
): Omit<ReadabilitySample, 'atMs'> {
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const flashAlpha = Math.min(Math.max(flash.alpha, 0), 1);
  const flashRgb = [
    linearToSrgb(flash.color[0]),
    linearToSrgb(flash.color[1]),
    linearToSrgb(flash.color[2]),
  ];

  const luma = new Float32Array(size * size);
  const cold = new Uint8Array(size * size);
  let blown = 0;
  let lumaSum = 0;
  let coldSum = 0;
  let coldCount = 0;

  for (let i = 0; i < size * size; i++) {
    const r = (pixels[i * 4] / 255) * (1 - flashAlpha) + flashRgb[0] * flashAlpha;
    const g = (pixels[i * 4 + 1] / 255) * (1 - flashAlpha) + flashRgb[1] * flashAlpha;
    const b = (pixels[i * 4 + 2] / 255) * (1 - flashAlpha) + flashRgb[2] * flashAlpha;

    if (Math.min(r, g, b) >= 0.9) blown++;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[i] = l;
    lumaSum += l;
    if (l >= COLD.minLuma && b - r >= COLD.minChroma) {
      cold[i] = 1;
      coldSum += b - r;
      coldCount++;
    }
  }

  // Sobel：碎片是硬边多面体，读得出来就意味着窗口里有大量高梯度像素。
  // 辉光糊平之后梯度会整体塌下去，这是「可读」最直接的代理指标。
  let edgeSum = 0;
  let edgeCount = 0;
  let coldEdgeSum = 0;
  let coldEdgeCount = 0;
  for (let j = 1; j < size - 1; j++) {
    for (let i = 1; i < size - 1; i++) {
      const at = (di: number, dj: number) => luma[(j + dj) * size + i + di];
      const gx =
        at(-1, -1) + 2 * at(-1, 0) + at(-1, 1) - (at(1, -1) + 2 * at(1, 0) + at(1, 1));
      const gy =
        at(-1, -1) + 2 * at(0, -1) + at(1, -1) - (at(-1, 1) + 2 * at(0, 1) + at(1, 1));
      const magnitude = Math.hypot(gx, gy);
      edgeSum += magnitude;
      edgeCount++;
      if (cold[j * size + i]) {
        coldEdgeSum += magnitude;
        coldEdgeCount++;
      }
    }
  }

  return {
    blownFraction: blown / (size * size),
    edgeEnergy: edgeCount > 0 ? edgeSum / edgeCount : 0,
    meanLuma: lumaSum / (size * size),
    coldFraction: coldCount / (size * size),
    coldChroma: coldCount > 0 ? coldSum / coldCount : 0,
    coldEdgeEnergy: coldEdgeCount > 0 ? coldEdgeSum / coldEdgeCount : 0,
    flashAlpha,
  };
}

/**
 * 把画布连同 DOM 白闪一起烤成一张 PNG。
 *
 * 白闪住在 `ImpactOverlay`（DOM）里，截图工具抓得到、`gl.readPixels` 抓不到。
 * 人工复核用的图必须和度量看到的是同一幅画面，所以这里手工合成一次。
 */
function snapshot(
  canvas: HTMLCanvasElement,
  flash: { color: RGBA; alpha: number },
): string {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(canvas, 0, 0);
  const alpha = Math.min(Math.max(flash.alpha, 0), 1);
  if (alpha > 0.001) {
    const to255 = (c: number) => Math.round(linearToSrgb(c) * 255);
    ctx.fillStyle = `rgba(${to255(flash.color[0])}, ${to255(flash.color[1])}, ${to255(flash.color[2])}, ${alpha})`;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  return out.toDataURL('image/png');
}

export function runReadabilityProbe(container: HTMLElement): ReadabilityReport {
  const params = new URLSearchParams(location.search);
  const tuning = params.get('tuning') === 'r2' ? 'r2' : 'current';
  const wantFrames = params.get('png') === '1';

  const engine = new Engine(container, { testbed: false });
  const vfx = new VfxSystem({ seed: PARTICLE_SEED });
  // 震动会把采样窗挪开，逐帧可复现优先
  const bridge = attachVfxToEngine(engine, vfx, { cameraShake: false });
  const bus = new ScriptedCombatBus();
  const combat = connectCombatToVfx(bus, vfx, { mistTowers: ['condenser_jet'] });

  // 「近景」= 第二档缩放，也就是 R2 报告里读不出碎片的那个视距
  engine.cameraRig.cycleZoom();
  engine.resize();

  const gl = engine.renderer.getContext() as WebGL2RenderingContext;
  const world = new Vector3(VICTIM.x, VICTIM_HEIGHT, VICTIM.y);
  const edge = new Vector3(VICTIM.x + SAMPLE_CELLS / 2, VICTIM_HEIGHT, VICTIM.y);

  const toPixels = (v: Vector3): { x: number; y: number } => {
    const p = v.clone().project(engine.camera);
    return {
      x: ((p.x + 1) / 2) * gl.drawingBufferWidth,
      y: ((p.y + 1) / 2) * gl.drawingBufferHeight,
    };
  };

  const center = toPixels(world);
  const half = Math.abs(toPixels(edge).x - center.x);
  const size = Math.max(Math.round(half * 2), 32);
  const originX = Math.round(center.x - size / 2);
  const originY = Math.round(center.y - size / 2);

  // 预热：地面/塔/雾都还没进来，但引擎自己的首帧编译不该算进采样
  for (let i = 0; i < 6; i++) engine.loop.step(FIXED_DT);

  if (tuning === 'r2') {
    playIceShatterR2(vfx, world, 1);
  } else {
    bus.emit('ice_shatter', {
      enemyId: 42,
      sourceId: 7,
      position: VICTIM,
      splashRadius: 1,
      direction: { x: -1, y: 0 },
      damage: 112,
      impact: { signal: 'ice_shatter', hitstop: 60, flash: '#BFF7FF', tip: 'tip_shatter' },
    });
  }

  const samples: ReadabilitySample[] = [];
  const frames: { atMs: number; png: string }[] = [];
  let elapsedMs = 0;
  for (const atMs of SAMPLE_MS) {
    while (elapsedMs < atMs) {
      engine.loop.step(FIXED_DT);
      elapsedMs += FIXED_DT * 1000;
    }
    const flash = vfx.impact.state.flash;
    samples.push({ atMs, ...measure(gl, originX, originY, size, flash) });
    if (wantFrames) frames.push({ atMs, png: snapshot(engine.canvas, flash) });
  }

  const report: ReadabilityReport = {
    tuning,
    gpu: engine.gpu,
    viewport: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
    window: { x: originX, y: originY, size },
    samples,
    ...(wantFrames ? { frames } : {}),
  };

  combat.detach();
  bridge.detach();
  return report;
}

function formatReport(report: ReadabilityReport): string {
  const head = `tuning=${report.tuning}  ${report.viewport.width}x${report.viewport.height}  窗 ${report.window.size}px\n${report.gpu}\n`;
  const rows = report.samples.map(
    (s) =>
      `+${String(s.atMs).padStart(3)}ms  糊白 ${(s.blownFraction * 100).toFixed(1).padStart(5)}%` +
      `  边缘 ${s.edgeEnergy.toFixed(3).padStart(6)}` +
      `  亮度 ${s.meanLuma.toFixed(3)}` +
      `  冰像素 ${(s.coldFraction * 100).toFixed(1).padStart(5)}%` +
      ` 蓝调 ${s.coldChroma.toFixed(3)} 边缘 ${s.coldEdgeEnergy.toFixed(3)}` +
      `  白闪 ${s.flashAlpha.toFixed(2)}`,
  );
  return `${head}${rows.join('\n')}`;
}

const stage = document.getElementById('lw-stage');
if (stage) {
  const report = runReadabilityProbe(stage);

  const pre = document.createElement('pre');
  pre.id = 'lw-report';
  pre.style.cssText = [
    'position:absolute',
    'left:16px',
    'top:16px',
    'margin:0',
    'padding:10px 12px',
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#bfe9f5',
    'background:rgba(8,10,12,0.82)',
    'border:1px solid rgba(53,224,255,0.35)',
    'z-index:30',
  ].join(';');
  pre.textContent = formatReport(report);
  document.body.append(pre);

  const json = document.createElement('script');
  json.type = 'application/json';
  json.id = 'lw-report-json';
  // 画面留给 POST 那一份；塞进 DOM 只会让 --dump-dom 抓出几 MB base64
  json.textContent = JSON.stringify({ ...report, frames: undefined });
  document.body.append(json);
  document.body.dataset.probeReady = 'true';

  const post = new URLSearchParams(location.search).get('post');
  if (post) {
    void fetch(post, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
  }
}
