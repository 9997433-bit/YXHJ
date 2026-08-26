# 《余电》Last Watt — Round 2 验收现状红黄绿（R2-F4）

- **责任人**：R2-F4（fable 验收/审计代理）
- **依据**：`games/last-watt/docs/ACCEPTANCE.md`（33 条 M1 验收，本文件逐条对照）
- **被审对象**：`agent/last-watt` @ `e593fa2`（Round 2 开工时的合流基线）
- **性质**：这是**现状快照**，不是 M1 正式验收（正式验收留档走 `docs/audit/m1-<日期>/`，签核走 ACCEPTANCE.md 末尾）。ACCEPTANCE.md 本体零改动。

## 0. 颜色判定规则

| 颜色 | 含义 |
|---|---|
| 🟢 绿 | 现状已满足该条通过标准，且有可复核证据 |
| 🟡 黄 | 模块级已实现/部分满足，但未接线成局、证据链不完整、或测法尚未按验收要求落地 |
| 🔴 红 | 未开工、关键实现缺失、或现状**违反**该条标准（违反项在备注中明示） |

**总计：🟢 7 / 🟡 15 / 🔴 11（共 33 条）。**
分组：玩法 G 🟢0 🟡7 🔴4 ｜ 视觉 V 🟢0 🟡5 🔴1 ｜ 性能 P 🟢0 🟡1 🔴3 ｜ 范围锁 S 🟢4 🟡1 🔴2 ｜ 工程卫生 I 🟢3 🟡1 🔴1。

**一句话诊断**：四个模块各自无头达标（tests 12/12、gameplay 自检 47/47、vfx 自检 13/13、combat 冰碎探针可跑），但**没有任何一条 G/V/P 能在"可玩的一局游戏"里取证**——主循环接线（R2-O1）是全部黄转绿的前置；另有 3 处现状**违反**范围/卫生标准（S-02、S-04、I-03），需本轮修复或主调度裁决。

---

