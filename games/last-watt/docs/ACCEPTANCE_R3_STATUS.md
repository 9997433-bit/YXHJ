# 《余电》Last Watt — Round 3 验收现状红黄绿（R3-F4）

- **责任人**：R3-F4（fable 验收/审计代理）
- **依据**：`games/last-watt/docs/ACCEPTANCE.md`（33 条 M1 验收，本文件逐条对照）
- **被审对象**：`agent/last-watt` @ `4f6c4b2`（Round 3 开工时的合流基线，含 R2 全部合并的可玩切片）
- **性质**：这是**现状快照**，不是 M1 正式验收（正式验收留档走 `docs/audit/m1-<日期>/`，签核走 ACCEPTANCE.md 末尾）。ACCEPTANCE.md 本体零改动。
- **并行提醒**：R3 其余九个工位与本审计并行；本报告只对 `4f6c4b2` 负责，R3 各分支合流后由本工位（或终验执行者）复跑 §F 命令刷新颜色。

## 0. 颜色判定规则（与 R2 报告一致）

| 颜色 | 含义 |
|---|---|
| 🟢 绿 | 现状已满足该条通过标准，且有可复核证据 |
| 🟡 黄 | 模块级已实现/部分满足，但证据链不完整、或测法尚未按验收要求落地 |
| 🔴 红 | 未开工、关键实现缺失、或现状**违反**该条标准（违反项在备注中明示） |

**总计：🟢 8 / 🟡 17 / 🔴 8（共 33 条）。** 对照 R2（🟢7 / 🟡15 / 🔴11）：净移动 = G-01 🔴→🟡、G-07 🟡→🟢、V-05 🔴→🟡、S-02 🔴→🟡；其余颜色不变但多数黄条的证据链显著变厚。
分组：玩法 G 🟢1 🟡7 🔴3 ｜ 视觉 V 🟢0 🟡6 🔴0 ｜ 性能 P 🟢0 🟡1 🔴3 ｜ 范围锁 S 🟢4 🟡2 🔴1 ｜ 工程卫生 I 🟢3 🟡1 🔴1。

**一句话诊断**：R2 的「没有一局可玩的游戏」已翻篇——`npm run dev` 即图 1 可玩切片，四模块经 `src/app` 单点装配，测试改打真模块（79/81 过，2 个失败是测试侧过期断言而非游戏 bug）。剩余 8 个红条全部有 Round 3 派工归属：音效+慢放（G-06 → R3-O4）、试玩类证据（G-09/G-10 → 待可交付构建后组织）、真机性能三件套（P-01/P-02/P-04 → R3-G2）、M1 丢区门控违反（S-04 → R3-O2）、配表数值副本（I-03 → R3-F3/O3）。

---

