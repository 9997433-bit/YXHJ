# Last Watt VFX budget probe

纯 Node、零依赖的预算治理探针。它以 60Hz 确定性推进波 16–19，模拟持续状态、攻击 burst、3 个同帧火场、12 座塔过载和全场大招，检查粒子、发射器与动态点光的运行时裁剪策略。

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

报告中的 `hostCpuDiagnostic` 只衡量 Node 预算控制器，不做 GPU 渲染。GDD 的 1080p/60fps（16.67ms）最终红线仍必须在 Unity URP、GTX 1060 / Steam Deck 级参照机上采集；本探针不会把 mock 的 Node 帧时冒充真实渲染帧时。
