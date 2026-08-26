# 《余电》系统说明（程序向）v0.1

> 读者：实现 M1/M2 的程序员。本文把 `docs/GDD-余电.md`（v1.0，唯一正文）收敛成可直接编码的系统规格，并为 `games/last-watt/data/**` 配表提供字段语义。
> 冲突裁决顺序：GDD 正文 > 本文 > 配表 notes。本文与配表中标 **[补]** 的数值是 GDD 未给出的初稿，按此实现、由策划回调；不确定的设计裁决集中在 §12 决策记录。
> **范围**：v1 无英雄（GDD 附录 A 完全排除）；本稿数据覆盖 M1（图 1 波 1–10、4 塔+发电机、冰碎完整）并预铺 M2 字段。

---

## 0. 约定

- 单位：距离=格（欧氏，格中心到格中心），时间=秒，速度=格/秒。
- 坐标：`[x, y]`，x 0–19 西→东，y 0–11 北→南；`terrain_rows[y]` 是第 y 行的 20 字符串。
- id：全小写下划线，跨表引用一律用 id（塔 `mg_rivet`、敌人 `demo_sapper`、升级 `up_mg_twin`、Boss 相位 `p1_armor_plates`、出怪口 `gate_1`、事件 `wave5_breach`…）。**规范主键 = `data/*.json` 的 `id` 字段（Round 2 主调度拍板 3）**：代码侧禁止另立主键，只许只读别名映射指向这些 id（现行注册表见 `src/combat/data/ids.ts`，其 `LEGACY_*` 表只减不增）。
- 所有 JSON 带 `schema_version`；`notes` 字段仅供人读，运行时忽略。
- 逻辑为纯 2D 网格 + 固定步长 tick = **60Hz**（Round 2 主调度拍板 2，与现引擎一致；本稿的秒制时长换算为 tick 时向上取整）；表现层 3D 与本文无关。

## 1. 数据文件索引

| 文件 | 内容 | GDD 出处 |
|---|---|---|
| `data/towers.json` | TowerDef ×8（7 塔 + 发电机），含二选一升级 | §7.1 §7.3 |
| `data/enemies.json` | EnemyDef ×8（3 基础 + 飞/拆/疗 + 双 Boss 含三阶段） | §8 |
| `data/reactions.json` | 状态模型（涂层/反应态/计数器）+ 4 combo + 反 combo「冰火不容」 | §7.2 §7.3 |
| `data/maps/map1.json` | 图 1「主厂房」20×12 灰盒：地形、出怪口、事件格、变电区、工程配额 | §5 §10 §11 |
| `data/waves.map1.json` | 图 1 波 1–10 + 图纸解锁时刻表（波 11–20 TODO M2） | §11 §12 §8.3 |
| `data/game_state.defaults.json` | GameState 默认值 + 全局经济/电力/胜负常量 | §6 §9 §10 §17.1 |

## 2. 网格、地形与工程

### 2.1 格子模型

```text
Cell {
  terrain,                    // 见 map1.json legend（wasteland/foundation/road/diggable_road/
                              //   soft_earth/gully/puddle_road/locked_road/event_sealed/core）
  coating: none|oil|fire,     // 格子涂层 + 剩余时间（油渍 12s、火场 5s/8s）
  zone_id,                    // zone_main / zone_a / zone_b
  walkable, buildable,        // 由 terrain 派生，事件/工程会改写
  diggable, bridgeable,       // 同上
  is_player_bridge            // 搭桥产物标记，供爆破工兵炸桥判定
}
```

- 涂层规则（格子）：一格同时只有一种涂层；火焰扫过油渍格 → 油转火场；水洼格不可涂油（决策 D7）。
- 事件格：`event_sealed`（波 5 侧墙）与 `locked_road`（B 区闸门路）开启前**不可走、不可挖、不可建**；开启由 `MapDef.event_cells` 触发器驱动（`wave_start` / `integrity_below`），开启后按表转为 road / diggable_road，且立即触发寻路重算。

### 2.2 工程操作（挖沟/搭桥）