## A. 玩法（G-01 ~ G-11）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| G-01 整局可玩通 | 🔴 | 主循环未接线：`src/engine/boot.ts` 只装配 `Engine + DebugHud`，不 import gameplay/combat/vfx/ui（`rg "gameplay|combat" src/engine/` 零命中）。无脚本化整局回放。gameplay 自检末项「authored map and wave table run together end to end」只验波次推进，无战斗无胜负结算。证据：`src/engine/boot.ts:36-38`；`.agent_workspace/PROGRESS.md` Round 1 遗留第 1 条 |
| G-02 四塔+发电机可建造且生效 | 🟡 | combat 有 `buildTower`（`src/combat/combatSystem.ts:169`）与全塔定义（`src/combat/data/towers.ts`），供电/攻击行为无头可跑；gameplay 有占格与可建性（`src/gameplay/grid/Grid.ts`）。缺：扣费闭环（无 `gameplay/economy/`，ARCHITECTURE.md §5.1 系统 6 落位为空）、非法位置拒绝的逐塔单测——`tests/last-watt-rules.test.mjs` 仍打 `tests/fixtures/rules-mock.mjs` |
| G-03 电力双层生效 | 🟡 | combat 侧门控齐：`tower.powered` 缺电即停（`src/combat/combatSystem.ts:1112`）、`setTowerPowered`（`:198`）、建塔时读 `terrain.isPowered`（`:172`）。缺：发电机→下游塔的供电网络本体（「拆发电机后下游塔立即停转」无实现方），断电/复电/拆机三场景单测未写 |
| G-04 冰碎规则正确 | 🟡 | 真模块无头探针全链通过：chill→freeze→shatter、无视护甲、溅射击杀、冻结后 chill 被免疫挡住（`src/combat/scenarios.ts` 的 `runIceShatterProbe()` 实测输出 `chillBlockedAfterFreeze: true`）。3s 免疫立法在 `src/combat/data/tuning.ts:22`（`CHILL_IMMUNITY_DURATION = 3`）+ `src/combat/data/statuses.ts:87`。缺：2.9s/3.1s 边界用例（验收原文要求）未进 `tests/**`，现测试仍是 mock |
| G-05 涂层/状态互斥 | 🟡 | 真模块 `src/combat/status/statusSet.ts` 实现互斥/免疫/覆盖；mock 测试 11、12 覆盖油↔湿互相覆盖（`tests/last-watt-rules.test.mjs`，12/12 过）。缺：对真模块的 M1 状态组合穷举测试 |
| G-06 冰碎首触发反馈链完整 | 🔴 | 五事件盘点：粒子 ✅（vfx 自检「冰碎四件套齐发」PASS）、顿帧 ✅（`src/vfx/ImpactDirector.ts:65-68`，60ms）、提示条 ✅（combat 发 `combo_first_seen`，`src/combat/events.ts:100`；UI 有 `src/ui/components/ComboToast.ts`）、**慢放 ❌ 无实现**（timeScale 仅 0/1 顿帧，无慢放斜坡）、**音效 ❌ 整个 audio 系统不存在**（`rg -i "audio" src/` 仅类型字段 `ImpactSpec.sfx` 声明）。且 combat→vfx 事件未接线、引擎不吃 `vfx.beginFrame().timeScale`（`rg timeScale src/engine/` 零命中）。两事件缺失 + 零接线 → 红 |
| G-07 挖沟可用且寻路正确 | 🟡 | gameplay 自检 47/47 过，覆盖挖堵拒绝、改路即时重算、施工期通行、拆桥回退（`src/gameplay/selfcheck.ts`，运行输出见 §F 复现命令）；mock 测试另覆盖合法/非法挖沟。缺：接入可玩局后的「敌人不穿沟不卡死」实证与非法提示 UI |
| G-08 完整度扣分正确 | 🟡 | combat 发 `enemy_leaked`（含 `integrityDamage`，`src/combat/events.ts:56`）；mock 测试 10「integrity floors at zero」过。缺：完整度归属系统未接线、结算界面不存在；且丢区逻辑已介入完整度链路（见 S-04 🔴，与「丢区逻辑完全不介入」直接冲突） |
| G-09 教学试玩达标 | 🔴 | 无可玩构建，5 人试玩无法进行；试玩记录表/复述问答零留档。教学节拍数据已备（`data/waves.map1.json` 的 `unlock_schedule` 带 `teach` 文案、`data/maps/map1.json` 的 `tutorial_hints`），仅是素材非证据 |
| G-10 挖沟被主动使用 | 🔴 | 同 G-09 无法试玩；且「教学赠送 vs 主动」埋点计数未实现（`rg -i "telemetry|埋点" src/` 零命中） |
| G-11 确定性回放 | 🟡 | 逻辑层无随机源：`Math.random` 全源码仅 1 处且在表现层（`src/vfx/effects.ts:154` 粒子旋转）；波表/反应表纯确定性推进。缺：固定种子回放 harness 与「两遍 diff 关键指标」设施，验收测法完全未落地 |

