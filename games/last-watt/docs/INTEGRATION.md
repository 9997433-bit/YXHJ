# 《余电》Last Watt — R2 集成拍板（INTEGRATION.md）

> 责任代理：R2-F1（fable）。状态：**Round 2 拍板版，各 Owner 按 §4 动工**。
> 上游：`ARCHITECTURE.md`（R1-F1）、`SYSTEMS.md`（R1-F3）、各模块 README。
> 效力：与 ARCHITECTURE.md 冲突之处（tick 频率、ID、命令/事件形状），**以本文为准**；其余仍以 ARCHITECTURE.md 为准。

---

## 0. 主调度已拍板（不再讨论）

| # | 裁决 | 说明 |
|---|---|---|
| J1 | **运行时 = WebGL2（Three.js）** | 维持现状，`src/engine` 已按此实现，无需改动 |
| J2 | **逻辑 tick = 60 Hz**（`SIM.fixedDelta = 1/60`） | 引擎与 gameplay/vfx/bench 已是 60Hz；ARCHITECTURE.md 的 30Hz（D2、§5.2、§7.6、R5）作废，勘误见 §4.1-7 |
| J3 | **规范 ID 唯一来源 = `games/last-watt/data/*.json`** | 现存三套 ID（ARCHITECTURE 附录 B / `src/combat/data/*` / `data/*.json`）合并为配表这一套；注册表见 §3 |
| J4 | **起始金 = 220** | `data/game_state.defaults.json` 现值即准；SYSTEMS.md 决策 D1 的「教学期 100 金」冲突就此闭合，教学节拍由波次表调，不改起始金 |

---

## 1. 主循环时序（锁定）

### 1.1 帧结构（rAF 一帧内的顺序，`engine/core/Loop` 驱动）

```text
requestAnimationFrame
  ① 输入采集        DOM/HUD 输入 → PlayerCommand 入队（本帧不消费）
  ② 冲击时钟        impact = vfx.beginFrame(realDtMs)
                    loop.setTimeScale(impact.timeScale)   ← 顿帧冻结逻辑,不冻结渲染
  ③ 定步长追帧      while (accumulator ≥ 1/60 && steps < 5):
                        tick(1/60)                        ← 顺序见 §1.2
  ④ 表现插值        灰盒视图/血条按 alpha 插值；hud.update(hudState)
  ⑤ vfx.endFrame()  推进粒子时钟、循环发射器
  ⑥ post.render()   遮罩链前后 vfx.setMaskPass(true/false)，Bloom 只吃自发光
```

- `accumulator += frameDelta × timeScale`：顿帧期间 `timeScale = 0`，模拟静止；`RenderEvent.delta`、相机震动、粒子淡出照常走真实时钟（ARCHITECTURE §5.4 的立法不变，只是执行点从假想的 `Clock` 挪进 `Loop`）。
- `VfxSystem.beginFrame / endFrame` 的每帧协议（见 `src/vfx/VfxSystem.ts` 文件头）由 O1 在装配层执行，其他模块不得自行调用。

### 1.2 tick 内系统顺序（锁定，确定性依赖此序）

| 步 | 动作 | 归属 |
|---|---|---|
| 1 | 消费 PlayerCommand 队列（校验→执行/驳回） | sim.ts（O1）调 O2/O3 接口 |
| 2 | `world.tick(dt)`：施工计时、闸门/屏障/丢区事件、WaveRunner 出怪（发 `gameplay:wave_spawn`，sim 适配层就地调 `combat.spawnEnemy`，地面单位挂 `world.movement`，飞行单位挂 `straightLine + PolylineMovement`） | O2 |
| 3 | `combat.update(dt)`：敌人行为与移动、塔索敌开火、伤害+状态、反应表结算、死亡/漏怪 | O3 |
| 4 | 经济结算：赏金/漏怪扣金入账、供电占用校验、储能 `battery += 0.25 × 空闲供电点 × dt` | O2（economy） |
| 5 | 事件冲刷到总线（§2），组装 `HudState` / 快照 | sim.ts（O1） |

### 1.3 时间立法（闭合 ARCHITECTURE 风险 R5）

