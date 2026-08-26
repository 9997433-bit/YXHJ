# 《余电》Last Watt — 多智能体进度

- **隔离分支**：`agent/last-watt`
- **游戏根目录**：`games/last-watt/`（工作区根目录还会放其他游戏，禁止污染仓库根或 `docs/` 以外的共享位）
- **设计正文**：`docs/GDD-余电.md`（v1 已锁定）
- **视觉参考**：`docs/premium-game-visual-prompts.md`（仓库中尚不存在，Round 1 必须由 fable 视觉组按 GDD 第 15 章 + SOTA 3A/独立精品观感补齐）
- **循环**：Round 1 / 2 / 3，每轮 10 云端子代理（4 fable + 4 opus-fast + 2 gpt-sol）
- **当前轮次**：Round 1 — 初始构建与基线探索
- **v1 范围锁**：无战斗英雄；老周仅电台；4 combo + 双资源 + 改路 + 大招 + 丢区

## 模型映射（禁止静默降级）

| 简称 | 实际 slug | 本轮数量 |
|---|---|---|
| fable | `claude-fable-5-thinking-xhigh` | 4 |
| opus-fast | `claude-opus-5-thinking-high-fast` | 4 |
| gpt-sol | `gpt-5.6-sol-xhigh-fast` | 2 |

每个子代理最终输出**首行必须**为：`MODEL_SLUG: <实际使用的 slug>`

## Round 1 派工（路径隔离，禁止互相覆盖）

| ID | 模型 | 独占路径 | 目标 |
|---|---|---|---|
| R1-F1 | fable | `games/last-watt/docs/ARCHITECTURE.md` | 工程架构、模块边界、目录公约、引擎/运行时裁决 |
| R1-F2 | fable | `docs/premium-game-visual-prompts.md` + `games/last-watt/docs/VISUAL_BIBLE.md` | 补齐精品视觉提示词与项目视觉圣经 |
| R1-F3 | fable | `games/last-watt/docs/SYSTEMS.md` + `games/last-watt/data/**` | 把 GDD 收成可实现系统说明 + 配表初稿 |
| R1-F4 | fable | `games/last-watt/docs/ACCEPTANCE.md` | M1 SOTA 验收清单与审计标准 |
| R1-O1 | opus-fast | `games/last-watt/src/engine/**` + 根构建文件 | 可运行脚手架（优先 WebGL/Three.js，Unity 不可用时不得空转） |
| R1-O2 | opus-fast | `games/last-watt/src/gameplay/**` | 网格、寻路、波次、地形改造 |
| R1-O3 | opus-fast | `games/last-watt/src/combat/**` | 塔、敌人、状态反应（至少冰碎可跑） |
| R1-O4 | opus-fast | `games/last-watt/src/vfx/**` + `games/last-watt/src/ui/**` | GPU 粒子战场语言 + 最小 HUD |
| R1-G1 | gpt-sol | `games/last-watt/tests/**` | 自动化探针、单测、边界用例 |
| R1-G2 | gpt-sol | `games/last-watt/bench/**` | 粒子/帧时预算脚本与 Mock 压测 |

## 共享约束

- 只改 `games/last-watt/**`、`.agent_workspace/**`，以及 F2 独占的 `docs/premium-game-visual-prompts.md`。
- 不要改 `docs/GDD-余电.md` 的已锁裁决。
- M1 目标：灰盒图 1 前若干波可玩；机枪/焦油/冷凝/破碎锤 + 发电机；电力双层；冰碎完整反馈；挖沟。
- 画面不得是「扁平 2D 贴图塔防」；粒子是玩法语言。
- 子代理在各自云端分支工作，完成后由主调度合并。

## 轮次记录

### Round 1

- 状态：已派发，等待 10 个云端子代理回传
- 结论简报：待写

### Round 2

- 状态：未开始

### Round 3

- 状态：未开始