## B. 视觉（V-01 ~ V-06）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| V-01 非扁平 2D 贴图塔防 | 🟡 | 引擎是真 3D：斜俯视相机（`src/engine/core/CameraRig.ts`）、实时光照（`src/engine/scene/Lighting.ts`）、指数雾 + 锈铁体积网格（`src/engine/Engine.ts:61-65`、`src/engine/grid/GridView.ts`）、Bloom 后处理（`src/engine/postfx/`）。缺：塔/敌人实体渲染完全不存在（场上只有地形 + `EmissiveTestbed`），「体积感与可读剪影」无从目检；多角度截图未留档 |
| V-02 粒子是玩法语言 | 🟡 | 专属色+形状冗余编码已立法并实现：色板 `src/vfx/palette.ts`（冰/油/警红分色）、形状图集 `src/vfx/atlas.ts`（硬边碎片=冰、尖刺=电、圆斑=油，注释明示色弱冗余）、冻结/碎裂/焦油特效在 `src/vfx/effects.ts`。缺：「每状态有绑定 VFX」存在性自动断言未写，combat 状态事件→vfx 未接线，人工可辨性目检没做 |
| V-03 事件粒子永不降级 | 🟡 | 立法完备：`src/vfx/budget.ts:6-7`「事件与 combo 粒子永不降级」，降级阶梯只砍环境/循环/贴花/点光（`DegradeLevel` 枚举顺序写死）；vfx 自检「压力：60 秒混合大潮不突破任何预算」PASS；bench mock 报告 `protectedParticleDrops: 0`。缺：全部证据来自 mock/无头，未在真实渲染的 P-02 场景下断言（bench 自己声明「does not render GPU particles」）——红线条目，证据链必须闭合后才能转绿 |
| V-04 节流三规则接入 | 🟡 | 冲击节流：`src/vfx/ImpactDirector.ts:87-88` 顿帧 100ms 冷却，自检 PASS；循环 LOD：`src/vfx/budget.ts:23` `sameKindLoopThreshold=10` 减半发射率+隔帧更新，bench 报告 `framesWithSameTypeLoopLod` 有值；开关存在（`budget.autoDegrade`）。缺：「持续状态低粒子量」规则无独立开关与生效证据，切换前后粒子计数对比未留档 |
| V-05 供电/断电一眼可辨 | 🔴 | 塔在场景里没有任何渲染（见 V-01），供/断电可辨性无载体；对照截图零留档。vfx 侧仅有超载塔身发光占位（`src/vfx/effects.ts:320`），非供断电表达 |
| V-06 最小 HUD 正确 | 🟡 | 四项俱全：`src/ui/hudState.ts` 含 `gold`（:67）、`wave`（:68）、`power`（:75）、`integrity`（:87），组件齐（`ResourceRail`/`WaveHeader` 等），可在 vfx demo 里渲染。缺：无真实数据源（游戏未接线），「数据源与显示值一致」断言未写；小疵：波次默认总数 20（`hudState.ts:123`）应为 M1 的 10 |

## C. 性能（P-01 ~ P-04）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| P-01 60fps 恒定于参照机 | 🔴 | 无任何真实帧时采样；bench 自我声明「Node host CPU timing …must not be used as proof of 60fps」（`bench/run.mjs` 输出 notes）。顿帧的时间缩放机制在 vfx 已备（`VfxSystem.beginFrame` 返回 timeScale）但引擎未采纳（`rg timeScale src/engine/` 零命中），「顿帧不得表现为渲染掉帧」现状无法验证 |
| P-02 M1 压测场景不破线 | 🔴 | 压测场景与验收定义不符：现有场景是波 16–19 的 M3 mock（`bench/scenarios/waves-16-19.json`，含三火场+大招），验收要求「波 10 大潮 + 冰碎多次同帧触发」；且无帧时 p95 数据（mock 不渲染）。R2-G2 需换场景 + 接真计数 |
| P-03 粒子/发射器计数接口（记录项） | 🟡 | 运行时计数接口存在：`src/vfx/budget.ts:43-50` `BudgetSnapshot`（aliveParticles/loopEmitters/oneShotEmitters）；bench 报告含 peaks 字段（emitters/particles/dynamicPointLights 峰值及所在帧）。缺：基线数据来自 mock 而非真实渲染，「留档基线」尚不成立 |
| P-04 内存稳定 | 🔴 | bench 无堆采样代码（`rg -i "heap|memory" bench/` 零命中），连续两轮波 1–10 的 JS 堆对比完全未实现 |