- 时间单位一律**秒**（浮点），tick 步长 `1/60`。
- 状态/施工/波次等**逻辑时长换 tick 一律向上取整**：湿冷 0.5s/层 = 30 tick、冻结 2.0s = 120 tick、冻结免疫 3s = 180 tick。换算集中在各系统入口一处，禁止散落取整。
- **顿帧（60ms）属渲染时钟**，走 `ImpactDirector`，不参与 tick 取整；60Hz 下无 ±1 tick 漂移问题。
- 任何系统不得硬编码步长（写 `1/30`、`1/60` 字面量即违规），一律用传入的 `dt`。

---

## 2. Command / Event 总线（锁定）

### 2.1 现状与裁决

四个模块各有一套局部事件机制（engine `Signal`、gameplay `GameplayEvents`、combat `CombatEventBus`、ui `HudCallbacks`、vfx `VfxSystem` 门面方法），**全部保留**。集成层新增两件由 O1 在 `src/sim.ts` 落地的东西：

1. **CommandQueue** —— 视图层写入 Sim 的唯一通道；
2. **GameEventHub** —— 跨模块订阅的唯一表面，把局部总线的事件按命名空间转发。

局部总线仍可在模块内部自用；**跨模块只许订 Hub、只许发 Command**。

### 2.2 PlayerCommand（canonical，替代 ARCHITECTURE 附录 B 同名类型）

```ts
type PlayerCommand =
  | { kind: "build_tower"; defId: TowerId; cell: CellCoord }      // defId 用 §3.1 canonical id
  | { kind: "sell_tower"; towerUid: number }
  | { kind: "upgrade_tower"; towerUid: number; upgradeId: string } // 改动：附录 B 的 branch 0|1 → upgradeId（up_*）
  | { kind: "set_priority"; towerUid: number; priority: "first" | "strongest" | "air" }
  | { kind: "dig"; cell: CellCoord }
  | { kind: "bridge"; cell: CellCoord }                            // M2
  | { kind: "start_wave"; early: boolean }
  | { kind: "repair_core" }                                        // M2
  | { kind: "capacitor_overload"; towerUid: number }               // M2
  | { kind: "fire_ultimate" };                                     // M2
```

- 来源：HUD（`HudCallbacks` 由 sim 适配成命令）与指针拾取（`engine/input`）。
- 消费点：§1.2 第 1 步，tick 边界统一消费；帧中段入队的命令下一 tick 才生效。
- 非法命令不抛错，广播 `sim:command_rejected { command, reason }`；UI 驳回音效/红闪只听这条。

### 2.3 GameEventHub 命名空间

主题名 = `"<模块>:<事件名>"`，事件名与各局部总线**原名一致**，负载原样转发：

| 命名空间 | 来源 | 事件清单 |
|---|---|---|
| `gameplay:*` | `GameplayEventMap`（`src/gameplay/events.ts`） | terrain_changed、flow_field_rebuilt、engineering_*、bridge_destroyed、gate_opened、zone_lost、barrier_opened、wave_started、wave_spawn、wave_spawning_complete、wave_cleared、run_complete |
| `combat:*` | `CombatEventMap`（`src/combat/events.ts`） | enemy_*、status_*、reaction_triggered、combo_first_seen、tower_*、chain_arc、cell_coating_changed、bridge_destroyed、ability_master_overload |
| `sim:*` | sim.ts 自有 | command_rejected、gold_changed、power_changed、battery_changed、integrity_changed、phase_changed、game_over、victory |

命名空间顺带消歧了唯一撞名：`combat:bridge_destroyed`（工兵**意图**炸桥）与 `gameplay:bridge_destroyed`（地形**已改**）。两条都保留，语义如上。

### 2.4 关键接线表（sim.ts 适配层的职责清单）

