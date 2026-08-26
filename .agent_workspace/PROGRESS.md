# 《余电》Last Watt — 多智能体进度

- **隔离分支**：`agent/last-watt`
- **游戏根目录**：`games/last-watt/`（工作区根目录还会放其他游戏，禁止污染仓库根或 `docs/` 以外的共享位）
- **设计正文**：`docs/GDD-余电.md`（v1 已锁定）
- **视觉参考**：`docs/premium-game-visual-prompts.md` + `games/last-watt/docs/VISUAL_BIBLE.md`（Round 1 已补齐）
- **循环**：Round 1 / 2 / 3，每轮 10 子代理（4 fable + 4 opus-fast + 2 gpt-sol）；云端新 VM 并发上限 3，溢出走本地共享工作区
- **当前轮次**：三轮闭环结束 — 归档 / PR
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

- 状态：10/10 完成；云端分支 G1/F2/F4 已并入 `agent/last-watt`

#### Round 2 结论简报（主调度）

**演进对比**
- R1：四模块分立，只能各自自检。
- R2：`npm run dev` 可玩图 1——造塔、开波、走路、冰碎粒子+顿帧+提示条。规范 ID、60Hz、Bloom 正式 skip、VFX 稳定信号、玩法占格/挖沟/第二口均已接线。

**仍红的验收债**
- 冰碎近景 Bloom 糊白（碎片不可读）
- 破碎锤不优先打冻结目标，一波冰碎只有 1–2 次
- 图 1 波 6–9 解锁了 M1 范围外的火焰/特斯拉/电容；M1 应门控
- GDD M1「无丢区」但完整度阈值已会丢区，M1 应只扣分不丢区
- 音效系统无人认领，三通道验收不可测
- 真机 1080p 60fps 未验；SwiftShader 不能当性能证据
- 升级价格 JSON 与代码仍有分叉

**边界风险**
- 帧率低于 5 步追帧上限时整局慢动作
- 别名表若不清，R3 会继续漂移
- 切片默认 `unlockAll` 会掩盖教学节奏

**SOTA 差距**
- 粒子语言立法已接，但冰碎「看懂」未过关
- 无音频
- 测试链未在合并后的可玩切片上全跑一遍

**主调度已拍板（Round 3 必须遵守）**
1. 重击塔 **优先冻结目标**。
2. **必须修**冰碎 Bloom 糊白，事件粒子可读优先于炫。
3. M1 门控：波 1–10 不解锁火焰/特斯拉/电容；完整度只扣分 **不丢区**。
4. 至少落地冰碎/冻结/建造/开波的程序化或短音效，同帧触发。
5. 默认进入真实解锁表；`unlockAll` 仅开发热键。
6. 不再扩系统，只打磨与验收。

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

- 状态：10/10 完成；云端 G1/F2/F4 已并入 `agent/last-watt`

#### Round 3 结论简报（主调度）

**打磨闭合**
- 冰碎可读：近白像素 28%→0.08%，碎片轮廓可数；同帧音效（碎/冻/建/开波）
- 重击优先冻结；升级价跟 JSON
- 默认真实解锁；M1 不丢区；挖沟教学修好
- 波 10 + 冰碎同帧预算 PASS

**仍未闭合（带入后续，不挡本轮归档）**
- 波 3 教学钱不够买冷凝+锤（220 起手）
- 战斗部分配表仍是 TS 兜底，改 JSON 不一定进运行时
- 真机 1080p 60fps 未验
- 别名表未清干净；升级还不扣钱

**归档动作**
- 修 TowerView 旧 id（机枪/冷凝/锤不再渲染成默认方块）
- 结构化 PR：`agent/last-watt` → `main`

| ID | 模型 | 主攻 |
|---|---|---|
| R3-F1 | fable | 终验架构：对照 INTEGRATION，标残余越界/双实现 |
| R3-F2 | fable | 冰碎观感 SOTA 复检 + 必须修清单是否闭合 |
| R3-F3 | fable | 升级价对齐、M1 解锁/丢区门控写入配表 |
| R3-F4 | fable | 终版 ACCEPTANCE 红黄绿 |
| R3-O1 | opus-fast | 默认真实解锁；教学热键；主循环打磨 |
| R3-O2 | opus-fast | M1 不丢区；挖沟教学体验 |
| R3-O3 | opus-fast | 重击优先冻结；升级价跟 JSON |
| R3-O4 | opus-fast | 冰碎可读性 + 最小 combo 音效 |
| R3-G1 | gpt-sol | 合并后全测试链 |
| R3-G2 | gpt-sol | 波 10 + 冰碎同帧预算，不用 M3 剖面 |

