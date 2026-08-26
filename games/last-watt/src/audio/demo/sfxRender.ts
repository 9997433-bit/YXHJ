import { AudioEngine } from '../AudioEngine';
import { SFX_IDS, VOICES, type SfxId } from '../voices';

/**
 * 把四条 M1 音效真的渲染成波形，然后量它们。
 *
 * `selfcheck.ts` 的替身只能证明「节点搭出来了」，证明不了「合成器接受这张图」——
 * 一个非法的 `exponentialRampToValueAtTime(0, t)`、一个拼错的滤波器类型，
 * 在替身上一路绿灯，在真浏览器里是一次抛异常加一片寂静。
 *
 * 这一页用 `OfflineAudioContext` 离线渲染（不需要声卡，无头 Chrome 里照跑），
 * 对每条音效给出四个读数：峰值、RMS、有效时长、频谱重心。
 * 前两个回答「响不响 / 会不会削波」，后两个回答「四条音效彼此区分得开吗」。
 */

const SAMPLE_RATE = 48000;
const RENDER_SECONDS = 1.2;

export interface SfxMeasurement {
  id: SfxId;
  /** 绝对峰值。≥1 就是削波 */
  peak: number;
  /** 均方根，主观响度的粗略代理 */
  rms: number;
  /** 从起点到最后一个 ≥ 峰值 1% 的采样，秒 */
  durationSec: number;
  /** 频谱重心（Hz）：这条音效「听起来有多亮」，四条之间必须拉得开 */
  centroidHz: number;
  /** 同一条音色绕开总线（无总音量、无压限器）的峰值，用来分辨「音色写轻了」和「总线压过头了」 */
  rawPeak: number;
  /** 只过一个 0.6 增益（不过压限器）的峰值；与 `peak` 的差就是压限器吃掉的量 */
  gainOnlyPeak: number;
}

export interface SfxReport {
  sampleRate: number;
  measurements: SfxMeasurement[];
  errors: string[];
}

/**
 * 频谱重心，用一组对数分布的 Goertzel 探针估计。
 *
 * 不上完整 FFT：这里只要一个「亮不亮」的标量，48 个频点足够把玻璃碎裂
 * （几千赫兹）和开波号角（一两百赫兹）分到两端，代码量却只有十几行。
 */
function spectralCentroid(samples: Float32Array, sampleRate: number): number {
  const bins = 48;
  let weighted = 0;
  let total = 0;

  for (let b = 0; b < bins; b++) {
    const freq = 60 * Math.pow(8000 / 60, b / (bins - 1));
    const w = (2 * Math.PI * freq) / sampleRate;
    const coeff = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    // 必须逐采样：Goertzel 的系数是按 sampleRate 算的，跳采样等于把探针频率乘上跨步，
    // 还会把 6kHz 以上的碎玻璃分音混叠下来——冰碎的重心读数会在 700–2300Hz 之间乱跳
    for (let i = 0; i < samples.length; i++) {
      const s0 = samples[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = Math.abs(s1 * s1 + s2 * s2 - coeff * s1 * s2);
    weighted += freq * power;
    total += power;
  }
  return total > 0 ? weighted / total : 0;
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

/**
 * 音色绕开引擎总线渲染一遍，量音色本身写了多大。
 *
 * `bus` 给 'gain' 时只串一个 0.6 的增益（对照组），给 'none' 时直连 destination。
 * 两者与引擎读数三方对比，才能把「音色写轻了」「总音量」「压限器」分开定位。
 */
async function renderBypass(id: SfxId, bus: 'none' | 'gain'): Promise<number> {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * RENDER_SECONDS, SAMPLE_RATE);
  const noise = ctx.createBuffer(1, Math.floor(SAMPLE_RATE * 1.5), SAMPLE_RATE);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  let destination: AudioNode = ctx.destination;
  if (bus === 'gain') {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, 0);
    gain.connect(ctx.destination);
    destination = gain;
  }

  VOICES[id]({ ctx, destination, when: 0, intensity: 1, noise });
  return peakOf((await ctx.startRendering()).getChannelData(0));
}

async function renderOne(id: SfxId): Promise<SfxMeasurement> {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * RENDER_SECONDS, SAMPLE_RATE);
  // autoUnlock 关掉：离线上下文没有 suspended 状态，也没有手势可等
  const engine = new AudioEngine({ context: ctx, autoUnlock: false, masterVolume: 0.6 });
  engine.play({ id, intensity: 1 });

  const buffer = await ctx.startRendering();
  const samples = buffer.getChannelData(0);

  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    sumSquares += samples[i] * samples[i];
  }

  let last = 0;
  const floor = peak * 0.01;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i]) >= floor) {
      last = i;
      break;
    }
  }

  return {
    id,
    peak,
    rms: Math.sqrt(sumSquares / samples.length),
    durationSec: last / SAMPLE_RATE,
    centroidHz: spectralCentroid(samples, SAMPLE_RATE),
    rawPeak: await renderBypass(id, 'none'),
    gainOnlyPeak: await renderBypass(id, 'gain'),
  };
}

export async function renderAllSfx(): Promise<SfxReport> {
  const measurements: SfxMeasurement[] = [];
  const errors: string[] = [];

  for (const id of SFX_IDS) {
    try {
      measurements.push(await renderOne(id));
    } catch (error) {
      errors.push(`${id}: ${(error as Error).message}`);
    }
  }
  return { sampleRate: SAMPLE_RATE, measurements, errors };
}

function format(report: SfxReport): string {
  const rows = report.measurements.map(
    (m) =>
      `${m.id.padEnd(18)} 峰值 ${m.peak.toFixed(3)} (裸 ${m.rawPeak.toFixed(3)} / 仅增益 ${m.gainOnlyPeak.toFixed(3)})` +
      `  RMS ${m.rms.toFixed(4)}  时长 ${m.durationSec.toFixed(2)}s  重心 ${Math.round(m.centroidHz)}Hz`,
  );
  if (report.errors.length > 0) rows.push('', ...report.errors.map((e) => `ERROR ${e}`));
  return rows.join('\n');
}

const stage = document.getElementById('lw-stage');
if (stage) {
  void (async () => {
    // 合成器抛出来的任何东西都要被抓住并上报，不能只留在 devtools 里
    const errors: string[] = [];
    window.addEventListener('error', (event) => errors.push(String(event.message)));

    const report = await renderAllSfx();
    report.errors.push(...errors);

    const pre = document.createElement('pre');
    pre.id = 'lw-report';
    pre.style.cssText =
      'margin:0;padding:16px;font:12px/1.7 ui-monospace,Menlo,monospace;color:#bfe9f5';
    pre.textContent = format(report);
    stage.append(pre);
    document.body.dataset.probeReady = 'true';

    const post = new URLSearchParams(location.search).get('post');
    if (post) {
      void fetch(post, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      });
    }
  })();
}