## D. 范围锁（S-01 ~ S-07）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| S-01 无战斗英雄 | 🟢 | `rg -i "hero|英雄" src/` 仅命中 `src/combat/README.md` 两处「no hero / out of v1 scope」声明，无任何可操控英雄实体代码。老周语音零资产（M1 允许） |
| S-02 可建单位锁定 | 🔴 | **违反**。配表 8 项建造单位（`data/towers.json`：4 塔 + 发电机 + flame_thrower/tesla_coil/capacitor_station），且 `data/waves.map1.json` 的 `unlock_schedule` 在**波 6/8/9**（M1 波 1–10 范围内）解锁这 3 座 M1 外塔，无任何 M1 禁用态标记；`src/ui/components/BuildBar.ts:46,103` 把未解锁项渲染为**可见**的「图纸未解锁」按钮，违反「禁用态且 UI 不可见」。修复位：配表加 M1 门控 + BuildBar 隐藏（归 R2-F3 / O1） |
| S-03 combo 范围锁 | 🟢 | 人工审计资产与提交记录：`src/vfx/effects.ts` 仅冰碎有完整链（粒子+贴花+顿帧+白闪，自检 PASS），油/湿为 M1 涂层可读性所需，油火/导电无正式 VFX 投入（`atlas.ts` 尖刺形状仅是图集素材）。附注留裁决：`effects.ts:320` 超载电磁环**占位**属大招系统（M2）非 combo，建议主调度确认不算回潮 |
| S-04 无丢区 | 🔴 | **违反**「丢区两档零接入」。配置：`data/maps/map1.json` `zones` 两档（`lost_below_integrity: 80/50` + `on_lost` 断电/禁建）；代码：`src/gameplay/world.ts:180-200` `applyIntegrity()` 实打实执行丢区（断电变电区、开闸、发 `zone_lost`），gameplay 自检还专门验「losing zone B opens the floodgate short-cut」；UI：`ResourceRail` 画 80/50 丢区刻度（`src/ui/hudState.ts:130-133`）；规则表：`data/game_state.defaults.json` 含丢区停机塔占电。丢区属 v1 内（PROGRESS 范围锁）但 M1 外——需要 M1 门控（map1 的 M1 变体去 zones 或加禁用开关）或主调度对本条改判，二选一，不许默认带病过验收 |
| S-05 v1 外系统零接入 | 🟢 | `rg -i "无尽|endless|天气|weather" src/` 零代码命中（仅 GridView 注释里的英文单词 weathered）；英雄见 S-01。无尽/天气/英雄操控零接入成立 |
| S-06 内容范围锁 | 🟡 | 达标面：只有图 1（`data/maps/` 仅 `map1.json`），`data/waves.map1.json` 的 `waves` 数组恰好 10 波，无图 2/图 3 数据。渗入面：`src/gameplay/waves/baseWaveTable.ts` 是完整 20 波基表（含波 15 母舰、波 20 利维坦脚本），combat 有 `repair_mothership`/`leviathan` 敌人定义（`src/combat/data/enemies.ts:117,134`），bench 场景取名波 16–19，HUD 默认总波数 20。JSON 侧的 `waves_11_to_20` 仅 TODO 元数据可接受，但「波表枚举」断言按现状会数出 20 波——需要 M1 枚举断言把入口钉死在数据 JSON 的 1–10 |
| S-07 GDD 锁定裁决不可改 | 🟢 | `git log --follow -- docs/GDD-余电.md` 仅 1 条提交（`414048b` 首次加入），加入后零改动。**审计基线注记**：`main` 只有 Initial commit（GDD 本体在工作分支上），ACCEPTANCE 写的 `git diff main...HEAD` 会显示整文件新增——正式验收时按「自 `414048b` 起零 diff」执行，建议 R1-F4 签核时在留档中固化该解释 |

## E. 目录隔离与工程卫生（I-01 ~ I-05）