#### R3-F3 回报（M1 门控写入配表 + 升级价差异表，已交付）

**门控落地（Round 2 主调度拍板 3，全部写入 `data/**` 并在 SYSTEMS.md 加短注 §8/§10/§12 D15/D16）**

- 解锁门控：`waves.map1.json` 的 `unlock_schedule` 止于波 3（机枪/焦油/发电机/冷凝/破碎锤）；火焰/特斯拉/电容条目移入新块 `m2_unlock_schedule`（保留原波 6/8/9 作 M2 暂定参考值）。波 6/8/9 的 `teach` 文案改写为 M1 口径，波 6 `tip_oil_fire_once`、波 8 `tip_conduct_once` 两个教学脚本事件随塔移出 M1（代码不按字符串匹配这两个 id，删除无副作用）。`towers.json` 增加 `conventions.milestone_gate` 并给三座 M2 塔补 notes。
- 丢区门控：M1 完整度只扣分不丢区。`game_state.defaults.json` `rules.integrity` 增加 `zone_loss_active_from_milestone: "M2"`；`maps/map1.json` 增加顶层 `milestone_gates.m1_zone_loss: false`，两个 zone 与 `zone_b_floodgate` 事件标 `active_from_milestone: "M2"`。`≤0` 判负与星级分档（80/50）不受门控影响。
- 新增字段均为数据侧扩展，现行 importer（`src/gameplay/data/importers.ts` 只读白名单字段）自动忽略，不破坏现运行时；真正按门控执行需代码侧接线（见下）。

**升级价差异表（规范值 = `data/towers.json`，代码侧 `src/combat/data/upgrades.ts` 由 R3-O3 改齐；14 条中 10 条分叉）**

| 升级 id | 塔 | JSON（规范） | 代码现值 | 代码需改 |
|---|---|---|---|---|
| up_mg_twin | mg_rivet | 90 | 90 | 一致 |
| up_mg_ap | mg_rivet | **120** | 110 | +10 |
| up_tar_sticky | tar_sprayer | 90 | 90 | 一致 |
| up_tar_wide | tar_sprayer | **120** | 100 | +20 |
| up_breaker_shockwave | hydraulic_breaker | **150** | 130 | +20 |
| up_breaker_fastcycle | hydraulic_breaker | **120** | 140 | −20 |
| up_cond_deepfreeze | condenser_jet | 120 | 120 | 一致 |
| up_cond_dualnozzle | condenser_jet | **150** | 130 | +20 |
| up_flame_longburn | flame_thrower | **100** | 130 | −30 |
| up_flame_range | flame_thrower | **130** | 120 | +10 |
| up_tesla_chain5 | tesla_coil | 150 | 150 | 一致 |
| up_tesla_coolrun | tesla_coil | **130** | 150 | −20 |
| up_cap_longsurge | capacitor_station | **140** | 120 | +20 |
| up_cap_halfheat | capacitor_station | **110** | 130 | −20 |

**顺手登记的代码侧接线债（不属本任务改动范围）**

