import { SFX_IDS, VOICES, type SfxId, type VoiceContext } from './voices';

/**
 * 事件音效播放器（GDD 16 / ARCHITECTURE §3「音频：原生 WebAudio」）。
 *
 * 只做四件事：解锁 autoplay、按 id 找音色、排程、别把自己吵爆。它不认识
 * 战斗事件——那是 `bridge.ts` 的活——所以换玩法、换事件源都不用动这里。
 *
 * ## 同帧
 *
 * `play()` 是同步的：进来就把节点排到 `ctx.currentTime` 上，不排队、不等下一帧。
 * 配合 `bridge.ts` 与粒子桥订阅同一条同步事件，「粒子 / 音效 / 顿帧同帧」
 * （VISUAL_BIBLE 10.1 验收，误差 ≤1 帧）就是构造上的事实而不是调出来的巧合。
 *
 * ## 没有声卡也要能跑
 *
 * 拿不到 `AudioContext`（node 自检、无音频设备）时整个类降级成计数器：
 * `play()` 照常返回 true 并记账，只是不出声。这样无头自检验证的是
 * 「事件有没有被翻译成音效」这件事，不需要一块声卡。
 */

export interface AudioEngineOptions {
  /** 注入上下文：自检传假的，生产不传（首次 `play`/`unlock` 时惰性创建）。 */
  context?: BaseAudioContext | null;
  /** 总音量 0..1。 */
  masterVolume?: number;
  /**
   * 自动挂 pointerdown/keydown 解锁 autoplay。默认开；
   * 没有 `window` 的环境（node）自动跳过。
   */
  autoUnlock?: boolean;
}

/** 一次发声请求。 */
export interface SfxCue {
  id: SfxId;
  /** 0..1 强弱，默认 0.6。 */
  intensity?: number;
  /**
   * 世界坐标 x（格）。给了就按棋盘中线做声像，让「左边那座塔响了」听得出来。
   * 不给就居中。
   */
  x?: number;
}

export interface AudioDiagnostics {
  available: boolean;
  unlocked: boolean;
  muted: boolean;
  /** 每个 id 实际发声的次数 */
  played: Record<SfxId, number>;
  /** 被节流挡下的次数；连锁冰碎会命中这里，是预期行为不是故障 */
  throttled: number;
  /** 最近一次发声的排程时刻（`ctx.currentTime` 坐标系） */
  lastScheduledAt: number;
}

/** 同一条音效两次发声的最小间隔（秒）。 */
const MIN_INTERVAL: Record<SfxId, number> = {
  // 一发冰碎带 1 格溅射，连坐的两三只会在同一帧各发一条信号。
  // 45ms 让第一下完整听见，后面的并成同一声「哗啦」，不叠成削波噪音。
  sfx_shatter_glass: 0.045,
  sfx_freeze: 0.06,
  sfx_build_place: 0.04,
  sfx_wave_start: 0.5,
};

/** 棋盘半宽（格）。声像按它归一化，越界的坐标会被夹到两端。 */
const BOARD_HALF_WIDTH = 10;

/** 声像最大偏移。满偏会让一发冰碎只剩一只耳朵听得到，读不出方位反而更差。 */
const MAX_PAN = 0.55;

const NOISE_SECONDS = 1.5;

function createContext(): BaseAudioContext | null {
  const Ctor =
    typeof globalThis.AudioContext === 'function'
      ? globalThis.AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  try {
    return new Ctor();
  } catch {
    // Safari 在没有用户手势时构造就抛；等第一次手势再来一遍
    return null;
  }
}