| 事件 | 消费方 | 动作 |
|---|---|---|
| `gameplay:wave_spawn` | sim → combat | 按 SpawnRequest 调 `combat.spawnEnemy`（canonical id、乘区、移动驱动） |
| `combat:enemy_killed` | economy / vfx / audio | 入账赏金；死亡溶解 + 金币飞行流 |
| `combat:enemy_leaked` | gameplay(integrity) / economy / ui | 扣完整度、抢 10 金演出；`lossOnLeak=true` 直接 game_over |
| `combat:bridge_destroyed` | sim → `world.destroyBridge(cx,cy)` | 地形改回沟壑 → 触发 `gameplay:terrain_changed` → flow field 懒重算 |
| `combat:reaction_triggered` | vfx / audio | 按负载里的 `ImpactSpec`（fx/sfx/hitstop/flash/shake）走绑定表（§4.4-4） |
| `combat:combo_first_seen` | ui | ComboToast 提示条（canonical ComboId，§3.6） |
| `combat:cell_coating_changed` | vfx / 灰盒视图 | 油渍/火场贴花与格子表现 |
| `gameplay:engineering_*` | ui / vfx | 按钮态、施工进度环、沟壑塌陷尘土 |
| `sim:command_rejected` | ui / audio | 驳回反馈 |
| `sim:gold/power/battery/integrity_changed` | ui | 资源纵列刷新 |

---

## 3. JSON ID 注册表（canonical = `games/last-watt/data/*.json`）

**总则**：配表、跨模块事件负载、命令、测试断言、UI 状态字段，一律用本节 canonical id。模块内部枚举（如 gameplay 的 `TerrainName`）允许存在，但必须经**单向翻译层**（如 `TERRAIN_NAME_ALIASES`、`ENEMY_ID_ALIASES`）进出，且翻译层只许消化旧名、只许吐出 canonical。**兼容别名只保留本轮（R2），R3 起删除**。

配表文件清单（canonical 路径）：
`data/towers.json`（升级 up_* 内嵌于此，**不设** upgrades.json）· `data/enemies.json` · `data/reactions.json` · `data/game_state.defaults.json` · `data/waves.map1.json`（波次表按 `waves.<地图短名>.json` 命名）· `data/maps/map1.json` · `data/audio-events.json`（待建，M1 音频落位时由 F3 建）。

### 3.1 塔（8）

| canonical | 中文 | 旧 combat id（`src/combat/data/towers.ts`） | 旧附录 B id |
|---|---|---|---|
| `mg_rivet` | 铆钉机枪 | `rivet_mg` | `rivet_gun` |
| `tar_sprayer` | 焦油喷洒器 | （同） | （同） |
| `hydraulic_breaker` | 液压破碎锤 | `hydraulic_hammer` | `hydraulic_crusher` |
| `condenser_jet` | 冷凝喷射塔 | `condenser` | `condenser` |
| `flame_thrower` | 火焰喷射塔 | `flamethrower` | `flamethrower` |
| `tesla_coil` | 特斯拉线圈 | （同） | （同） |
| `capacitor_station` | 电容站 | （同） | `capacitor` |
| `generator` | 发电机 | （同） | （同） |

### 3.2 敌人（8）

| canonical | 中文 | 旧 combat id（`src/combat/data/enemies.ts`） | 旧附录 B id |
|---|---|---|---|
| `scavenger_bug` | 拾荒虫 | （同） | `scavenger` |
| `swift_rat` | 疾行鼠群 | `scurry_rats` | `rat_swarm` |
| `armored_truck` | 装甲运输车 | `armored_hauler` | `armored_hauler` |
| `scout_wasp` | 侦察蜂 | `scout_bee` | （同） |
| `demo_sapper` | 爆破工兵/拆迁蟹 | `sapper_crab` | `blast_sapper` |
| `repair_drone` | 修理无人机 | （同） | （同） |
| `repair_mothership` | 修理母舰 | （同） | （同） |
| `leviathan` | 利维坦 | （同） | （同） |

gameplay 首稿短名（`scavenger`/`sprinter`/`hauler`/`demolisher`/`mothership`，见 `waves/enemyMeta.ts`）属旧名，经 `ENEMY_ID_ALIASES` 消化，本轮后删除。

### 3.3 升级（14，内嵌 `data/towers.json`）

