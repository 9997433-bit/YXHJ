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

#### R1-F4 回报（M1 验收清单，已交付）

- 交付物：`games/last-watt/docs/ACCEPTANCE.md`（依据 GDD 第 19–20 章 + 本表共享约束）
- 验收条目：**33 条** = 玩法 11（G）/ 视觉 6（V）/ 性能 4（P）/ 范围锁 7（S）/ 目录隔离与工程卫生 5（I）；除 P-03 为记录项外全部为硬门槛
- 一票否决红线：G-09 教学（<4/5 过波 5 重做节拍、禁加文字糊）、V-03 事件粒子永不降级、S-01/S-03/S-05 范围回潮、S-07 GDD 零 diff
- 建议自动化：**29 条**（全自动 20 + 半自动 9）。落位：R1-G1 `tests/**` 承接规则/回放/状态机/埋点 15 条；R1-G2 `bench/**` 承接帧时/粒子/内存 6 条；git/grep/lint 审计脚本承接 8 条
- 纯人工 4 条：G-09 教学试玩、V-01 非扁平观感、V-05 供断电可读性、S-03 combo 范围审计
- 已为性能项定死参照机裁决（4 核 + Iris Xe 档核显 @1080p），后续里程碑沿用

### Round 2

- 状态：未开始

### Round 3

- 状态：未开始