- 挖沟：`diggable=true` 的格（可挖路段 D、软土 S）→ 沟壑 G。花 50 金 + 1 次配额；施工 3s，**施工期间原通行性不变**，完工瞬间生效并重算寻路。
- 搭桥：`bridgeable=true` 的格（沟壑 G，含挖出来的）→ 路面，`is_player_bridge=true`。花 80 金 + 1 次配额，施工 3s（施工中不可走，完工才 walkable）。
- 组合技：软土可先挖成沟壑再搭桥 = 130 金自造 1 格新路（GDD §5.1 搭桥用途「给敌人开一条你想让它走的路」的资源基础）。
- 配额：图 1 挖 3 / 桥 2；波 5 教学赠送 1 次免费挖沟（不占配额不花钱，推荐格 `(5,5)` 高亮）；波 15 补发挖 1。见 `map1.json.engineering`。
- 爆破工兵炸桥：桥格变回沟壑，配额**不返还**；例外见决策 D6。

## 3. 寻路与合法性校验

- 地面敌人：从核心反向 BFS 生成 flow field，全体共享；邻接为 4 向 [补]，邻居扩展顺序固定 N→E→S→W 保证确定性。
- 重算触发（全量重算，GDD §5.1）：挖沟完工、搭桥完工、桥被炸、事件格开启（波 5 侧墙 / B 区闸门）、丢区开支路。
- 飞行敌人（`is_flying`）：出怪口直线飞核心，无视地形、涂层、flow field；只有 `targets_air=true` 的塔能索敌。
- **合法性规则**（工程按钮红/灰判定）：模拟该操作后，对**每个当前已激活或未来会激活**的出怪口（`active_from_wave` 未到的 gate_2 也算；`active_waves` 型临时口如 gate_1b 只在其活跃波计入）跑 BFS，到核心必须全部连通，否则禁止。
  - 推论 1：波 5 前挖 `(8,2)/(9,2)` 非法（会截断 gate_1 唯一通路）；支路开通后合法。
  - 推论 2：挖 `(5,10)/(6,10)` 仅在 `(7,8),(7,9)` 桥已架好时合法。
  - 这些都不需要特判，跑同一个校验即可。
- 敌人过格效果结算点：敌人**进入**格子时结算（水洼附湿 6s、油渍附油+减速、火场点燃）。

## 4. 经济与电力

### 4.1 金币

- 收入：击杀赏金（`enemies.json.bounty` × 赏金递减：波 11–15 ×0.8，波 16+ ×0.6，**替换不叠乘**）；波结束奖励 `wave_no × 5`；提前开波本波奖励 +10%。
- 支出：建塔/升级（`towers.json`）、发电机 100、挖沟 50、搭桥 80、波间修复 100 金 = +20 完整度（修不回已触发丢区）。
- 卖塔：返还 `floor(0.7 × (本体造价 + 已购升级价))`，供电占用即时释放。
- 漏怪：每只抢走 10 金（可扣到 0 为止）。

### 4.2 电力（两层）

- 供电上限 `power_cap`：基础 8 + 每台发电机 +6（图 3 裂隙相邻 +8）− 丢区扣减（A −4，B −6）。
- 占用 `power_used`：所有已建塔 `power_cost` 之和，**常驻**；停机/断电塔仍占用（决策 D11，配合 §6.3「逼你卖塔」）。
- 超上限（丢区导致 `power_used > power_cap`）：禁止新建耗电塔、禁止激活超载；已建塔照常运行。
- 储能 `battery`（0–100 基础）：每 tick `battery += max(0, power_cap − power_used) × 0.25/s × 电容充能乘区`；上限 = 100 + 30×电容站数；超载一次耗 20。

## 5. 塔系统

- 全部 1×1 占地，建在 `foundation` 格；建造即时（无施工时间，施工只属于工程操作）。
- 索敌策略（玩家可切，`target_strategy`）：`first`（默认，路径进度最深）/ `strongest`（当前 HP 最高）/ `air_first`（飞行优先，仅对空塔可选）。
- `attack_kind` 决定结算路径：
  - `single_hit`：机枪（唯一弹道，出膛锁定即命中 [补]）、破碎锤（即时）。**只有这类且单发 ≥40 能触发冰碎**。
  - `cone_status` / `cone_dot`：冷凝、火焰——锥内即时判定，每 tick 结算。火焰（`cone_dot`）命中锥内全体；冷凝（`cone_status`）每 tick 只喷 `simultaneous_targets` 个目标（基础 1，「双喷口」升级 2）。
  - `chain`：特斯拉——首目标 + 逐跳最近敌人（不重复命中），每跳 ×(1−0.30)；导电时见反应表。
  - `cell_coater`：焦油——不打敌人，只涂格子。
