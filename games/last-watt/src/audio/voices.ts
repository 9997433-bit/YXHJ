/**
 * 程序化音色。
 *
 * 《余电》M1 一个音频文件都不带（GDD 18.2 的资产纪律同样管声音：图集是
 * 运行时画的，音色也是运行时合成的）。四条 M1 音效各是一小段 WebAudio 图，
 * 参数写在这里，换成正式采样时只要把 `VOICES` 换掉，事件 id 与调用点不动。
 *
 * 共同的写法约定：
 * - 一切都按**绝对时间**排程（`when` 是 `ctx.currentTime` 坐标系里的秒），
 *   调用方给什么时刻就在什么时刻响，不受 JS 事件循环抖动影响；
 * - 每个节点自带 `stop()`，靠 WebAudio 自己回收，不留常驻节点；
 * - 包络一律「线性起、指数落」，指数段收到 1e-4 而不是 0（指数 ramp 到 0 是非法值）。
 */

export interface VoiceContext {
  ctx: BaseAudioContext;
  /** 声音接到哪里；调用方通常给一个已经做好声像与总音量的节点 */
  destination: AudioNode;
  /** 起始时刻，`ctx.currentTime` 坐标系 */
  when: number;
  /** 0..1 的强弱，同一个事件不同规模用它区分 */
  intensity: number;
  /** 预生成的白噪声，所有噪声类音色共用一段，避免每次发声都分配缓冲 */
  noise: AudioBuffer;
}

/** 一次性节点在播完后自己拆链，省得攒出一条越来越长的图。 */
function autoRelease(node: AudioScheduledSourceNode, chain: AudioNode[]): void {
  node.onended = () => {
    node.disconnect();
    for (const link of chain) link.disconnect();
  };
}

interface EnvelopeOptions {
  start: number;
  duration: number;
  peak: number;
  /** 起音时长，默认 2ms —— 冲击类音色要的就是「一上来就到顶」 */
  attack?: number;
}

function envelope(ctx: BaseAudioContext, options: EnvelopeOptions): GainNode {
  const gain = ctx.createGain();
  const attack = Math.max(options.attack ?? 0.002, 0.0005);
  const peak = Math.max(options.peak, 1e-4);
  gain.gain.setValueAtTime(0.0001, options.start);
  gain.gain.linearRampToValueAtTime(peak, options.start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, options.start + options.duration);
  return gain;
}

interface NoiseOptions extends EnvelopeOptions {
  filter?: {
    type: BiquadFilterType;
    /** 恒定频率，或者一段扫频 [起, 止] */
    frequency: number | [number, number];
    q?: number;
  };
}

/** 一段带包络的噪声，可选串一个滤波器（或扫频滤波器）。 */
function noiseBurst(voice: VoiceContext, options: NoiseOptions): void {
  const { ctx } = voice;
  const source = ctx.createBufferSource();
  source.buffer = voice.noise;
  // 每次从缓冲的不同位置起播，连发时不会听出同一段噪声在循环
  const offset = Math.random() * Math.max(voice.noise.duration - options.duration - 0.05, 0);

  const gain = envelope(ctx, options);
  const chain: AudioNode[] = [gain];

  let head: AudioNode = gain;
  if (options.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = options.filter.type;
    if (options.filter.q !== undefined) filter.Q.setValueAtTime(options.filter.q, options.start);
    if (Array.isArray(options.filter.frequency)) {
      const [from, to] = options.filter.frequency;
      filter.frequency.setValueAtTime(from, options.start);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(to, 20),
        options.start + options.duration,
      );
    } else {
      filter.frequency.setValueAtTime(options.filter.frequency, options.start);
    }
    filter.connect(gain);
    chain.push(filter);
    head = filter;
  }

  source.connect(head);
  gain.connect(voice.destination);
  source.start(options.start, offset, options.duration + 0.02);
  source.stop(options.start + options.duration + 0.02);
  autoRelease(source, chain);
}

interface ToneOptions extends EnvelopeOptions {
  type: OscillatorType;
  /** 恒定音高，或者一段滑音 [起, 止] */
  frequency: number | [number, number];
  lowpass?: number;
}

function tone(voice: VoiceContext, options: ToneOptions): void {
  const { ctx } = voice;
  const osc = ctx.createOscillator();
  osc.type = options.type;
  if (Array.isArray(options.frequency)) {
    const [from, to] = options.frequency;
    osc.frequency.setValueAtTime(from, options.start);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(to, 20),
      options.start + options.duration,
    );
  } else {
    osc.frequency.setValueAtTime(options.frequency, options.start);
  }

  const gain = envelope(ctx, options);
  const chain: AudioNode[] = [gain];
  let head: AudioNode = gain;
  if (options.lowpass !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(options.lowpass, options.start);
    filter.connect(gain);
    chain.push(filter);
    head = filter;
  }

  osc.connect(head);
  gain.connect(voice.destination);
  osc.start(options.start);
  osc.stop(options.start + options.duration + 0.02);
  autoRelease(osc, chain);
}

// ---------------------------------------------------------------------------
// 四条 M1 音效
// ---------------------------------------------------------------------------