1. 解锁表分叉（O1/O3）：`src/combat/data/towers.ts` `ui.unlockWave` 现为 flame=6、tesla=8、capacitor=6（连 JSON 旧值 9 都不一致）；按门控三者在 M1 应不可解锁（建议 `unlockWave` 置 11+ 或由 `M1_BUILD_MENU` 白名单兜底——后者现已不含三塔，`BuildSystem.unlockedByTable` 才是漏洞点）。
2. 丢区接线（O2）：`world.applyIntegrity` / `CombatLink.settleIntegrity` 现仍按 `triggerIntegrity` 80/50 丢区，需消费 `zone_loss_active_from_milestone` / `milestone_gates.m1_zone_loss` 门控（importer 需把该字段带进 `ZoneDef`）。内置图 `map1Powerhouse.ts` 的 zones（80/50）同样受影响。
3. 升级价效果侧分叉（O3 改价时顺带核）：`up_tar_wide`（JSON=射程 2.5→3.5 vs 代码=涂radius+1）、`up_cond_dualnozzle`（JSON=同时喷 2 目标 vs 代码=锥角+18°）、`up_breaker_shockwave`（JSON 有 `splash_damage_ratio: 1.0` 字段，代码只加 splash 半径）；价格以 JSON 为准是拍板，效果语义分叉按 SYSTEMS §5 的 `overrides` 语义靠拢或另开裁决。

#### R3-O3 回报（重击优先冻结 + 升级价跟 JSON，已交付）

- 独占路径 `src/combat/**`，三个提交已推 `agent/last-watt`：`37f1765` 升级价、`7060784` 索敌优先、`17f1e53` 自检与 README。
- **重击优先冻结**：索敌不认识「冻结」这个词，攻击定义多一个 `priorityStatuses` 字段，破碎锤在 `data/towers.ts` 里声明 `['frozen']`。带该状态的目标整体高一档，档内仍按塔的 first/strongest 排序；玩家显式选的 `air` 仍压过这条偏好，所以对空档位不会被冰抢走。GDD §7.2「combo 不写 if」原样成立。
- 实测（无头，冷凝 + 破碎锤挨着放，8 只一波）：按路径顺序 1 次冰碎 → 优先冻结 3 次；装甲运输车击杀 1→5、拾荒虫 7→8。仍不是每次冻结都能吃到，因为冻结 2s、锤子循环 2.5s，属节奏而非索敌问题。
- **升级价**：14 项里 8 项与 `data/towers.json` 分叉（穿甲弹 110→120、大范围 100→120、震荡波 130→150、快速循环 140→120、双喷口 130→150、火场延长 130→100、射程+1 120→130、超载后不过热 150→130、超载 8s 120→140、过热减半 130→110），全部改回 JSON。8 座塔的造价本来就一致。
- 自检 16 → 19 条全绿：新增「造价/升级价与 data/towers.json 逐条相等」「破碎锤打冻结的那只并碎冰」「不声明优先状态的塔仍打首位」。价格断言把 JSON 钉成唯一定价来源，以后单边改价直接红。
- 新探针 `runFrozenPriorityProbe()` 已从 `src/combat/index.ts` 导出，G1 可直接断言。
- **移交 R3-F3**：JSON 与代码在非价格字段仍有分叉，我按指派只动了价格——机枪 5 伤/0.5s vs 10 伤/1.0s（DPS 同为 10）、冷凝射程 2.5 vs 3.0 与锥角 60° vs 56°、焦油补涂 3s vs 2s、「双喷口」JSON 写同时 2 目标而代码做成加宽锥角+射程。需要配表侧拍一版。
- **提醒**：升级目前不扣钱——`GameSession.upgradeTower` 直接转发给战斗，钱包没有走 `UpgradeDef.cost`。价格已对齐，接线还缺，归经济/接线侧。
- 环境观察（非本次改动）：共享工作区里 `src/app`、`src/gameplay`、`src/ui` 有其他代理未提交改动；干净 HEAD 上 `npm test` 已有 2 条红（gameplay leak payload 与聚合计数），`npx tsc --noEmit` 有一条 `src/app/game.ts(84)` 报错。我的改动未新增红项，combat 侧类型干净。

#### R3-O2 回报（M1 不丢区 + 挖沟教学，已交付）