- 升级：二选一互斥、每塔一个，`overrides` 为**绝对值覆盖**、`flags` 为置真；`overrides` 键按叶字段名寻址——可命中嵌套字段（如 `slow_pct_while_on_cell`），也可引入基表未列的新字段（如 `splash_radius_cells`、`frozen_duration_s`，消费方为反应表）；无退款差价（卖塔按 70% 总价返还）。
- 停机状态（互相独立，任一为真即不攻击）：`overheat_timer`（超载后 3s/1.5s）、被爆破工兵自爆停机 10s、所在变电区已丢失（本局永久）。
- 电容站主动技（=combo「超载」）：见 `reactions.json.overload` 行；3×3 = 以电容站为中心的切比雪夫距离 ≤1。

## 6. 敌人系统

- 护甲：`damage_after_armor = max(1, hit_damage − armor_flat)`（保底 1，决策 D2）；碎裂与燃烧带 `ignore_armor`，跳过此步。UI 需求：护甲减免飘「−5」灰字（GDD §11 波 3）。
- 减速叠加：多来源减速**取最大值**不相乘（决策 D12）；`frozen` 直接速度 0 覆盖一切；利维坦 P3 免疫减速/冻结/湿冷累积。
- 行为（`behavior` + `behavior_params`，见 `enemies.json`）：
  - `walker`：沿 flow field。
  - `flyer`：直线飞核心。
  - `demolisher`（爆破工兵=拆迁蟹）：沿路走；自身 2 格内出现首个塔（含发电机/电容站）→ 自爆：塔停机 10s、自身死亡、**无赏金**（决策 D5）；踩到玩家桥 → 炸桥（决策 D6 的连通性保护除外）。
  - `healer`：光环每秒为 2 格内友军回 8 HP（不自疗）；头顶常驻扳手图标。
  - `boss_mothership`：healer 强化版（15/s），死亡在原地生成 4 台修理无人机。
  - `boss_leviathan`：三阶段状态机，阈值 50%/25% 单向切换，参数全在配表 `phases`；抵达核心 = 即时 Game Over（唯一例外）。
- 漏怪结算：抵达核心 → 扣 `integrity_damage`、抢 10 金、播报/演出、移除单位（不给赏金）。

## 7. 状态与反应系统（核心，含冰碎全流程）

### 7.1 敌人状态模型（`reactions.json.status_model`）

每个敌人：

- **涂层槽**（唯一）：`wet`(6s) / `oil`(6s)，后施加者覆盖前者。
- **反应态槽**（唯一，互斥互清）：`frozen`(2.0s，冷凝升级 2.5s，速度 0) / `burning`(8 dps × 4s，刷新不叠加，无视护甲)。
- **计数器**：`wet_cold` 层（0–3，单层 2s 无刷新衰减 1 层 [补]）；`freeze_immunity`（3s，期间湿冷不可累积、冻结不可施加；**不清除湿涂层**，导电不受影响）。

### 7.2 命中元数据契约

战斗系统每次伤害结算必须携带：`damage_type`（kinetic/fire/shock/none）、`attack_kind`（single_hit/cone_dot/chain/splash/none）、`base_damage_per_hit`（未过护甲/乘区的单发值）、`can_trigger_reactions`（衍生伤害置 false）、`source_tower_id`（读升级覆盖值）。**反应表只消费这些字段，不认塔的具体类型**——新塔进反应体系零代码。

### 7.3 伤害管线（唯一入口，伪代码）

```text
onHit(hit, target):
    row = matchReactionRow(hit, target)      # 按 reactions.json.evaluation_order 自上而下，命中即停
    if row == fire_thaw:                     # 火 × 冻：解冻 + 本次伤害 ×0.5
        removeReaction(target, frozen)       #   frozen.on_remove → freeze_immunity 3s
        hit.damage *= 0.5
    elif row == ice_shatter:                 # ★ 冰碎（见 7.4）
        executeShatter(hit, target);  return
    elif row == oil_ignite:                  # 火 × 油：施加/刷新燃烧（油涂层不消耗）
        applyReaction(target, burning)
    applyArmorThenDamage(hit, target)        # ignore_armor 则跳过护甲；保底 1
# conduct 不在 onHit：特斯拉发动攻击、锁定首目标时判定（见 7.5）
```

### 7.4 冰碎全流程（M1 验收核心）

**积累 → 冻结：**

1. 冷凝塔每 0.5s tick：锥内至多 `simultaneous_targets` 个目标（基础 1，「双喷口」升级 2）`wet_cold +1` 并附 `wet` 涂层 6s。
2. `wet_cold == 3` → 施加 `frozen`（时长 2.0s；来源塔带 `up_cond_deepfreeze` 则 2.5s），层数清零，速度 0，材质切冰壳。
3. `frozen` 被移除（自然到时 / 冰碎 / 火焰解冻，任何途径）→ 自动施加 `freeze_immunity` 3s，期间不可再叠湿冷、不可再冻（防无限冻）。