| canonical | 旧 combat id | | canonical | 旧 combat id |
|---|---|---|---|---|
| `up_mg_twin` | `mg_twin_link` | | `up_flame_longburn` | `flamer_long_burn` |
| `up_mg_ap` | `mg_armor_piercing` | | `up_flame_range` | `flamer_extended_range` |
| `up_tar_sticky` | `tar_viscous` | | `up_tesla_chain5` | `tesla_five_jumps` |
| `up_tar_wide` | `tar_wide_nozzle` | | `up_tesla_coolrun` | `tesla_heat_sink` |
| `up_breaker_shockwave` | `hammer_shockwave` | | `up_cap_longsurge` | `capacitor_long_overload` |
| `up_breaker_fastcycle` | `hammer_rapid_cycle` | | `up_cap_halfheat` | `capacitor_heat_sink` |
| `up_cond_deepfreeze` | `condenser_deep_freeze` | | `up_cond_dualnozzle` | `condenser_dual_nozzle` |

### 3.4 状态标签 / 计数器（`data/reactions.json` status_model）

| canonical | 槽位 | 旧 combat id（`src/combat/data/statuses.ts`） | 旧附录 B id |
|---|---|---|---|
| `wet` | 涂层 | （同） | （同） |
| `oil` | 涂层 | （同） | （同） |
| `frozen` | 反应态 | （同） | （同） |
| `burning` | 反应态 | （同） | （同，附录 B 无 stacks 语义） |
| `wet_cold` | 计数器（0–3 层） | `chilled` | `chill` |
| `freeze_immunity` | 计数器（3s） | `chill_immune` | （附录 B 未收录） |

combat 独有、JSON 未收录的三个实现态**就地登记为 canonical 新增**（F3 下轮补进 reactions.json status_model）：`slowed`（减速）、`stunned`（大招 EMP）、`armor_broken`（利维坦装甲板）。

### 3.5 反应表行

canonical 行 id（`data/reactions.json`）与 combat 同名行**已一致**：`ice_shatter`、`fire_thaw`、`oil_ignite`、`conduct`、`overload`——不改。

combat 拆出的实现子行**保名登记**（对应 JSON 中的散落条目，不要求 F3 拆表）：

| combat 行 id | 对应 JSON 位置 |
|---|---|
| `chill_to_freeze` | `status_model.counters.wet_cold.on_full` |
| `oil_cell_ignites` | `reactions.oil_ignite.cell_variant` |
| `fire_field_burns` | `status_model.cell_coatings.fire_cell.on_enemy_on_cell` |
| `oil_cell_coats` | `status_model.cell_coatings.oil_cell.on_enemy_on_cell` |
| `puddle_wets` | `status_model.coating_slot.types.wet.sources`（水洼） |
| `leviathan_plate_break` | `reactions.ice_shatter.boss_overrides` |
| `master_overload` | `game_state.defaults.json rules.ability_master_overload` |

### 3.6 combo 与激活

- **ComboId（canonical）**：`shatter` · `oil_fire` · `conduct` · `overload`（combat 与附录 B 已一致）。
  **UI 旧 id 改名**：`ice-shatter` → `shatter`、`oil-fire` → `oil_fire`（`src/ui/components/ComboToast.ts`）。
- **激活 id（canonical，JSON 无独立字段，按 combat 现值登记）**：`capacitor_overload`、`master_overload`。
- **索敌优先级（canonical）**：`first` | `strongest` | `air`。combat `TargetStrategy` 与 ui `TargetPriority` 已一致；附录 B 旧 `air_first` → `air`。

### 3.7 地形与格子

- **地形（canonical = `data/maps/*.json` legend）**：`wasteland` · `foundation` · `road` · `diggable_road` · `soft_earth` · `gully` · `puddle_road` · `locked_road` · `event_sealed` · `core`；运行期新增地形 `bridge`（搭桥产物，带 `is_player_bridge` 语义）。
  附录 B 旧名：`ravine` → `gully`、`water_surface` → `puddle_road`。gameplay 内部 `TerrainName` 是实现枚举，经 `TERRAIN_NAME_ALIASES` 单向翻译，允许保留；对外事件里的地形字段一律 canonical 名（§4.2-2）。
