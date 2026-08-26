# `src/audio` — 四条音效撑起来的听觉回执

> 上位文档：`docs/GDD-余电.md` 第 15/16 章、`games/last-watt/docs/VISUAL_BIBLE.md` 10.1。

M1 只要四条音效：**冰碎、冻结、建造、开波**。它们不是气氛，是回执——
VISUAL_BIBLE 10.1 的验收原文是「关画面仅听声音也能确认碎裂发生」。

一个音频文件都不带。GDD 18.2 的零资产纪律同样管声音：粒子图集是运行时画的，
音色也是运行时合成的。

## 一句话架构

**`bridge.ts` 认识战斗事件，`AudioEngine` 认识 WebAudio，`voices.ts` 认识音色，
三者互不知情。** 换玩法只动 bridge，换成正式采样只动 voices，两边都不碰引擎。

| 文件 | 职责 |
|---|---|
| `voices.ts` | 四条音效的合成图。**唯一写死频率与包络的地方** |
| `AudioEngine.ts` | 解锁 autoplay、排程、节流、声像、静音、软削波总线 |
| `bridge.ts` | 事件 → 音效的绑定表。本模块唯一认识战斗/玩法事件的文件 |
| `headlessContext.ts` | `AudioContext` 替身，记录节点与参数自动化，供无头自检 |
| `selfcheck.ts` | 无头自检，9 项断言，不需要声卡 |
| `demo/` | `OfflineAudioContext` 离线渲染探针，量真实波形 |

## 「与粒子同帧」是怎么保证的

本模块的桥与 `vfx/combatBridge.ts` 订阅的是**同一个** `combat.bus` 上的同一条信号。
`CombatEventBus.emit` 是同步的：一次 emit 在同一个调用栈里依次通知两个订阅者，
中间没有 rAF、没有 setTimeout、没有队列。`AudioEngine.play()` 也是同步的，
进来就把节点排到 `ctx.currentTime` 上。

所以粒子的 `emit` 与音效的 `play` 落在同一个固定步长 tick 上——
**误差是 0 帧，而不是「调到 ≤1 帧」**。自检里「同帧」一条在 `endFrame()` 之前
同时断言粒子数、发声数与顿帧状态，任何人往中间插一个队列都会当场红。

## 总线末端为什么不是 `DynamicsCompressor`

四条音效同帧齐发时总和会越过 0dBFS，需要一道保护。直觉选择是压限器，但它有检测器，
对 1–2ms 起音的冲击音反应过度。离线实测同一条冰碎：

| 路径 | 峰值 |
|---|---|
| 音色裸输出 | 0.566 |
| 只过 0.6 增益 | 0.384 |
| 过 `DynamicsCompressor` | **0.085** |

信号本身还在阈值以下 8dB，却被吃掉 13dB；而开波那种 10ms 起音的长音分毫未动
（0.138 → 0.144）。被吃掉的正好是「碎裂感」所在的那几毫秒——**等于用听觉重演一遍
Bloom 糊白**：一个不分青红皂白的「保护」把信息量最大的瞬态抹平了。

换成 `WaveShaper` 软削波：0.75 以下逐样本恒等，往上用 tanh 收进 1.0。
无状态、无时间常数，所以不区别对待瞬态；`WaveShaper` 又会把 ±1 以外的输入夹到
曲线端点，顺带成了一道真正的硬顶。

顺带一提，`DynamicsCompressor` 的 `knee` 默认 **30dB**——软拐点从 `threshold - 15dB`
就开始。谁要是把它加回来，记得这不是「阈值以上才动」的东西。

## 接入

```ts
const audio = new AudioEngine();
const bridge = connectGameAudio({
  combat: game.combat.bus,
  gameplay: game.session.events,
  audio,
});
// 拆装时：bridge.detach(); audio.dispose();
```

`AudioContext` 是**惰性创建**的，首次用户手势（pointerdown / keydown）自动解锁，
构造时不碰音频设备。拿不到 `AudioContext`（node 自检、无音频设备）时整个类降级成
计数器：`play()` 照常返回 true 并记账，只是不出声。所以无头自检验证的是
「事件有没有被翻译成音效」，不需要一块声卡。

切片里 `M` 键静音（`src/main.ts`）。静音走 master gain 归零而不是跳过记账，
诊断数据在静音时照样准。

## 节流

同一条音效有最小间隔（冰碎 45ms、冻结 60ms、建造 40ms、开波 500ms）。
一发冰碎带 1 格溅射，连坐的两三只会在同一帧各发一条信号——45ms 让第一下完整听见，
后面的并成同一声「哗啦」，而不是三份同相波形叠出一记削波噪音。
**跨 id 不互相挡**：建造被冰碎的窗口吃掉会让操作失去回执。

## 验证

```bash
npm run selfcheck:audio   # 无头自检：9 项，不需要声卡，可进 CI
node src/audio/demo/sfx.probe.mjs   # 离线渲染真波形，需要 Chrome
```

替身自检只能证明「节点搭出来了」，证不了「合成器接受这张图」——一个非法的
`exponentialRampToValueAtTime(0, t)`、一个拼错的滤波器类型，在替身上一路绿灯，
在真浏览器里是一次抛异常加一片寂静。所以另有一页用 `OfflineAudioContext`
真渲染四条音效（不需要声卡，无头 Chrome 里照跑），量峰值 / RMS / 时长 / 频谱重心：

```
sfx_shatter_glass  峰值 0.397  RMS 0.0139  时长 0.18s  重心 3579Hz
sfx_freeze         峰值 0.153  RMS 0.0151  时长 0.24s  重心  386Hz
sfx_build_place    峰值 0.201  RMS 0.0138  时长 0.09s  重心  144Hz
sfx_wave_start     峰值 0.138  RMS 0.0203  时长 0.41s  重心  117Hz
```

判定钉住的是「关画面能不能听出是碎裂」：冰碎必须是重心最高的一条，
且比开波亮 3 倍以上；四条都出声、都不削波、都留足响度（峰值 > 0.12）。
每条同时给「裸 / 仅增益 / 过总线」三个峰值，一眼分得清「音色写轻了」
还是「总线压过头了」——上面那张压限器表就是这么读出来的。

## 已知边界

- **`sfx_build_place` 兼职工程完工**。M1 只有四条音效，与其为挖沟/搭桥新开一条，
  不如让玩家学会「这个声音 = 我刚改了地形或放了东西」。
- **解冻不出声**。`frozen` 事件的 `end` 相位被桥滤掉：冰壳消失是视觉信息，
  再给一声会让人以为又冻上了。
- **没有音乐、没有环境层、没有音量设置面板**，只有 `M` 静音。
- 声像最大偏移 0.55。满偏会让一发冰碎只剩一只耳朵听得到，读不出方位反而更差。