**触发判定（谓词，可直接翻译成代码）：**

```text
canShatter(hit, target) :=
      target.reaction == FROZEN
  and hit.attack_kind == SINGLE_HIT        # 溅射/DoT/链电不算
  and hit.base_damage_per_hit >= 40        # 原始单发值，不吃护甲/乘区修正
  and hit.can_trigger_reactions            # 冰碎溅射自身置 false，防连锁
```

**执行：**

```text
executeShatter(hit, target):
    dmg = hit.base_damage_per_hit * 2.5        # 利维坦 P1 改用 ×4.0（boss_overrides）
    dealTrue(target, dmg)                       # 无视护甲
    for e in enemiesWithinCells(target.pos, 1): # 1 格溅射，含飞行（决策 D3）
        dealTrue(e, dmg, can_trigger_reactions=false)
    removeReaction(target, frozen)              # → freeze_immunity 3s
    feedback(hitstop=60ms, flash=白闪1帧, sfx=玻璃碎裂, vfx=24粒冰晶+霜痕贴花3s)
    fireOneTimeTip("碎裂！冻结的敌人怕重击")
```

**v1 触发器盘点**（谁的单发 ≥40 且是 single_hit）：液压破碎锤 45 ✓（唯一常驻）；机枪 5/8 ✗；特斯拉 25 ✗；火焰 tick 2 ✗（且优先走 fire_thaw）；超载/大招翻倍的是**攻速**不是单发，不改变此集合 ✓——设计上冰碎必须由破碎锤打出，与 GDD §11 波 3 教学一致。

### 7.5 其余三 combo 要点

- **油火**：火伤害命中带油目标 → burning（刷新不叠加）；火焰锥扫过油渍格 → 火场 5s（升级 8s），过路敌人点燃。油涂层不消耗。
- **导电**：特斯拉锁定**首目标**瞬间查其 `wet` 涂层（决策 D8）：成立则整条链跳数 +2（3→5，链5跳升级→7）且衰减归零；表现为粗青电弧 + 全链同帧闪白。
- **超载**：玩家点电容站，`battery ≥ 20` 且未超电、自身未过热 → 3×3 内在线耗电塔攻速 ×2 持续 6s（升级 8s），随后过热停机 3s（升级 1.5s；特斯拉 `no_overheat_after_overload` 免疫过热）。
- 反应表评估顺序 `fire_thaw → ice_shatter → oil_ignite → conduct` 固定写死在数据里，运行时不得重排。

## 8. 波次系统

- `WaveDef.spawns[]` 各组并行：`start_delay_s` 后每 `interval_s` 从 `gate_id` 出 1 只 × `count`。
- 波间无限暂停，手动开波；提前开波 = 上一波结束、倒计时未走完即开（图 1 无自动倒计时，提前开波按钮常驻 [补]），本波结束奖励 ×1.10。
- 下一波预览 UI **直接聚合下一条 WaveDef**（图标×数量 + 对空/拆/疗高亮），不建第二份数据（GDD §17.2-3）。
- 图 2/3 复用同一份基础波表 × `MapDef.wave_multipliers`：`enemy_hp` 乘 HP；`weight_fly_heal`/`weight_demolisher` 乘对应类型 `count`（四舍五入，最少 1）；首登场波差异用各图 `first_appearance_waves` 对基础表做裁剪/替换。图 1 全 ×1.0，`waves.map1.json` 即最终值。
- 图纸解锁：`unlock_schedule`（wave + phase：deploy/start/end）驱动建造菜单可用性；教学演出（慢放、提示条、老周语音）由 `script_events` 引用 id，具体脚本属「教学触发表」（GDD §18.4），不在本稿范围。

## 9. 大招「主控过载」

- 充能：每**完成** 5 波 +1，上限存 2。
- 释放（全场、即时）：所有在线耗电塔按超载效果攻速 ×2 × 6s，**不耗储能、不过热**；全场敌人 EMP 停顿 1.5s（移动与行为暂停；DoT 照常走）。
- 与电容超载叠加：攻速乘区不叠乘，取最大（即同时生效仍是 ×2）[补，决策 D13]。
- 演出：老周倒数播报 + 核心扩散电磁环，见 GDD §15.2。

## 10. 完整度、丢区、胜负

