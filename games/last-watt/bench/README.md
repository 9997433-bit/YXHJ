# Last Watt VFX budget probe

无头预算治理探针。它包含两个互补部分：

1. 从 `data/waves.map1.json` 读取图 1 波 10 的规范出怪剖面，以 60Hz 确定性推进 M1 大潮需求模型，并在固定压力帧触发 6 次冰碎。
2. 通过 Vite SSR 直接加载生产 `src/vfx`：先预热 8 个真实冷凝雾循环，再让 6 套完整冰碎在同一帧进入真实 Three.js 环形池，读取粒子、发射器、贴花和顿帧节流计数。

因此 JSON 中 `productionRuntime.observations.wave10SameFrameShatters` 是真实生产计数器的无头剖面；`peaks` / `waves` 是波 10 大潮需求与裁剪模型，两者不会混称为 GPU 渲染结果。

## 入口

```bash
# 报告写到 stdout
node games/last-watt/bench/run.mjs

# 落盘完整报告
node games/last-watt/bench/run.mjs \
  --out games/last-watt/bench/output/wave-10-shatter.production.report.json

# 输出空白报告模板
node games/last-watt/bench/run.mjs --template
```

默认场景在 `scenarios/wave-10-shatter.json`；`--help` 可查看预算覆盖参数。退出码为 `0` 表示所有硬预算通过，`1` 表示红线失败，`2` 表示输入或运行错误。

## 硬红线

| 指标 | 上限/要求 |
|---|---:|
| 活跃发射器 | 64 |
| 循环发射器 | 24 |
| 一次性发射器 | 40 |
| GPU 粒子 | 20,000 |
| 动态点光 | 8 |
| 受保护的事件/combo burst 丢弃 | 0 |
| 固定压测覆盖 | 仅波 10；规范数据为 4 组、26 敌人 |
| M1 同帧碰撞 | 6 次冰碎全部接纳，保护粒子零丢弃 |
| 冰碎顿帧节流 | 同帧 6 次请求只接受 1 次，拒绝 5 次 |

同类循环发射器超过 10 个时粒子率减半；预算压力下先丢环境氛围，再降低非保护循环粒子率。第 9 盏起的点光转换为加法面片 fallback。

报告中的 `productionRuntime.renderedFrames` 固定为 `false`：真实粒子池会创建材质、几何和属性缓冲并执行发射/回收，但不会创建 WebGL context。`hostCpuDiagnostic` 也只衡量 Node 需求模型。1080p/60fps（16.67ms）最终红线仍必须在 WebGL 参照机（4 核 + Iris Xe 档核显）采集；本探针不会把 Node 帧时冒充真实渲染帧时。
