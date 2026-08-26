# Last Watt VFX budget probe

无头预算治理探针。它包含两个互补部分：

1. 以 60Hz 确定性推进波 16–19 的需求模型，覆盖持续状态、攻击 burst、3 个同帧火场、12 座塔过载和全场大招。
2. 通过 Vite SSR 直接加载生产 `src/vfx/budget.ts#VfxBudget` 与 `src/vfx/GpuParticleSystem.ts#GpuParticleSystem`，把粒子写入真实 Three.js 环形池，并读取 `VfxBudget.snapshot`、`GpuParticleSystem.stats.alive` 和 `countAliveExact()`。

因此 JSON 中 `productionRuntime` 是真实生产计数器的无头契约验证；`peaks` / `waves` 是大潮需求与裁剪模型，两者不会混称为 GPU 渲染结果。

## 入口

```bash
# 报告写到 stdout
node games/last-watt/bench/run.mjs

# 落盘完整报告
node games/last-watt/bench/run.mjs \
  --out games/last-watt/bench/output/waves-16-19.report.json

# 输出空白报告模板
node games/last-watt/bench/run.mjs --template
```

默认场景在 `scenarios/waves-16-19.json`；`--help` 可查看预算覆盖参数。退出码为 `0` 表示所有硬预算通过，`1` 表示红线失败，`2` 表示输入或运行错误。

## 硬红线

| 指标 | 上限/要求 |
|---|---:|
| 活跃发射器 | 64 |
| 循环发射器 | 24 |
| 一次性发射器 | 40 |
| GPU 粒子 | 20,000 |
| 动态点光 | 8 |
| 受保护的事件/combo burst 丢弃 | 0 |
| 固定压测覆盖 | 波 16、17、18、19 |
| M3 同帧碰撞 | 3 火场 + 主控过载必须被接纳 |

同类循环发射器超过 10 个时粒子率减半；预算压力下先丢环境氛围，再降低非保护循环粒子率。第 9 盏起的点光转换为加法面片 fallback。

报告中的 `productionRuntime.renderedFrames` 固定为 `false`：真实粒子池会创建材质、几何和属性缓冲并执行发射/回收，但不会创建 WebGL context。`hostCpuDiagnostic` 也只衡量 Node 需求模型。1080p/60fps（16.67ms）最终红线仍必须在 WebGL 参照机（GTX 1060 / Steam Deck 级）采集；本探针不会把 Node 帧时冒充真实渲染帧时。