## A. 玩法（G-01 ~ G-11）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| G-01 整局可玩通 | 🟡（R2 🔴） | 可玩切片已合流：`src/main.ts` + `src/app/game.ts` 装配 engine+gameplay+combat+vfx+ui，`npm run dev` 开局即图 1；`GameSession.runStatus` 有 `won/lost` 结算态与老周结算电台词（`src/app/hudBridge.ts:186-189`），利维坦即死与完整度归零判负都在 `CombatLink.declareDefeat`。缺：验收测法要求的**固定种子脚本化整局回放**（波 1–10 到结算）不存在，人工抽玩也无留档；`window.__lastWattGame` 只是控制台探针句柄 |
| G-02 四塔+发电机可建造且生效 | 🟡 | 扣费闭环已补齐（R2 缺口）：`src/gameplay/economy/Economy.ts` 钱包起值来自 `data/game_state.defaults.json`（自检「the wallet starts from data/...」PASS）；非法位置拒绝带原因并经 HUD 提示（`BuildSystem` 的 reject 文案 + `hudBridge.ts:88` notify）；五个蓝图在切片里全部可放置且攻击/供电生效（人工可证）。缺：验收要求的**逐塔**「放置→扣费→首次攻击/供电事件」断言不全——冷凝/破碎锤经冰碎探针实测开火，机枪/焦油/发电机无独立首击断言 |
| G-03 电力双层生效 | 🟡 | 已实现：未供电（丢区）塔停转经 `CombatLink` 调 `combat.setTowerPowered(false)`（`CombatLink.ts:224`），供电占用/上限/超限禁建全链有自检（「supply cap refuses」「integrity ≤80 … towers dark, draw kept (D11)」均 PASS）。**需裁决**：验收原文「拆除发电机后下游塔立即停转」与 SYSTEMS.md D11 立法冲突——D11/GDD §6.2 定的是「塔常驻占用、超上限只禁新建（逼你卖塔）」，`Economy.ts:141` 如实实现「>0 blocks new draw」，拆发电机**不会**停已建塔。二选一：主调度确认按 D11 解释本条，或战斗侧加缺电停转。三场景专项单测未按验收原文分立成文 |
| G-04 冰碎规则正确 | 🟡 | 真模块测试已进 `tests/**`（R2 缺口补掉一半）：`last-watt-rules.test.ts` 实测 40 伤害阈值边界（39 不触发/40 触发）、冻结消耗、免疫上身（`chill_immune`）、探针全链（chill→freeze→shatter→溅射→免疫挡 chill）全过。立法值在 `src/combat/data/tuning.ts`：`FREEZE_DURATION=2`、`CHILL_IMMUNITY_DURATION=3`。缺：验收点名的 **2.9s/3.1s 时间边界用例**仍未写 |
| G-05 涂层/状态互斥 | 🟡 | 真模块湿↔油互覆测试已进 `tests/**`（「production statuses keep wet and oil in one coating slot」PASS，双向覆盖 + 时长断言）。缺：M1 内**全部状态组合穷举**（湿冷层数×冻结×免疫×涂层）仍未成文 |
| G-06 冰碎首触发反馈链完整 | 🔴 | 五事件盘点（较 R2 从 0 接线到 3/5 接线）：粒子 ✅（切片实发，vfx 自检「四件套齐发」PASS）、顿帧 ✅（引擎已吃 `vfx.beginFrame().timeScale`，自检「冰碎顿帧冻结逻辑 tick，渲染照常出帧」PASS——R2 的接线缺口已闭合）、提示条 ✅（`combo_first_seen` → `hud.showComboTip`，`game.ts:134`）、**慢放 ❌**（timeScale 仍只有 0/1，GDD §19 波 3 要求「首冻全局慢放 0.5s」无实现）、**音效 ❌**（`rg -i audio src/` 仍仅类型字段；GDD §19 M1 范围原文明含「粒子+音效+顿帧」，音效是 M1 硬需求）。两事件缺失 → 维持红；归 R3-O4 |
| G-07 挖沟可用且寻路正确 | 🟢（R2 🟡） | 验收测法（单测：改路前后路径对比 + 敌人通行性断言）已按真模块落地并纳入 `npm test`：挖堵拒绝、两笔联合判定、施工期可通行、**在途敌人即时改道**、软锁兜底（soft field）全部 PASS（73 条 gameplay 自检以逐条测试形式跑进套件）；切片内非法格拒绝带原因提示（HUD notify + 工具保持武装），挖沟高亮合法格。留一笔观察：整局内「不卡死」的长时 fuzz 未做，属 G-01 回放的副产品，不单独卡本条 |
| G-08 完整度扣分正确 | 🟡 | 扣分链在切片内闭环（R2 缺口）：`enemy_leaked` → `CombatLink` → `economy.damageIntegrity` → 判负检查 → HUD 实时显示；逐敌漏怪载荷测试存在（`tests` 81 条中的「every production enemy emits its configured leak payload」，当前因测试侧旧 id 失败，见 §F 注 2）。仍不绿的原因：**丢区逻辑仍在介入**完整度链路（见 S-04 🔴，验收原文「丢区逻辑完全不介入」）；「结算正确显示」现状只有电台词一句，无结算面板 |
| G-09 教学试玩达标 | 🔴 | 无变化：5 人试玩零记录。且切片默认 `unlockAll`（`game.ts:91`，`options.unlockAll !== false`）跳过真实教学解锁节奏，违反 Round 3 拍板第 5 条——默认态修正归 R3-O1，试玩要等它 |
| G-10 挖沟被主动使用 | 🔴 | 无试玩记录；UI 已有挖沟次数计数（`ActionCluster` 的 digCount），但「教学赠送 vs 主动」归因埋点仍未实现（工程授予走 `applyGrantsForWave`，与玩家自费挖沟在计数上未分桶） |
| G-11 确定性回放（审计基建） | 🟡 | 确定性基础更扎实：逻辑层零随机（`Math.random` 全源码 3 处均在表现层：`EnemyView.ts:148` 浮动相位、`effects.ts:154` 粒子旋转、BoardView 用确定性哈希），定步长恒 1/60，flow field 平局规则固定。缺：回放 harness 与「两遍 diff 波次/伤害/完整度」设施仍完全未落地 |