- **格子涂层枚举（canonical）**：`none` | `oil` | `fire`（combat `CellCoating` 现值）。reactions.json 里的 `oil_cell`/`fire_cell` 是**小节名**不是枚举值；其中 `set_cell_coating.coating: "fire_cell"` 一处归一化为 `fire`（F3 顺手改）。
- **地图/出怪口 id**：`map1_main_plant`；`gate_1`、`gate_1b`、`gate_2`。

### 3.8 表现 id（fx / sfx / tip）

combat 反应行 `ImpactSpec` 里现存的 `fx_*` / `sfx_*` / `tip_*` 字符串（fx_shatter、fx_freeze_shell、fx_thaw_steam、fx_ignite、fx_fire_field、fx_oil_step、fx_wet_splash、fx_conduct_arc、fx_overload_ring、fx_master_overload_wave、fx_plate_break 及对应 sfx/tip）即日起冻结为注册表条目：O3 新增必须先在本表登记，O4 的绑定表（§4.4-4）按这些 id 找播放函数，音频事件表（`data/audio-events.json`）按 `sfx_*` 对齐。

---

## 4. O1–O4 必改接口清单

> 通用纪律：只改自己目录；本节未列出的接口不动；改名后**在模块内保留一轮旧名别名导出**（标 `@deprecated R2`），R3 删。

### 4.1 O1（engine + 装配）

1. **`engine/core/Loop.ts`**：新增 `setTimeScale(scale: number)` —— 只作用于 accumulator 进账（§1.1②），`RenderEvent.delta/elapsed` 不受影响。
2. **新建 `src/sim.ts`**：CommandQueue + GameEventHub（§2）+ §1.2 tick 调度 + §2.4 接线表。只装配，不写玩法 if-else。
3. **新建 `src/main.ts` / 改 `engine/boot.ts`**：按 §1.1 帧结构接 `vfx.beginFrame/endFrame`、`hud.update`；`Engine.onFixedUpdate` 挂 sim.tick。
4. **落地 `src/engine/contracts/`**：canonical id 联合类型（§3 全量）、`PlayerCommand`、Hub 主题类型；附录 B 旧 id 不落盘。
5. **`engine/assets`（新建）**：加载 §3 清单里的 6 个 JSON；起始金 220、供电上限 8、储能上限 100 一律读 `game_state.defaults.json`，禁止硬编码。
6. **`engine/postfx/PostPipeline`**：遮罩链渲染前后调 `vfx.setMaskPass(true/false)`（`bloomMaskCompat` 已备好适配面）。
7. **勘误回写**：`ARCHITECTURE.md` 30Hz 相关条目（D2、§5.2、§7.6、R5）与附录 B ID 加「以 INTEGRATION.md 为准」注记；`window.__lastWatt.metrics`（§7.5 字段）随装配落地。

### 4.2 O2（gameplay）

1. **`waves/enemyMeta.ts`**：`ENEMY_IDS` 的值改为 §3.2 canonical（`swift_rat`/`armored_truck`/`scout_wasp`/`demo_sapper`…）；旧 combat id（`scurry_rats` 等）移入 `ENEMY_ID_ALIASES` 保一轮。`wave_spawn.enemy` 从此只发 canonical id。
2. **`events.ts`**：`engineering_completed.terrain` 负载从内部 `TerrainName` 改为 canonical 地形名（§3.7），或加 `canonicalTerrain` 字段——跨模块负载不得泄漏内部枚举。
3. **`gameplay/economy/`（新建，ARCHITECTURE §3 既定落位）**：钱包（init 读 defaults，220）、供电占用校验、储能充能（`0.25 × 空闲供电点 × dt`）、卖出返还 `floor(0.7×投入)`；实现 combat 的 `PowerSupply` 端口（`tryConsumeBattery`/`battery`）；对 sim.ts 暴露 `EconomyApi`（gold 读取、tryDebit/credit、powerUsed/Cap、battery）。
4. **`world.ts`**：公开 `applyIntegrity(delta, reason)` 与 `destroyBridge(cx, cy)` 两个钩子（供 §2.4 桥接 `combat:enemy_leaked` / `combat:bridge_destroyed`）；`tick(dt)` 不得内含步长假设。
5. **完整度归属确认**：integrity 数值、80/50 阈值丢区、Game Over 判定在 gameplay（`integrity/`+`session/`），消费 combat 事件，不反向调用 combat。

