# 《余电》Last Watt — 多智能体进度

- **隔离分支**：`agent/last-watt`
- **游戏根目录**：`games/last-watt/`（工作区根目录还会放其他游戏，禁止污染仓库根或 `docs/` 以外的共享位）
- **设计正文**：`docs/GDD-余电.md`（v1 已锁定）
- **视觉参考**：`docs/premium-game-visual-prompts.md` + `games/last-watt/docs/VISUAL_BIBLE.md`（Round 1 已补齐）
- **循环**：Round 1 / 2 / 3，每轮 10 子代理（4 fable + 4 opus-fast + 2 gpt-sol）；云端新 VM 并发上限 3，溢出走本地共享工作区
- **当前轮次**：Round 2 — 靶向重构与深度优化
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

- 状态：10/10 完成；云端分支 `cursor/last-watt-probes-b6bf`、`cursor/r1-f1-architecture-cc81` 已合并进 `agent/last-watt`

#### Round 1 结论简报（主调度）

**已实现**
- 文档：架构 / 视觉圣经 / 系统配表 / 33 条 M1 验收
- 引擎：Vite + Three.js WebGL2，斜俯视、锈铁网格、Bloom 只吃自发光，可 `npm run dev`
- 玩法：20×12 网格、flow field、挖沟搭桥合法性、图 1 波次导入
- 战斗：反应表驱动 4 combo，冰碎全链路，塔/敌/超载/Boss 阶段
- 粒子：GPU 点精灵 + 节流 + Gym 13/13；HUD 自发光条
- 测试：G1 mock 12/12；G2 预算 mock PASS；VFX 无头自检 13/13

**遗留缺陷**
- 四模块未串成一局可玩主循环（点格造塔→出怪→冰碎粒子）
- 敌人 ID 三套并存（JSON / combat TS / 别名表）
- 时钟立法冲突：架构 30Hz vs 引擎 60Hz
- 粒子 Bloom 靠锁材质绕过引擎 mask pass；顿帧需引擎吃 `vfx.timeScale`
- G1 测试仍打 mock，未接真实 `CombatSystem` / gameplay
- GDD 起始 220 金 vs「恰好够 2 座」未拍板

**性能瓶颈**
- 尚无真机 1080p 60fps；仅 mock/SwiftShader。Bloom 双 pass + 2 万粒子未在参照机验证。

**主调度已拍板（Round 2 必须遵守）**
1. M1/M2 发布栈 = WebGL；Unity 不在本循环开工。
2. 逻辑时钟 **60Hz**（与现引擎一致）；时长向上取整到 tick。
3. 规范 ID = `games/last-watt/data/*.json`；代码只许别名指向 JSON，R2 删战斗侧私有主键。
4. 起始金币维持 **220**；教学「两座机枪」靠高亮格，不靠掏空钱包。
5. Round 2 第一优先级：可玩垂直切片，而不是再写平行文档。

**下轮攻坚**
- 主循环接线；统一 ID；测试改打真模块；Bloom skip 正式接口；冰碎事件→VFX；对照 ACCEPTANCE 消缺口。

### Round 2 派工

| ID | 模型 | 主攻 |
|---|---|---|
| R2-F1 | fable | 整合契约：ID 注册表、60Hz、主循环接口，写入 `docs/INTEGRATION.md` |
| R2-F2 | fable | 对照 VISUAL_BIBLE 审计现实现，列出必须修的观感债 |
| R2-F3 | fable | 配表与代码 ID 对齐，改 JSON/SYSTEMS 交叉引用 |
| R2-F4 | fable | 按 ACCEPTANCE 标出现状红/黄/绿 |
| R2-O1 | opus-fast | 主循环：engine+gameplay+combat+vfx+ui 可玩 |
| R2-O2 | opus-fast | 玩法接战斗（占格、炸桥、完整度、第二口） |
| R2-O3 | opus-fast | 战斗改用 JSON id；向 VFX 发事件 |
| R2-O4 | opus-fast | 引擎 skipBloomMask；timeScale 顿帧；冰碎实接 |
| R2-G1 | gpt-sol | 测试改打真实模块，保留 mock 作对照 |
| R2-G2 | gpt-sol | bench 接 VfxGovernor 真计数 |