## B. 视觉（V-01 ~ V-06）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| V-01 非扁平 2D 贴图塔防 | 🟡 | R2 的「场上没有塔和敌人」已解决：`TowerView` 逐塔剪影、`EnemyView` 七种形体（bug/rat/hauler/bee/crab/drone/boss）+ 血条 + 冻结冰壳，`BoardView` 按地形起伏建体块，斜俯视 55° + 实时光照 + Bloom。仍欠：冰碎近景 Bloom 糊白（R2 遗留，主调度拍板「必须修」，本 HEAD 未见修复痕迹，待 R3-O4/F2 复检）；多角度截图零留档，纯人工目检未走 |
| V-02 粒子是玩法语言 | 🟡 | 冻结（冰壳材质 + 冻结粒子 + 霜痕贴花）与碎裂（四件套）在切片内专属可辨；色板/形状冗余编码立法照旧（`palette.ts`/`atlas.ts`）。缺：**焦油涂层在切片内无可辨表现**——`combatBridge.ts` 不监听涂层/`status_applied`，路面油渍与敌身油涂层都没有视觉载体；「每状态有绑定 VFX」存在性断言只做到信号层（combat 自检「every stable VFX signal has exactly one producer」） |
| V-03 事件粒子永不降级 | 🟡 | 证据链较 R2 变厚：bench 新增**生产运行时探针**（`bench/lib/production-runtime-probe.mjs` 经 Vite SSR 加载真 `VfxSystem`/governor），报告 `productionRuntimeVerified: true`、事件粒子在满容量下仍全额授予（`eventGrantAtCapacity: 50`、持续状态授予 0）、`violations: []`；vfx 自检压力项 PASS。仍不绿：**渲染帧下的 P-02 场景断言**没有（`renderedFrames: false`），红线条目必须在真实渲染的压测里闭合 |
| V-04 节流三规则接入 | 🟡 | 屏幕冲击节流：100ms 冷却在切片内实跑（`ImpactDirector.hitstopCooldownMs`，自检 PASS）；循环 LOD：bench 有生效证据。缺：「持续状态低粒子量」仍无独立开关与前后计数对比留档（预算优先级里有「事件 > combo > 持续状态 > 环境」的丢弃顺序立法，但不是这条要的主动低量规则） |
| V-05 供电/断电一眼可辨 | 🟡（R2 🔴） | 载体已有：塔渲染存在且 `tower_state_changed` → `TowerView.setOnline`，断电塔自发光从基准值压到 0.05（`TowerView.ts:201-205`），亮/灭对比无需 UI 即可读。缺：供断电对照截图零留档、人工目检未走；丢区断电是切片里唯一断电途径（与 G-03 裁决联动） |
| V-06 最小 HUD 正确 | 🟡 | 四项（金币/电力/波次/完整度）在切片内接真实数据源实时刷新（`hudBridge.build()` 每帧读 `session.snapshot()`）；R2 小疵「波次总数 20」已消——总数来自 `data/waves.map1.json`（恰 10 波）。缺：「数据源与显示值一致」只断言到快照层（自检「the HUD snapshot reports the wired state」PASS），DOM 显示值断言与人工走查留档没有 |