### 4.3 O3（combat）

1. **`data/towers.ts` / `enemies.ts` / `upgrades.ts` / `statuses.ts`**：id 全量改 §3.1–§3.4 canonical；`chilled`→`wet_cold`、`chill_immune`→`freeze_immunity`，反应行/条件/效果与 `scenarios.ts` 里的 status 引用同步。TS 内置表降级为无头测试 fallback，id 必须与 canonical 一致。
2. **`ContentRegistry`**：新增从 `data/towers.json`/`enemies.json`/`reactions.json` 导入的入口（schema 字段翻译允许，**id 不许翻译**）——数值以配表为准，TS 表只兜底。
3. **`events.ts`**：`enemy_spawned` 负载增加 `gateId`（从 SpawnRequest 透传，vfx/ui 出怪演出需要）；其余事件形状不动，defId 随 §4.3-1 改名自动变 canonical。
4. **`combatSystem.ts` / `status/`**：状态时长「秒 → tick 向上取整」立法在一处集中实现（§1.3）；`update(dt)` 以 dt 驱动，无隐藏步长。
5. **`ImpactSpec`**：fx/sfx/tip id 冻结（§3.8），新增先登记后使用。

### 4.4 O4（vfx + ui）

1. **`ui/components/ComboToast.ts`**：`ComboId` 改 canonical（`shatter | oil_fire | conduct | overload`），展示文案映射内部消化。
2. **`ui/hudState.ts`**：`BuildItemState.id`、`selectedBuildId`、`TowerUpgradeOption.id` 用 canonical id（`mg_rivet`、`up_*`…）；`TowerInspectState.towerId: string` 拆为 `towerUid: number`（实例）+ `defId: string`（canonical 定义）；`HudCallbacks.onUpgrade/onSell/onOverload/onTargetPriority` 第一参数同步改 `towerUid: number`。`TargetPriority` 维持 `first|strongest|air`（已是 canonical）。
3. **`HudCallbacks` 语义锁定**：回调即「发 PlayerCommand」，由 sim.ts 适配为 §2.2 命令；HUD 不得直改任何游戏状态（现状已满足，明文锁定）。
4. **`vfx/bindings`（新建，ARCHITECTURE §3 既定落位）**：声明式绑定表——Hub 主题 + `ImpactSpec` 的 fx id → `effects.ts` 播放函数（`fx_shatter`→`playIceShatter`、`fx_freeze_shell`→`playFreeze`、`fx_overload_ring`→`playOverloadStart`…），并标注 `VfxPriority`；未登记 id 一律 no-op + dev 告警，不许 throw。
5. **`vfx/VfxSystem`**：每帧协议不变，由 O1 驱动（§1.1）；`endFrame` 的 `1/60` 兜底与 J2 一致，无需改。`vfx/events.ts` 的 kebab-case 事件名（`ice-shatter` 等）属模块内部 API，允许保留，但绑定表对外键一律用 §3.8 的 `fx_*` id。
6. **坐标换算**：ui/vfx 的格 ↔ 世界换算只经 `@engine` 的 `cellToWorld`，不得自算（含 `Vec3Like` 的构造点）。

---

## 5. 验收钩子（G1/G2 参照）

1. **ID 扫描**：G1 加静态测试——`src/**` 与 `data/**` 中不得再出现 §3 各表「旧 id」列的字符串（`@deprecated` 别名导出行除外，R3 连别名一起删）。
2. **时钟扫描**：`src/gameplay/**`、`src/combat/**` 中不得出现 `1/30` 或 `1 / 30` 字面量；`SIM.fixedDelta` 是唯一步长来源。
3. **总线契约**：同种子 + 同命令序列（含 tick 编号）⇒ 同事件序列与同快照（ARCHITECTURE §5.5 不变，在 60Hz 下复验）。
4. **起始金**：无头启动一局，`gold === 220` 且来源为 `game_state.defaults.json`（改 JSON 值重跑必须跟着变）。

---

*本文为 Round 2 拍板版。§3 注册表的任何增删改，先改本文，再改代码与配表。*