#### R1-F4 回报（M1 验收清单，已交付）

- 交付物：`games/last-watt/docs/ACCEPTANCE.md`（依据 GDD 第 19–20 章 + 本表共享约束）
- 验收条目：**33 条** = 玩法 11（G）/ 视觉 6（V）/ 性能 4（P）/ 范围锁 7（S）/ 目录隔离与工程卫生 5（I）；除 P-03 为记录项外全部为硬门槛
- 一票否决红线：G-09 教学（<4/5 过波 5 重做节拍、禁加文字糊）、V-03 事件粒子永不降级、S-01/S-03/S-05 范围回潮、S-07 GDD 零 diff
- 建议自动化：**29 条**（全自动 20 + 半自动 9）。落位：R1-G1 `tests/**` 承接规则/回放/状态机/埋点 15 条；R1-G2 `bench/**` 承接帧时/粒子/内存 6 条；git/grep/lint 审计脚本承接 8 条
- 纯人工 4 条：G-09 教学试玩、V-01 非扁平观感、V-05 供断电可读性、S-03 combo 范围审计
- 已为性能项定死参照机裁决（4 核 + Iris Xe 档核显 @1080p），后续里程碑沿用

### Round 2

- 状态：进行中

#### R2-O1 回报（主循环：可玩灰盒切片，已交付）

- 交付物：`games/last-watt/src/main.ts` + `src/app/**`（接线层，只有这一层同时认识五个模块）。`npm run dev` 打开就是图 1 可玩切片，无开关、无脚本。
- 链路已通：点建造条/按 `1`–`5` → `CommandCenter` 武装 → 点格建塔 → 空格开波 → 敌人沿流场走 → 冷凝喷湿冷叠 3 层结冰 → 破碎锤单发 45 ≥ 40 触发 `ice_shatter` → 白闪 + 60ms 顿帧 + 冰晶 + 霜痕 + 「碎裂！」提示条。无头探针跑通一整波：8 出 8 杀 0 漏，`ice_shatter` ×2，页面零报错。
- 遵守：定步长恒为 1/60（探针实测 `distinctStepDeltas = [0.016667]`，不随帧率变）；建造/敌人/combo 全部走 `data/*.json` 规范 id（`TOWER_IDS` / `ENEMY_IDS`）；棋盘按地形起伏建体块，不是平铺贴图。
- 复用而非另起：`GameSession` / `CommandCenter` / `Economy` / `BuildSystem`（O2）、`vfxSignals` 稳定信号（O3）、`attachVfxToEngine` / `connectCombatToVfx`（O4）都是直接接上的，`src/app` 里没有第二套钱包、第二套建造规则或第二套帧协议。
- 试玩说明与键位：`games/last-watt/README.md`「试玩：图 1 灰盒切片」一节。
- 切片有意偏离数值表一处：默认解锁全部 5 个 M1 蓝图（真实解锁表把冷凝/锤锁到波 3 之后），另加 `G` 加金键。`new Game({ unlockAll: false })` 可跑真实节奏。
- 留给后面的两个观察，都不在接线层：
  1. 冰碎的溅射环 + 亮芯经 Bloom 之后在近景会糊成一团白，碎片读不出来，建议 O4 复核这一发的亮度/尺寸曲线（V-01 非扁平观感相关）。
  2. 一波 8 只里冰碎只成 1–2 次：冻结窗口 2 秒，而破碎锤按「首位最强」选敌，前面有没冻住的目标时不会去打冻住的那只。是否让重击类塔优先冻结目标，属于战斗侧裁决。
- 未验证：真机 1080p 60fps。本轮全部在 SwiftShader 软件光栅化下跑，帧率与分辨率成反比（1600×900 → 4.3fps，640×360 → 11fps），纯填充率瓶颈；`sim hz` 因此被循环的 5 步追帧上限压到 21，不是逻辑问题。左上角计数条已把 `fps` 与 `sim hz` 分开显示，真机上 `sim hz` 应为 60。

### Round 3

- 状态：未开始