| 编号 | 状态 | 现状与证据 |
|---|---|---|
| I-01 变更路径白名单 | 🟢 | `git diff --name-only main...HEAD` 全量核对：除白名单三项（`games/last-watt/**`、`.agent_workspace/**`、`docs/premium-game-visual-prompts.md`）外仅多 `docs/GDD-余电.md` 本体（主调度轮前提交的设计正文，属基线定义问题，同 S-07 注记）。仓库根 README 与其余共享位零污染 |
| I-02 模块边界遵守 | 🟡 | 硬红线达标：gameplay/combat 不 import three、不碰 document/window（rg 实测零命中，ARCHITECTURE.md:178 红线）；combat 经 `ports.ts` 抽象地形，跨模块大方向干净。偏差：`src/ui/components/ImpactOverlay.ts:2-3` 直接 import `vfx/ImpactDirector`/`vfx/palette`（type-only，但 ARCHITECTURE.md:174 白名单未允许 ui→vfx）；架构规定的 `engine/contracts` 与 `sim.ts` 装配层未建；import-graph lint 未写（G1 应写的静态扫描测试缺位） |
| I-03 配表驱动、无硬编码副本 | 🔴 | **违反**「数值唯一来源为 data/**」。combat 侧存在整套 TS 配表副本：`src/combat/data/towers.ts` 硬编码 `cost: 50`、`damage: 10` 等全部数值，且 ID 与 JSON 分叉（TS `rivet_mg` vs `data/towers.json:18` `mg_rivet`）；enemies/reactions 同病。gameplay 侧已正确走 `src/gameplay/data/importers.ts` 读 JSON。这正是 Round 2 拍板第 3 条（规范 ID = data/*.json）的靶子，归 R2-F3 + R2-O3 |
| I-04 构建产物不入库 | 🟢 | `git ls-files | grep -E "node_modules|dist/"` 零命中；`games/last-watt/.gitignore` 覆盖 node_modules/dist/dist-ssr/.vite |
| I-05 分支纪律 | 🟢 | `main` 仅 1 条 Initial commit（`56b7a5f`），全部工作在 `agent/last-watt` 及其 `cursor/*` 子分支合流 |

---

## F. 证据复现命令（本报告全部实测于 `e593fa2`）

```bash
# 规则测试（mock）：12/12 过
cd games/last-watt/tests && node --test

# gameplay 无头自检：47 passed, 0 failed
cd games/last-watt && npx esbuild src/gameplay/selfcheck.main.ts --bundle --platform=node \
  --format=esm --outfile=/tmp/gameplay-selfcheck.mjs && node /tmp/gameplay-selfcheck.mjs

# vfx 无头自检：13/13 通过（含「冰碎四件套齐发」「60 秒混合大潮不破预算」）
npx esbuild src/vfx/selfcheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/check.cjs
node -e "const m=require('/tmp/check.cjs');const r=m.runSelfCheck();console.log(m.formatReport(r))"

# bench 预算探针（mock）：protectedParticleDrops = 0
node games/last-watt/bench/run.mjs

# combat 冰碎真模块探针（scenarios.ts 导出 runIceShatterProbe）实测关键值：
#   frozenAt=1.05s, shatteredAt=2.53s, ignoredArmor=true, splashKilled=true,
#   chillBlockedAfterFreeze=true, hitstopMs=60, tip="tip_shatter"

# 全量类型检查：0 错误
cd games/last-watt && npx tsc --noEmit
```

## G. Round 2 消缺优先级（按工位）

1. **R2-O1（主循环）**：G-01 是 15 个黄条的共同前置——engine 装配 gameplay+combat+vfx+ui、引擎采纳 `vfx.beginFrame().timeScale`（解 G-06 顿帧接线与 P-01 时间缩放前提）。
2. **R2-F3 + R2-O3（ID/配表）**：I-03 🔴 删 combat TS 数值副本、统一 `mg_rivet` 系 JSON 主键；顺手落 S-02 的 M1 门控字段。
3. **R2-O2（玩法接战斗）**：G-02/G-03 的扣费与供电网络闭环；S-04 丢区 M1 门控（或升级主调度裁决）。
4. **R2-G1（测试打真模块）**：G-04 边界用例（2.9s/3.1s）、G-05 穷举、S-02/S-06 配置断言、I-02 import-graph 静态扫描、G-11 回放 harness。
5. **R2-G2（bench 真计数）**：P-02 场景改「波 10 大潮 + 冰碎同帧」、V-03 在真实渲染下断言、P-04 堆采样补零。
6. **音效系统无主**：G-06 的「音效」事件在任何工位派工里都没有落位（`ImpactSpec.sfx` 只有类型字段）——请主调度在 Round 2/3 指派，否则 G-06 到 M1 必然卡红。

## H. 违反项清单（需修复或裁决，不许带病过验收）

| 条目 | 违反内容 | 建议处置 |
|---|---|---|
| S-02 | 波 6/8/9 解锁 M1 外三塔 + BuildBar 可见 | 配表加 M1 锁 + UI 隐藏（修复） |
| S-04 | 丢区两档已在 map/gameplay/UI 三层接入 | M1 门控禁用，或主调度改判本条（裁决） |
| I-03 | combat TS 配表副本 + ID 三套并存 | 按 Round 2 拍板第 3 条执行（修复，已派工） |

> 注：一票否决红线四项现状——G-09 未试玩（待主循环）、V-03 立法在但证据未闭合、S-01/S-03/S-05 范围回潮 🟢 干净、S-07 GDD 🟢 零改动。