export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly masterVolume: number;
  private readonly autoUnlock: boolean;
  private readonly lazyContext: boolean;

  private muted = false;
  private lastPlayedAt: Record<SfxId, number>;
  private readonly counts: Record<SfxId, number>;
  private throttled = 0;
  private lastScheduledAt = 0;
  private detachUnlock: Array<() => void> = [];

  constructor(options: AudioEngineOptions = {}) {
    this.masterVolume = Math.min(Math.max(options.masterVolume ?? 0.6, 0), 1);
    this.autoUnlock = options.autoUnlock !== false;
    this.lazyContext = options.context === undefined;

    this.counts = Object.fromEntries(SFX_IDS.map((id) => [id, 0])) as Record<SfxId, number>;
    this.lastPlayedAt = Object.fromEntries(SFX_IDS.map((id) => [id, -Infinity])) as Record<
      SfxId,
      number
    >;

    if (options.context) this.adopt(options.context);
    if (this.autoUnlock) this.listenForGesture();
  }

  /** 有没有真的接上了 WebAudio；false 时 `play` 只记账。 */
  get available(): boolean {
    return this.ctx !== null;
  }

  get isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state !== 'suspended';
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * 解锁 autoplay。浏览器只认用户手势里发生的 `resume()`，所以这个方法
   * 要么由手势回调直接调用，要么靠构造时挂的一次性监听自动调用。
   */
  unlock(): void {
    if (!this.ctx && this.lazyContext) {
      const ctx = createContext();
      if (ctx) this.adopt(ctx);
    }
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended' && 'resume' in ctx) {
      void (ctx as AudioContext).resume().catch(() => {
        /* 用户还没给手势；下一次手势再试 */
      });
    }
  }

  /**
   * 立刻排一条音效。
   *
   * @returns 是否发声。false = 被同 id 的最小间隔挡下（`throttled` 会 +1）。
   */
  play(cue: SfxCue): boolean {
    const voice = VOICES[cue.id];
    if (!voice) return false;

    // 上下文还没建起来（首帧就有事件、或者玩家一次都还没点过）时，
    // 用真实时钟做节流判断，免得「解锁前的所有事件」一次性全过
    const now = this.ctx ? this.ctx.currentTime : performance.now() / 1000;
    if (now - this.lastPlayedAt[cue.id] < MIN_INTERVAL[cue.id]) {
      this.throttled++;
      return false;
    }
    this.lastPlayedAt[cue.id] = now;
    this.counts[cue.id]++;
    this.lastScheduledAt = now;

    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return true;

    voice({
      ctx,
      destination: this.pannerFor(cue.x, master),
      when: now,
      intensity: Math.min(Math.max(cue.intensity ?? 0.6, 0), 1),
      noise: this.noise as AudioBuffer,
    } satisfies VoiceContext);
    return true;
  }

  get diagnostics(): AudioDiagnostics {
    return {
      available: this.available,
      unlocked: this.isUnlocked,
      muted: this.muted,
      played: { ...this.counts },
      throttled: this.throttled,
      lastScheduledAt: this.lastScheduledAt,
    };
  }

  dispose(): void {
    for (const off of this.detachUnlock) off();
    this.detachUnlock = [];
    this.master?.disconnect();
    this.master = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && 'close' in ctx) {
      void (ctx as AudioContext).close().catch(() => {
        /* 已经关了 */
      });
    }
  }

  // -------------------------------------------------------------------------

  private adopt(ctx: BaseAudioContext): void {
    this.ctx = ctx;

    const limiter = this.buildLimiter(ctx);
    const master = ctx.createGain();
    master.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, ctx.currentTime);
    master.connect(limiter);
    limiter.connect(ctx.destination);
    this.master = master;

    this.noise = this.buildNoise(ctx);
  }

  /**
   * 总线末端的安全限幅。
   *
   * 四条音效同帧齐发（开波那一下就可能）时总和会越过 0dBFS，硬削波听起来像爆音。
   * 但这里**不能**用 `DynamicsCompressor`：它带包络检测器，对 1–2ms 起音的冲击音
   * 反应过度——离线实测同一条冰碎，只过 0.6 增益时峰值 0.384，过一遍压限器只剩
   * 0.085（-13dB），而信号本身还在阈值以下 8dB；开波那种 10ms 起音的长音却分毫未动。
   * 被吃掉的正好是「碎裂感」所在的那几毫秒，等于用听觉重演一遍 Bloom 糊白。
   *
   * 换成无状态的软削波：0.75 以下逐样本恒等，往上用 tanh 收进 1.0。没有检测器、
   * 没有时间常数，所以不区别对待瞬态；`WaveShaper` 又会把 ±1 以外的输入夹到曲线端点，
   * 顺带成了一道真正的硬顶。
   */
  private buildLimiter(ctx: BaseAudioContext): WaveShaperNode {
    const KNEE = 0.75;
    const SIZE = 1024;
    const curve = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
      const x = (i / (SIZE - 1)) * 2 - 1;
      const a = Math.abs(x);
      const shaped = a <= KNEE ? a : KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE));
      curve[i] = Math.sign(x) * shaped;
    }
    const shaper = ctx.createWaveShaper();
    shaper.curve = curve;
    return shaper;
  }

  /** 一段可复用的白噪声。所有噪声类音色共用，运行期零缓冲分配。 */
  private buildNoise(ctx: BaseAudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /**
   * 按格坐标做声像。没有 `StereoPannerNode`（老 Safari）就直接走总线——
   * 方位是加分项，不是玩法信息，不值得为它塞一条 `PannerNode` 的兼容路径。
   */
  private pannerFor(x: number | undefined, master: GainNode): AudioNode {
    const ctx = this.ctx;
    if (!ctx || x === undefined || typeof ctx.createStereoPanner !== 'function') return master;

    const panner = ctx.createStereoPanner();
    const normalized = (x - BOARD_HALF_WIDTH) / BOARD_HALF_WIDTH;
    panner.pan.setValueAtTime(
      Math.min(Math.max(normalized, -1), 1) * MAX_PAN,
      ctx.currentTime,
    );
    panner.connect(master);
    return panner;
  }

  private listenForGesture(): void {
    if (typeof window === 'undefined') return;
    const handler = (): void => this.unlock();
    for (const type of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(type, handler);
      this.detachUnlock.push(() => window.removeEventListener(type, handler));
    }
  }
}

export { SFX_IDS, type SfxId };