- 独占路径 `src/gameplay/**`，两个提交已推 `agent/last-watt`：`7456d2e` 门控与波 5 炸墙、`ccf543d` 改读配表 + 自检。
- **M1 不丢区**。丢区（GDD §10）整套逻辑原样留着，外面加一道里程碑开关 `src/gameplay/rules/scope.ts`（`CURRENT_MILESTONE = 'M1'`）。跨 80 / 50 不再削供电上限、不断塔、不开闸；完整度照扣、阈值照显示、**扣到 0 照样判负**。实测默认配置下扣到 79 / 49 供电上限仍是 8，扣到 0 时 `run_lost{reason:'integrity'}` 照常发。
- **门控读配表，不是写死**。R3-F3 落的 `milestone_gates.m1_zone_loss` 与 `zones[].active_from_milestone` / 事件的 `active_from_milestone` 原先在 importer 被丢掉，现在进 `MapDef.zoneLossByMilestone` / `ZoneDef.activeFromMilestone` / `BarrierDef.activeFromMilestone`。解析顺序：调用方 `zoneLoss` > 配表 > 里程碑默认值。把 JSON 里那个 `false` 改成 `true`，运行时立刻恢复丢区（INTEGRATION.md §4.1-5），自检里有一条专门钉这个。想跑 M2 语义：`createGameSession({ map, milestone: 'M2' })`。
- **挖沟教学之前是坏的**，两处：
  1. `GameplayWorld.startWave()` 从来没调过 `grid.openBarriersForWave()`，所以 `wave5_breach` 永远不炸——`gate_1b` 的出怪格 (0,5) 一直是墙，支路一直封。已在同步出怪口**之前**接上（顺序有意义）。
  2. 波 5 那条赠送挖沟的 `free: true` 与 `recommended_cell: [5,5]` 在 importer 被丢掉，玩家照样被扣 50 金 + 1 次配额。现在免费次数优先于付费配额消耗，不扣金不占额。
  实测：波 5 之前全图合法挖点只有 5 格软土（都不在任何路径上，教不了任何东西，(8,2)/(9,2) 挖了就封 `gate_1`）；波 5 开波后变 10 格，`(8,2) (9,2) (4,5) (5,5) (6,5)` 全部合法。花掉赠送的那一镐：金币 270 → 270，挖沟次数 4 → 3（三次付费配额一次没动），下一次报价回到 50。挖 (5,5) 后支路捷径被切断，敌人回主路。
- **给 UI 的新字段**（`session.snapshot()`，都是增量，不改现有字段语义）：`integrity.lossEnabled`、每条阈值多 `breached`（跌破了）与原有 `lost`（区真没了，M1 恒 false）；`engineering.freeDig / freeBridge / recommended`，`digCost` 改成「下一次的实际报价」（赠送未花时是 0）。
- **移交 R3-O1 / O4（UI 侧，不是我的树）**：`ResourceRail` 现在按 `lost` 画「已丢」，M1 永远不会亮，但 80/50 两条刻度还立在那儿暗示「掉到这里要丢区」。建议 `lossEnabled === false` 时把刻度改成中性星级分档口径，或读 `breached` 变色而不写「已丢」。`ActionCluster` 的「挖沟：N 金」直接吃 `digCost`，赠送时会显示 0 金，可加个「赠送」角标。
- 自检 73 → **82 条全绿**。丢区那几条保留覆盖，名字前加 `丢区 on:` 并显式开开关（授权图那条要 `milestone: 'M2'`，因为它的 zone 标了 M2）；新增 `M1:` 4 条与 `挖沟教学:` 3 条，后者按真实节奏跑到波 5。`npx tsc --noEmit` 干净，`npm run build` 通过。
- **未修的既有红项**（在 `tests/**`，R3-G1 的树）：`tests/last-watt-rules.test.ts:22` 把自检条数写死成 47，干净 HEAD 上就已经红（当时 73 条），我这轮变成 82 条，仍红；`every production enemy emits its configured leak payload` 的 `swift_rat` 也是干净 HEAD 上就红的，与本次改动无关。逐条自检测试（`gameplay self-check: <name>`）全绿。

#### R3-O1 回报（默认真实解锁 + 主循环 UX 债，已交付）