## C. 性能（P-01 ~ P-04）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| P-01 60fps 恒定于参照机 | 🔴 | 参照机（4 核 + Iris Xe @1080p）采样仍为零；本轮全部数字来自 SwiftShader 软光栅（R2-O1 实测 1600×900 → 4.3fps，纯填充率瓶颈，不能当证据）。机制面达标：顿帧确以时间缩放实现且渲染照常出帧（vfx 自检「引擎帧协议」PASS），诚实帧率计已把 `fps` 与 `sim hz` 分开。缺的就是真机取数这一件事 |
| P-02 M1 压测场景不破线 | 🔴 | 场景仍是 M3 剖面：`bench/scenarios/waves-16-19.json`（波 16–19 三火场），验收要求「波 10 大潮 + 冰碎多次同帧触发」；无渲染帧时 p95。Round 3 拍板已把「不用 M3 剖面」派给 R3-G2，本 HEAD 未落 |
| P-03 粒子/发射器计数接口（记录项） | 🟡 | 接口达标且升级：bench 经 Vite SSR 直读生产 `VfxSystem` 计数器（`exactAliveParticles` 与政策授予数逐帧对账），报告含 peaks 留档（`bench/output/waves-16-19.production.report.json`）。基线仍来自确定性需求模型而非真实一局，「记录」二字勉强成立但建议 R3-G2 换场景时顺手重录 |
| P-04 内存稳定 | 🔴 | 无变化：bench 无堆采样（`rg -i "heap|memory" bench/` 零命中），连续两轮波 1–10 的 JS 堆对比未实现 |

## D. 范围锁（S-01 ~ S-07）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| S-01 无战斗英雄 | 🟢 | `rg -i "hero|英雄" src/` 仅命中 `src/combat/README.md` 两处「no hero / out of v1 scope」声明。维持绿 |
| S-02 可建单位锁定 | 🟡（R2 🔴） | UI 面已修：`M1_BUILD_MENU` 恰好 5 项（4 塔+发电机），M1 外三塔「不列出而非灰显」（`src/app/config.ts:28-34`），BuildBar 槽位/热键都从这 5 项生成；默认切片下蓝图锁也钉在这 5 项（`game.ts:105`）。残余违反面：`data/waves.map1.json` 的 `unlock_schedule` 仍在**波 6/8/9** 解锁 flame_thrower/tesla_coil/capacitor_station 且无 M1 门控字段——一旦按 Round 3 拍板第 5 条切回真实解锁表（`unlockAll:false`），这三张图纸会在会话状态里变为已解锁（UI 不可见但 `commands.buildAt` 可达）。配表门控归 R3-F3，默认态归 R3-O1 |
| S-03 combo 范围锁 | 🟢 | 人工审计：油火/导电仍零正式 VFX。**裁决项升级提醒**：超载（第 4 个 combo/电容站）的 VFX 较 R2 从占位变为已接线（`playOverloadStart/End` + `overload` 稳定信号 + combat 自检 2 条）——因电容站在 M1 不可建，切片内永不触发，故仍判绿；但「不得提前投入正式 VFX」的字面裁决请主调度在终验前落一句话，免得 R1-F4 签核时翻案 |
| S-04 无丢区 | 🔴 | **维持违反**。丢区两档在合流切片里实跑：`CombatLink.settleIntegrity` 每次完整度变化都调 `world.applyIntegrity`（`CombatLink.ts:220-228`），≤80 丢 A 区断电停塔、≤50 开泄洪闸改道，UI 画丢区刻度并标「已丢」（`ResourceRail.ts:255-263`）。GDD §19 M1 范围原文「完整度扣分（**无丢区**）」白纸黑字，Round 3 拍板第 3 条已派 R3-O2 门控，本 HEAD 未落 |
| S-05 v1 外系统零接入 | 🟢 | `rg -i "无尽|endless|天气|weather" src/` 仅命中两处英文注释单词 weathered/weathering（BoardView/GridView 的锈蚀观感注释），无系统代码。维持绿 |
| S-06 内容范围锁 | 🟡 | 达标面更稳：`data/maps/` 仅 map1，`data/waves.map1.json` 恰 10 波，**切片入口硬 import 这份 JSON**（`game.ts:19-20`），玩家可达内容确为图 1 波 1–10。渗入面同 R2：`baseWaveTable.ts` 仍是 20 波 TS 基表（自检还断言「the plan is 20 waves」）、waveGenerator 带图 2/图 3 分支、combat 有母舰/利维坦定义；另 INTEGRATION.md §3.2 明文「兼容别名只保留 R2，R3 起删除」，别名层本轮到期未删。钉死 M1 枚举断言的活仍欠 |
| S-07 GDD 锁定裁决不可改 | 🟢 | `git log --follow -- docs/GDD-余电.md` 仍仅 1 条提交（`414048b`），加入后零改动。审计基线注记同 R2：正式验收按「自 `414048b` 起零 diff」执行 |

