/**
 * 无头 WebAudio 替身。
 *
 * node 没有 `AudioContext`，但「事件有没有翻译成音效、排在了什么时刻、
 * 用了哪些节点」这些恰恰是最该进 CI 的部分——它们出错时人耳只会听到
 * 「好像少了一声」，很难当场定位。
 *
 * 这个替身不合成任何采样，只记账：每个节点、每次排程、每条参数自动化都留痕，
 * 自检据此断言音色确实被搭出来了、时刻确实落在这一帧。
 * 它只实现 `voices.ts` 真正用到的那部分接口——刻意不做全量 polyfill，
 * 免得把一个测试替身养成第二套 WebAudio 实现。
 */

export interface RecordedNode {
  kind: string;
  /** 排程过的开始/结束时刻，源节点才有 */
  startedAt?: number;
  stoppedAt?: number;
  /** 参数自动化留痕：`gain.setValueAtTime(0.3, 1.25)` → `gain@1.25=0.3` */
  automation: string[];
}

export interface HeadlessAudioLog {
  nodes: RecordedNode[];
  /** 源节点（振荡器 / 采样源）的启动时刻，判「同帧」用 */
  starts: number[];
}

class FakeParam {
  constructor(
    private readonly node: RecordedNode,
    private readonly name: string,
  ) {}

  setValueAtTime(value: number, time: number): this {
    this.node.automation.push(`${this.name}@${time.toFixed(4)}=${value}`);
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.node.automation.push(`${this.name}~lin@${time.toFixed(4)}=${value}`);
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.node.automation.push(`${this.name}~exp@${time.toFixed(4)}=${value}`);
    return this;
  }
}

class FakeNode {
  readonly record: RecordedNode;

  constructor(
    kind: string,
    private readonly log: HeadlessAudioLog,
  ) {
    this.record = { kind, automation: [] };
    log.nodes.push(this.record);
  }

  connect<T>(target: T): T {
    return target;
  }

  disconnect(): void {
    /* 记账替身没有真实连线要拆 */
  }

  protected param(name: string): FakeParam {
    return new FakeParam(this.record, name);
  }
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;

  start(when = 0): void {
    this.record.startedAt = when;
    this.logRef.starts.push(when);
  }

  stop(when = 0): void {
    this.record.stoppedAt = when;
  }

  constructor(
    kind: string,
    private readonly logRef: HeadlessAudioLog,
  ) {
    super(kind, logRef);
  }
}

/**
 * @returns 一个能喂给 `new AudioEngine({ context })` 的替身，外加它的记账本。
 *
 * 返回值故意经过 `as unknown as BaseAudioContext`：生产代码按真接口写，
 * 替身只覆盖用到的那一小块，两边都不为对方让步。
 */
export function createHeadlessAudioContext(sampleRate = 48000): {
  context: BaseAudioContext;
  log: HeadlessAudioLog;
  /** 手动推进时钟，用来验证节流窗口 */
  advance(seconds: number): void;
} {
  const log: HeadlessAudioLog = { nodes: [], starts: [] };
  let currentTime = 0;

  const context = {
    sampleRate,
    state: 'running' as AudioContextState,
    get currentTime() {
      return currentTime;
    },
    destination: { connect: () => undefined, disconnect: () => undefined },
    createGain() {
      const node = new FakeNode('gain', log) as FakeNode & { gain: FakeParam };
      node.gain = new FakeParam(node.record, 'gain');
      return node;
    },
    createOscillator() {
      const node = new FakeSource('oscillator', log) as FakeSource & {
        type: string;
        frequency: FakeParam;
      };
      node.type = 'sine';
      node.frequency = new FakeParam(node.record, 'frequency');
      return node;
    },
    createBiquadFilter() {
      const node = new FakeNode('biquad', log) as FakeNode & {
        type: string;
        frequency: FakeParam;
        Q: FakeParam;
      };
      node.type = 'lowpass';
      node.frequency = new FakeParam(node.record, 'frequency');
      node.Q = new FakeParam(node.record, 'Q');
      return node;
    },
    createBufferSource() {
      const node = new FakeSource('buffer-source', log) as FakeSource & {
        buffer: unknown;
        playbackRate: FakeParam;
      };
      node.buffer = null;
      node.playbackRate = new FakeParam(node.record, 'playbackRate');
      return node;
    },
    createDynamicsCompressor() {
      const node = new FakeNode('compressor', log) as FakeNode & Record<string, unknown>;
      for (const name of ['threshold', 'ratio', 'attack', 'release', 'knee']) {
        node[name] = new FakeParam(node.record, name);
      }
      return node;
    },
    createWaveShaper() {
      const node = new FakeNode('waveshaper', log) as FakeNode & {
        curve: Float32Array | null;
        oversample: string;
      };
      node.curve = null;
      node.oversample = 'none';
      return node;
    },
    createStereoPanner() {
      const node = new FakeNode('panner', log) as FakeNode & { pan: FakeParam };
      node.pan = new FakeParam(node.record, 'pan');
      return node;
    },
    createBuffer(channels: number, length: number, rate: number) {
      const data = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        duration: length / rate,
        getChannelData: () => data,
      };
    },
  } as unknown as BaseAudioContext;

  return {
    context,
    log,
    advance(seconds: number) {
      currentTime += seconds;
    },
  };
}