- 独占路径 `src/app/**` / `src/main.ts`，另按需动了 `src/gameplay/build|commands|session` 三个文件与 `src/ui` 的建造条 / 资源栏 / 工程按钮。六个提交已推 `agent/last-watt`：`f32b2a5` 解锁契约、`2e6e86c` 默认解锁表 + 主循环、`689b589` 结算面板文案、`a9c141a` README、`f065e2d` M1 范围锁、`a1d8366` 丢区刻度与赠送挖沟。
- **默认进真实解锁表**。`new Game({ container })` 现在跑 `data/waves.map1.json` 的表：第 1 波只有铆钉机枪，焦油第 2 波，冷凝 / 破碎锤 / 发电机第 3 波。实测一整局默认跑法（4 台机枪、零调试键、打到波 9）：波 2 清完那一刻三张新图纸同时到货，完整度 100 → 28，`devAids` 全程为空。
- **`unlockAll` 降级为开发热键 `U`**，构造参数保留给无头探针（两者同一个开关）。`BuildSystem.setUnlockOverride(fn | null)` 负责运行时换规则再换回来——构造参数仍是「一局怎么声明自己的解锁表」的唯一入口，`null` 恢复它。
- **加金保留但不再掩盖节奏**。`G` +400 只补钱包，跳不过解锁表（解锁表现在是 wave 门控，钱买不动）。`G` 与 `U` 都记进 `Game.diagnostics().devAids`，右上角计数条多一行 `dev aids`，默认显示「无」。**这一行不为空的截图或性能报告，不能当默认节奏的证据。**
- **锁着的图纸会说自己第几波开**。`BuildSystem.unlockWaveOf()` 进 `SessionSnapshot.build[].unlockWave` 与 `HudState`；建造条把图面压暗、把「第 N 波」角标留满对比度（原来是整项 0.28 透明度 + 「图纸未解锁」提示，读起来像坏按钮）；热键与落点检查的拒绝理由也改成同一句「图纸第 N 波解锁」。
- **M1 范围锁补了个洞**（F3 在回报里点过）：`src/combat/data/towers.ts` 的火焰 6 / 特斯拉 8 / 电容 6 全在图 1 十波之内，建造条虽然只列 5 项，`BuildSystem.isUnlocked` 却会放行。切片现在把「M1 白名单」与表自己的排期**组合**（`unlockedByTable` 由私有改公开），不重写排期规则。实测跑到波 9 菜单始终只有 5 项。配表侧要不要把三塔的 `unlockWave` 挪到 11+ 仍归 F3/O3，这里只是接线层不再依赖它。
- **主循环 UX 债，清了六条**：
  1. 本局结束只有一句「刷新页面再来」→ 结算面板 + `R`/按钮重开（`main.ts` 负责拆装，请求延后一拍，避免在帧回调里 dispose 引擎）。
  2. 没有暂停 → `P`。用把 timeScale 压到 0 的办法（和冰碎顿帧同一机制），不是 `engine.stop()`——后者连渲染一起停，HUD 与帧表会定在旧值后面。
  3. 空格与顶栏「提前开波」是同一条命令却给不同赏金：空格传 `early: session.status === 'running'`，波间恒为 false。波之间无限等待，每次开波都是提前开波，键盘白扔 10%。已统一。
  4. 清波不出声：`wave_cleared` 现在报「第 N 波清空，+X 金（含提前 +Y）」。
  5. 新图纸到货不出声：按快照差分播报，热键解锁走同一条路径。
  6. 部署期台词点名冷凝与破碎锤，而真实排期下它们还锁着三波——改成「先摆两台机枪」。
- **接下 R3-O2 的 UI 移交**：完整度条 80/50 刻度在 `lossEnabled === false` 时不再写「已丢」，改成跌破即高亮 + 提示语写明「本里程碑只记伤」；工程按钮的赠送次数打「赠送」角标、提示语写明不扣金不占额，棋盘上给 `engineering.recommendation` 的格子加了一圈脉冲金环（波 5 实测指向 (5,5)）。
- **验证**（都在只含已提交代码的冻结副本上跑，避免共享工作区里其他代理的未提交改动）：
  - 无头玩法探针 10/10：真实解锁表、拒绝理由带波号、override 开关来回、波 3 三张图纸同开、提前开波确实付 10%。
  - 真浏览器 CDP 探针 17/17：建造条四个锁位与波号角标、`devAids` 默认为空、`P` 暂停时 `simHz=0` 而帧数继续涨、`U`/`G` 留痕、失败面板与重开后只剩一块 canvas 与一份 HUD、页面零报错。
  - 教学节拍探针：默认跑法走到波 9，M1 范围不破；波 5 赠送挖沟的角标、提示语与 (5,5) 金环。
  - `npx tsc --noEmit` 干净，`npx vite build` 通过。