/**
 * 冰碎「咔嚓」（`sfx_shatter_glass`，GDD 15.2 / VISUAL_BIBLE 10.1）。
 *
 * 验收原文是「关画面仅听声音也能确认碎裂发生」，所以它必须是全场最锐的一下，
 * 而且要能和别的音效在半秒内区分开。三段叠出来：
 * 1. 2ms 起音的高通噪声 —— 玻璃裂开那一下的爆点；
 * 2. 五个不成谐波关系的高频分音 —— 「一堆碎片」而不是「一个音」，
 *    刻意避开整数倍频率，不然会听成钟或者三角铁；
 * 3. 380ms 的带通噪声尾 —— 碎片落地的余韵，也是「碎裂」区别于「命中」的关键。
 */
function shatterGlass(voice: VoiceContext): void {
  const t = voice.when;
  const power = 0.5 + voice.intensity * 0.5;

  noiseBurst(voice, {
    start: t,
    duration: 0.05,
    peak: 0.5 * power,
    attack: 0.001,
    filter: { type: 'highpass', frequency: 2600 },
  });

  const partials = [2450, 3170, 3980, 5290, 6710];
  for (let i = 0; i < partials.length; i++) {
    tone(voice, {
      type: 'triangle',
      // 每片碎片自己往下掉一点音高：一起下滑才像「一把碎片同时炸开」
      frequency: [partials[i], partials[i] * 0.82],
      start: t + i * 0.004,
      duration: 0.16 + i * 0.035,
      peak: (0.15 - i * 0.018) * power,
      attack: 0.001,
    });
  }

  noiseBurst(voice, {
    start: t + 0.03,
    duration: 0.38,
    peak: 0.16 * power,
    attack: 0.01,
    filter: { type: 'bandpass', frequency: [3200, 1500], q: 1.1 },
  });
}

/**
 * 冻结（`sfx_freeze`）。
 *
 * 语义是「被封住」，不是「被冻伤」：一条向下的滑音把目标压住，
 * 一段向上的扫频噪声画出冰壳成型，最后一记高音铃盖章。
 * 音区刻意全部避开冰碎的 2.4–6.7kHz，两者同帧出现时才不会糊成一团。
 */
function freeze(voice: VoiceContext): void {
  const t = voice.when;
  const power = 0.55 + voice.intensity * 0.45;

  tone(voice, {
    type: 'sine',
    frequency: [420, 148],
    start: t,
    duration: 0.3,
    peak: 0.26 * power,
    attack: 0.006,
  });

  noiseBurst(voice, {
    start: t,
    duration: 0.32,
    peak: 0.1 * power,
    attack: 0.05,
    filter: { type: 'bandpass', frequency: [900, 2600], q: 2.2 },
  });

  tone(voice, {
    type: 'sine',
    frequency: 1760,
    start: t + 0.04,
    duration: 0.34,
    peak: 0.055 * power,
    attack: 0.05,
  });
}

/**
 * 放置建筑（`sfx_build_place`）。
 *
 * 一记压实的低频砸地 + 一记金属卡扣。它同时是「命令被接受了」的唯一听觉回执，
 * 所以要短、要干，不能有尾巴——尾巴会让连放两座塔听起来像一座。
 */
function buildPlace(voice: VoiceContext): void {
  const t = voice.when;

  tone(voice, {
    type: 'sine',
    frequency: [150, 62],
    start: t,
    duration: 0.16,
    peak: 0.34,
    attack: 0.002,
  });

  noiseBurst(voice, {
    start: t,
    duration: 0.05,
    peak: 0.2,
    attack: 0.001,
    filter: { type: 'bandpass', frequency: 1500, q: 2.6 },
  });

  tone(voice, {
    type: 'square',
    frequency: [330, 300],
    start: t + 0.012,
    duration: 0.07,
    peak: 0.075,
    attack: 0.001,
    lowpass: 2200,
  });
}

/**
 * 开波（`sfx_wave_start`）。
 *
 * 废土电厂的告警号，不是胜利音效：两声低沉的方波经低通削掉毛刺，
 * 底下垫一记 55Hz 的下沉。它要盖过战场噪音让人抬头，但不能欢快。
 */
function waveStart(voice: VoiceContext): void {
  const t = voice.when;

  tone(voice, {
    type: 'square',
    frequency: 196,
    start: t,
    duration: 0.17,
    peak: 0.17,
    attack: 0.01,
    lowpass: 1100,
  });
  tone(voice, {
    type: 'square',
    frequency: 262,
    start: t + 0.22,
    duration: 0.3,
    peak: 0.17,
    attack: 0.01,
    lowpass: 1100,
  });
  tone(voice, {
    type: 'sine',
    frequency: [72, 46],
    start: t,
    duration: 0.55,
    peak: 0.16,
    attack: 0.03,
  });
}

/**
 * 事件音效表。
 *
 * 键名就是 `combat` 反应行 `ImpactSpec.sfx` 里冻结的 id（INTEGRATION.md §3.8）。
 * 等 `data/audio-events.json` 建起来之后，这张表退化成「id → 合成函数」的绑定，
 * 音量、节流这些数值搬去 JSON；在那之前它是唯一真源。
 */
export const VOICES = {
  sfx_shatter_glass: shatterGlass,
  sfx_freeze: freeze,
  sfx_build_place: buildPlace,
  sfx_wave_start: waveStart,
} as const satisfies Record<string, (voice: VoiceContext) => void>;

export type SfxId = keyof typeof VOICES;

export const SFX_IDS = Object.keys(VOICES) as SfxId[];