- 完整度 0–100；漏怪按表扣分。阈值**单向触发、每档一次**：
  - `≤80` 丢 A 区：区内耗电塔本局永久停机、区内禁建，`power_cap −4`；
  - `≤50` 丢 B 区：`power_cap −6`，开启闸门路（`zone_b_floodgate` 事件格 → 寻路重算）；
  - `≤0` 或利维坦抵核心：Game Over。
- 波间修复：100 金 = +20（上限 100），**不撤销**已触发丢区。
- 胜利 = 撑过 20 波；星级 3/2/1 = 完整度 ≥80 / ≥50 / >0。
- Game Over 界面数据需求（GDD M2 验收）：记录每波每口漏怪数，输出「输在第几波、哪个口漏最多」。

## 11. GameState

运行时字段与默认值见 `game_state.defaults.json`（gold 220 / power_cap 8 / battery 0 / integrity 100 / ability_charges 0，上限 2 / dig_left、bridge_left 取自 MapDef）。全局常量（充能率 0.25、卖价 0.7、赏金递减、修复 100→20、阈值 80/50 等）同文件 `rules`。跨局只存 `Profile { map_stars[3], codex_seen[], settings }`，无任何数值养成。

## 12. 决策记录（GDD 歧义与 [补] 裁决，供策划复核）

| # | 问题 | 本稿裁决 | 依据/风险 |
|---|---|---|---|
| D1 | §11 部署期「金币恰好够 2 座」 vs §6.1 起始金币 220（可买 4 座机枪） | **已拍板（Round 2 主调度裁决 4）**：维持 220，教学「两座机枪」靠 `tutorial_hints.deploy_highlight_cells` 高亮引导，不锁金币、不锁建造 | GameState 按 §6.1 取 220；配表注释已同步结案 |
| D2 | 护甲减伤后是否有保底 | 保底 1 伤（`max(1, dmg−armor)`） | 机枪 5 − 甲 5 = 0 会完全免伤，「刮痧」应刮得动 |
| D3 | 冰碎 1 格溅射是否波及飞行单位、伤害几何 | 溅射 = 主目标最终值 100%、无视护甲、含飞行、**不可再触发冰碎** | 防连锁爆炸；比例可调 |
| D4 | 修理无人机是否飞行 | 地面单位（表现层悬浮） | §8.1 只给侦察蜂标了「飞」；若判飞行则波 8 前强制买对空，教学节拍会乱 |
| D5 | 爆破工兵自爆身亡给不给赏金 | 不给 | 奖励「在它自爆前杀掉」的正确玩法 |
| D6 | 炸桥导致敌人无路可走怎么办 | 若炸桥会使任一（当前/未来）出怪口断路，则该次不炸、直接通过 | 与玩家工程合法性同一套校验，零新代码 |
| D7 | 水洼格能否被焦油涂油 | 不能 | 保持「湿源」纯净，避免同格湿/油歧义；图 2 泄洪道冲油机制同理 |
| D8 | 导电按首目标还是逐跳判湿 | 首目标判定，整链增强 | 逐跳判定实现和 UI 反馈都复杂；GDD 表述「被特斯拉命中」以首目标解释 |
| D9 | 多台电容站充能 ×1.5 如何叠 | 相乘（1.5^n），battery_max +30/台线性叠 | 有滚雪球风险，平衡红线关注（§20 超载使用率） |
| D10 | 超上限「禁止建造/激活」中「激活」指什么 | 禁新建耗电塔 + 禁激活超载；已建塔照常运行 | §6.2 原文只有四字，取最小惩罚解释 |
| D11 | 停机/断电塔是否仍占供电 | 仍占，直到卖掉 | §6.3-3 明说丢区惩罚「逼你卖塔」 |
| D12 | 多重减速如何叠加 | 取最大值 | 焦油 30/40% 与未来减速源；冻结=速度 0 覆盖 |
| D13 | 大招与电容超载同时生效 | 攻速取最大（不叠乘至 ×4） | 防止双超载秒本挂机化（§20 后期挂机红线） |
| D14 | 电容站解锁波次 | 波 9 [补] | §11 只排到波 8；波 9 恰好在波 10 重构点前给玩家储能工具 |

---

*本文档由 R1-F3 起草、R2-F3 修订（对齐 Round 2 拍板：60Hz 逻辑时钟、`data/*.json` 规范主键、D1 结案；同轮统一了格子涂层枚举 oil/fire 与超载区域枚举）；`ARCHITECTURE.md` / `VISUAL_BIBLE.md` / `ACCEPTANCE.md` 由其他代理负责，本文不重复其内容。*