- **移交主调度 / R3-F3（数值，不是接线）**：默认表打开后暴露一个教学缺口——按 220 起手 + 击杀赏金 + 波奖励，清完波 2 大约 99–199 金（取决于摆几台机枪），而冷凝 130 + 破碎锤 120 = 250。波 3「玩家自己造出这一对打出第一次冰碎」的节拍**凑不齐钱**，多半要拖到波 3 打到一半或卖塔。要么调赏金/造价，要么把这一对的解锁挪前一波并配一笔波 2 结算奖励。我没有动 `data/**`。
- **环境**：共享工作区里 `src/vfx`、`src/audio`、`src/gameplay/rules` 有其他代理的未提交改动，`src/gameplay/session/GameSession.ts` 被并发覆盖过一次（我的改动被冲掉后重打）。我只 `git add` 自己的文件。干净 HEAD 上的既有红项（`tests/last-watt-rules.test.ts` 写死自检条数、`swift_rat` leak payload）与本次改动无关，前后一致。

#### R3-O4 回报（冰碎 Bloom 糊白 + 最小 WebAudio 音效，已交付）

独占 `src/vfx/**`（承接 R1-O4）与新建 `src/audio/**`。六个提交已推 `agent/last-watt`：
`cb413b1` Bloom 权重、`1d9d616` 音频模块、`8c5b312` 探针进程泄漏、`28f1a3d` 真战斗接线闸门、
`5d63e41` 文档、`f912bb7` 真浏览器切片探针。

##### 1. Bloom 糊白：`uCull` 是整层开关，不够用

R2 的冰碎里闪光、辉光、碎片一起全额进 Bloom 输入，泛光把碎片吃成一坨白饼。
根因不是「Bloom 调太亮」，是**没有粒度**：`uCull` 只能整层进/不进，
而这里需要同一层内部辉光让位给碎片。

所以逐粒子加一个 `aBloom` 属性（0..1），片元里 `rgb *= mix(1.0, vBloom, uMaskPass)`——
**beauty pass 该多亮还多亮，只削它往 Bloom 输入里投的那份能量**。
调暗辉光和调低它的泛光贡献从此是两件事。冰碎据此让辉光限额、碎片全额，
`renderOrder`（加色 10 / 混色 11）保证碎片画在辉光之上，白闪从 0.62/90ms 降到 0.34/70ms。

##### 2. 「不糊白」不能当验收指标——把粒子全调没也能让它归零

所以先写探针再改代码：`src/vfx/demo/readability.probe.mjs` 在无头 Chrome 里
把 R2 与当前调校各跑一遍**同一发冰碎**，在 +17/100/200/350ms 读画布像素，
六个指标 A/B 对比。判定是双向的：三条防糊白，三条防「调没了」。

| +100ms | R2 | 现在 |
|---|---|---|
| 糊白占比（近白像素） | 28.21% | **0.08%** |
| 冰像素边缘能量（碎片轮廓） | 0.050 | **0.292** |
| 冰像素占比 | 16.06% | 6.48%（闸门 ≥3%） |
| 冰像素蓝调 | 0.067 | 0.073（闸门 >0.06） |

5/5 判定通过。`--png` 存了八张对照图（`.probe/`，已 gitignore）：R2 那张是一坨没有
任何结构的白饼，现在能数得出碎片。自检另加两条常驻闸门（19/19 绿）。

##### 3. 音效：四条，与粒子同帧，零音频资产

`src/audio/**` 新模块，程序化合成（GDD 18.2 的零资产纪律同样管声音）。
`voices.ts` 认识音色、`AudioEngine` 认识 WebAudio、`bridge.ts` 认识战斗事件，三者互不知情。

**同帧是构造出来的，不是调出来的**：本桥与 `vfx/combatBridge.ts` 订阅同一条
`combat.bus` 信号，`emit` 同步派发，`play()` 同步排到 `ctx.currentTime`。
误差 0 帧。自检在 `endFrame()` 之前同时断言粒子数 / 发声数 / 顿帧状态。