## E. 目录隔离与工程卫生（I-01 ~ I-05）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| I-01 变更路径白名单 | 🟢 | `git diff --name-only main...HEAD` 复核：白名单三项之外仍仅 `docs/GDD-余电.md` 本体（基线定义问题，同 S-07 注记）。仓库根与共享位零污染 |
| I-02 模块边界遵守 | 🟡 | 大方向干净且装配纪律成立：跨模块装配只发生在 `src/app`（唯一同时认识五模块的层，`game.ts` 文件头自述并属实），gameplay/combat 仍不碰 three/DOM。偏差三处：① INTEGRATION.md §2 规定的 `src/sim.ts` + GameEventHub 未建，实际用 `src/app/game.ts` 直连各局部总线（精神达标、字面漂移，请 R3-F1 裁决是否改立法）；② `ui/components/ImpactOverlay.ts:2-3` 仍 type-only import vfx（白名单未允许 ui→vfx）；③ import-graph lint 仍未写 |
| I-03 配表驱动、无硬编码副本 | 🔴 | **维持违反，但违反面收窄**。已修：ID 三套并存已终结——combat 主键即 `data/*.json` 主键且有自检把关（「tower/upgrade/enemy ids are data/*.json primary keys」PASS），塔本体造价 TS 与 JSON 八座全一致。仍违反：`src/combat/data/towers.ts` 等仍是整套 TS 数值字面量副本，且**升级价 14 项中 10 项与 JSON 分叉**（实测对照：up_mg_ap 120↔110、up_tar_wide 120↔100、up_breaker_shockwave 150↔130、up_breaker_fastcycle 120↔140、up_cond_dualnozzle 150↔130、up_flame_longburn 100↔130、up_flame_range 130↔120、up_tesla_coolrun 130↔150、up_cap_longsurge 140↔120、up_cap_halfheat 110↔130）。恰是 R3-F3/O3 的派工靶子；无奇偶校验测试兜底 |
| I-04 构建产物不入库 | 🟢 | `git ls-files` 过滤 node_modules/dist 零命中。维持绿 |
| I-05 分支纪律 | 🟢 | `main` 仍仅 1 条 Initial commit（`56b7a5f`），全部工作在 `agent/last-watt` 及 `cursor/*` 子分支。维持绿 |

---

## F. 证据复现命令（本报告全部实测于 `4f6c4b2`，Node v22）

```bash
cd games/last-watt && npm ci

# 规则测试（真模块，81 条）：79 过 / 2 失败（均为测试侧过期断言，见注 2）
npm test

# 全量类型检查：0 错误
npx tsc --noEmit

# vfx 无头自检：17/17（R2 为 13 条；新增引擎帧协议吃 timeScale、战斗事件桥等 4 条）
npm run selfcheck

# gameplay 无头自检：73 passed, 0 failed（R2 为 47 条）
npx esbuild src/gameplay/selfcheck.main.ts --bundle --platform=node \
  --format=esm --outfile=/tmp/gameplay-selfcheck.mjs && node /tmp/gameplay-selfcheck.mjs

# combat 无头自检：16 passed, 0 failed（含 data/*.json 主键奇偶、稳定信号唯一产者）
npx esbuild src/combat/selfcheck.run.ts --bundle --platform=node \
  --format=esm --outfile=/tmp/combat-selfcheck.mjs && node /tmp/combat-selfcheck.mjs

# bench：PASS；productionRuntimeVerified=true；场景仍为 waves-16-19（M3 剖面，待 R3-G2 更换）
node bench/run.mjs

# 可玩切片（人工）：npm run dev；控制台句柄 window.__lastWattGame
```

注 1：`npm test` 已把 73 条 gameplay 自检逐条注册为独立测试并全过，真模块冰碎阈值/涂层互斥/漏怪载荷都在其中。
注 2：2 个失败均为**测试文件自身过期**，不是游戏缺陷：`last-watt-rules.test.ts:22` 硬编码自检总数 47（现为 73）；`:149` 的漏怪期望表用了 4 个 R2 已废旧 id（`scurry_rats/armored_hauler/scout_bee/sapper_crab`，canonical 为 `swift_rat/armored_truck/scout_wasp/demo_sapper`）。修复归 R3-G1（合并后全测试链），顺带这正是 INTEGRATION §3.2「别名 R3 到期删除」的现身说法。

## G. Round 3 消缺清单（按拍板与工位对账）

| Round 3 拍板 | 本 HEAD 状态 | 工位 |
|---|---|---|
| 1. 重击塔优先冻结目标 | 未落（八座塔 `defaultStrategy` 全为 `first`） | R3-O3 |
| 2. 修冰碎 Bloom 糊白 | 未见修复痕迹，待复检 | R3-O4（R3-F2 复核） |
| 3. M1 门控：波 1–10 不解锁三塔；只扣分不丢区 | 两项均未落（S-02 🟡 / S-04 🔴） | R3-F3 + R3-O2 |
| 4. 冰碎/冻结/建造/开波最小音效 | 未落（audio 系统仍不存在，G-06 卡红主因） | R3-O4 |
| 5. 默认真实解锁表，`unlockAll` 仅开发热键 | 未落（默认仍 `unlockAll`） | R3-O1 |
| 6. 不再扩系统 | 遵守中（本轮无新系统接入迹象） | 全体 |

另两件不在拍板里但卡在验收路径上：① 测试链 2 处过期断言（R3-G1）；② G-09/G-10 的 5 人试玩要在门控+音效落地后的构建上组织，建议主调度把「谁来跑试玩、表格模板」在 R3 内定下来，否则这两条到终验必然还是红。

## H. 违反与裁决清单（不许带病过验收）

| 条目 | 内容 | 性质 | 处置 |
|---|---|---|---|
| S-04 | 丢区两档在切片内实跑，GDD §19 M1 明文「无丢区」 | 违反 | R3-O2 门控（已派工） |
| I-03 | combat TS 数值副本 + 升级价 10/14 分叉 | 违反 | R3-F3/O3（已派工） |
| S-02 | `unlock_schedule` 波 6/8/9 解锁 M1 外三塔、无门控字段 | 违反（面已收窄） | R3-F3 配表门控 + R3-O1 默认态 |
| G-03 | 「拆发电机→下游塔停转」与 SYSTEMS.md D11「常驻占用、超限只禁新建」冲突 | 立法冲突 | 请主调度裁决按哪边执行 |
| S-03 | 超载 VFX 已接线（M1 内不可触发） | 待确认 | 主调度一句话定性，避免终验翻案 |

> 一票否决红线四项现状：G-09 未试玩（等门控+音效构建）、V-03 立法+生产计数器已验但渲染态证据未闭合、S-01/S-05 范围回潮 🟢 干净、S-07 GDD 🟢 零改动。