##### 4. 途中挖出来的坑：总线压限器在用听觉重演 Bloom 糊白

离线渲染发现四条音效峰值全被摁在 0.067 上下。三方对比定位到总线：

| 冰碎经过 | 峰值 |
|---|---|
| 音色裸输出 | 0.566 |
| 只过 0.6 增益 | 0.384 |
| 过 `DynamicsCompressor` | **0.085** |

信号还在阈值以下 8dB 却被吃掉 13dB，而开波那种 10ms 起音的长音分毫未动。
检测器对 1–2ms 起音的冲击音反应过度，**吃掉的正好是「碎裂感」所在的那几毫秒**——
和 Bloom 糊白是同一个错误的两种感官：一个不分青红皂白的「保护」把信息量最大的瞬态抹平了。

换成 `WaveShaper` 软削波（0.75 以下恒等，往上 tanh 收进 1.0）：无状态、无时间常数，
不区别对待瞬态，`WaveShaper` 对 ±1 以外输入的夹取顺带成了真正的硬顶。四条音效响度回到 2.5 倍。

（另：`DynamicsCompressor` 的 `knee` 默认 **30dB**，软拐点从 `threshold-15dB` 就开始。
谁要加回来先看这行。）

##### 5. 三层验证，逐层堵住上一层的盲区

| 层 | 工具 | 堵的漏 |
|---|---|---|
| `npm run selfcheck:audio` | `AudioContext` 替身 | 事件→音效的翻译、同帧、节流、静音、降级（9/9） |
| `npm run probe:sfx` | `OfflineAudioContext` | 替身证不了「合成器接受这张图」：非法 ramp、拼错的滤波器类型在替身上一路绿灯，真浏览器里是抛异常加一片寂静（8/8） |
| `npm run probe:slice-audio` | CDP 开真游戏 | 前两层都绕开了 `main.ts` 的组装代码。真手势解锁、真点棋盘放塔、空格开波、`M` 静音（7/7） |

自检第 9 条另外换真 `CombatSystem` 跑完整条 GDD §7.3.1 链：订阅一个拼错的事件名不会报错，
只会永远安静，所以要有一条盯死「事件名、载荷字段、发射时机」的闸门。

音效读数（离线真渲染，峰值 / 时长 / 频谱重心）：
冰碎 0.397 / 0.18s / 3579Hz，冻结 0.153 / 0.24s / 386Hz，
建造 0.201 / 0.09s / 144Hz，开波 0.138 / 0.41s / 117Hz。
冰碎是最亮最短的一条，比开波亮 30 倍——VISUAL_BIBLE 10.1「关画面仅听声音也能确认碎裂」成立。

##### 6. 接线与操作

`src/main.ts` 装配（不是 `game.ts`：那个文件当时正被并发改，装配层本来也是它该待的地方）。
`AudioContext` 惰性创建，首次 pointerdown/keydown 自动解锁，构造时不碰音频设备；
拿不到 `AudioContext` 时整个类降级成计数器，`play()` 照常记账。**`M` 键静音。**

##### 7. 移交与环境

- **移交 UI/设置**：现在只有 `M` 静音，没有音量滑条、没有音乐与环境层。
  `AudioEngine` 的 `masterVolume` 已经是构造参数，接设置面板只差一个 setter。
- **移交 F3/数值**：`MIN_INTERVAL`（冰碎 45ms 等）与各音色的 peak 现在写在 `voices.ts` /
  `AudioEngine.ts`。等 `data/audio-events.json` 建起来，这些数值该搬去 JSON，代码只留「id → 合成函数」。
- **顺手修的**：两个探针的 `npx` 子进程杀不干净，跑几轮就在机器上攒下七八个 vite dev server
  占着端口（`8c5b312`，改 detached + 杀进程组）。
- **既有红项，与本轮无关**：`npm test` 的 `gameplay self-check reports no aggregate failures`
  与 `every production enemy emits its configured leak payload` 两条。已用 `git worktree`
  在 `f065e2d`（本轮所有改动之前）复跑确认：同样 88 pass / 2 fail，前后一致。
  `npx tsc --noEmit` 干净，`npm run build` 通过。
