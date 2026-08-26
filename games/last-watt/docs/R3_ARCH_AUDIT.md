# 《余电》Last Watt — R3 终验架构审计（R3_ARCH_AUDIT.md）

> 责任代理：R3-F1（fable）。上游：`INTEGRATION.md`（R2 拍板版）、`ARCHITECTURE.md` §4 import 白名单。
> 审计基线：`agent/last-watt` @ `2e6e86c`（含 R3-O1/O3 已并入的修复；R3-F3 配表改动尚在飞行中，不计入）。
> 效力：**只审不建**。Round 3 锁令第 6 条「不再扩系统，只打磨与验收」约束本文全部处置建议——
> 允许的动作只有四种：**删**（别名/死代码）、**改名**（机械替换）、**改道**（几行的调用重路由）、**记账**（降级为 v2 债，验收按现实走）。
> 任何「补建 INTEGRATION 里规划过但没建的子系统」的冲动，一律落在记账栏。

---

## 0. 结论速览

切片的骨架是干净的：`gameplay/combat` 逻辑核零 three/DOM（红线扫描通过）；帧协议（顿帧
timeScale、遮罩 pass、60Hz 定步长）只有 `vfx/engineBridge.ts` 一份实现；`src/app` 确实没有
第二套钱包、建造规则或帧协议。R2 的「四模块串成一局」这件事成了。

但 §3 注册表的收尾**没做完**，且其中一条已经烂成了当前可见的 bug：

| # | 发现 | 级别 |
|---|---|---|
| A1 | `app/view/TowerView.ts` 三个塔的轮廓分支用旧 id，**永远不命中**——机枪/冷凝/破碎锤现在渲染成默认中性方块 | **P0 修** |
| A2 | HUD 索敌优先级回调**直写** `tower.targetStrategy`，绕过命令层（§2.2 / §4.4-3 双违） | **P0 修** |
| A3 | 状态 id `chilled`/`chill_immune` 全 combat 仍是主键，§4.3-1 的 `wet_cold`/`freeze_immunity` 改名从未执行；JSON 侧已是新名，两套状态词表并存 | **P1 改名** |
| A4 | 四张别名表（LEGACY_×3、ENEMY_ID_ALIASES、COMBO_ALIASES、mist 旧名）到了 §3 总则的 R3 删除期限，连坐面见 §3.3 | **P1 删** |
| A5 | 六色立法存在 **4 份副本**、格↔世界换算存在 **3 份约定**、敌人 id 常量 **2 份同名导出** | P2 收敛 |
| A6 | combat 内容（塔/敌/升级/状态/反应）运行时读 TS 表而非 `data/*.json`；gameplay 内容读 JSON——同一局游戏两种配表口径 | P3 记账 |
| A7 | INTEGRATION §4.1 的 sim.ts Hub、engine/contracts、engine/assets、vfx/bindings、ARCHITECTURE 勘误五项义务未执行，现实由 `src/app` 装配替代 | P3 记账 |

---

## 1. 双实现

### 1.1 内容表双源：TS 表在跑，JSON 在对账（A6）

J3 立法「规范 ID 唯一来源 = `data/*.json`」在 **id 层面**成立（TS 表主键已全部经
`TOWER_IDS`/`ENEMY_IDS` 等常量指向 canonical 字符串），但在**数值层面**只对了一半：

| 配表 | 运行时来源 | 证据 |
|---|---|---|
| `data/maps/map1.json` | ✅ JSON（`app/game.ts` → `importMapDefJson`） | game.ts L113 |
| `data/waves.map1.json` | ✅ JSON（`importWaveTableJson`） | game.ts L116 |
| `data/game_state.defaults.json` | ✅ JSON（`Economy.ts`/`EngineeringSystem.ts` 模块级 import） | Economy.ts L19 |
| `data/towers.json` / `enemies.json` / `reactions.json` | ❌ **TS 表**（`combat/data/*.ts`），JSON 仅被 `combat/selfcheck.ts` 拿来对账 id 与价格 | game.ts L121 构造 `CombatSystem` 未传 `content` → `DEFAULT_CONTENT` |

INTEGRATION §4.3-2 要求的 ContentRegistry JSON 导入口**不存在**。后果是不对称的：改
`waves.map1.json` 立刻改变游戏，改 `towers.json` 对游戏**零效果**——R2 遗留债「升级价格
JSON 与代码分叉」正是这么长出来的，`37f1765` 的修法也是手工把 TS 表改到和 JSON 一致，
等于承认 JSON 是真相、同步靠人肉。**R3-F3 正在改配表，凡动 towers/enemies/reactions 的
数值，必须同步改 TS 表，否则改了等于没改。**

处置：补 JSON 导入口属于扩系统，记账 v2。R3 内的护栏是现成的——`combat/selfcheck.ts`
已交叉校验 id 与价格，G1 把它纳入合并后全测试链即可把「人肉同步」看住。

### 1.2 状态模型双词表（A3，本审计最重的一条）

`data/reactions.json` 的 status_model 用 canonical 名 `wet_cold` / `freeze_immunity`；
`src/combat` 全模块（`types.ts` 的 `StatusId` 联合、`data/statuses.ts`、`reactions.ts`、
`towers.ts`、`upgrades.ts`、`enemies.ts`、`scenarios.ts`）仍用 `chilled` / `chill_immune`。
§4.3-1 白纸黑字要求的改名从未执行，且**连别名层都没有**——不是「别名未删」，是「改名未做」。
因为 1.1 的原因（JSON 不进运行时），这个分叉在游戏里不可见，selfcheck 也没查状态 id，
所以一路绿灯活到了 R3。

附带欠账：§3.4 就地登记的 `slowed`/`stunned`/`armor_broken` 三个 canonical 新增状态
至今未写进 `reactions.json` status_model（F3 义务）。

处置：机械改名不是扩系统。O3 全量替换两个字符串（约 20 处 + `StatusId` 联合 + tests 的
`chill_immune` 断言），F3 补三个状态登记。若 R3 排不下，ACCEPTANCE 记黄牌并把 §5-1 的
ID 扫描测试范围扩到状态 id，防继续漂移。

### 1.3 六色立法 ×4 副本（A5）

同六个色值存在四份、两套键名词表，靠注释「Shared with …」人肉同步：

| 副本 | 键名 | 消费方 |
|---|---|---|
| `engine/config.ts` `PALETTE` | electric/ember/frost/tar/coin/alarm | engine 场景 |
| `vfx/palette.ts` `PALETTE_HEX` | electric/**fire/ice/oil**/coin/**alert** | vfx 全部 + `ui/theme.ts` |
| `app/config.ts` `APP_PALETTE` | 同 engine 键名 | app 三个视图 |
| `combat/data/statuses.ts` `PALETTE` | electric/fire/ice/oil/**gold**/alarm | 状态 UI 元数据；经 `combat/index.ts` 公开导出，与 engine/vfx 的 `PALETTE` 导出名撞车 |

处置（P2，删两份）：`app/config.APP_PALETTE` 改为从 `@engine` 的 `PALETTE` 取值（app 是
装配层，import 合法）；`combat/data/statuses.PALETTE` 从 `combat/index.ts` 的公开面撤下
（模块内自用可留，但别再输出第三个同名 `PALETTE`）。engine 与 vfx 两份是白名单两侧的
叶子，各留一份、值以 vfx/palette 为准对齐即可，不必为归一去发明 contracts。

### 1.4 格 ↔ 世界换算 ×3 约定（A5）

- `engine/grid/coords.ts` `cellToWorld`：`(col + 0.5) × cellSize`——立法版（§4.4-6）；
- `src/app/**`：`cx + 0.5` 内联散在 BoardView/game/input 十余处；
- `vfx/combatBridge.ts` `defaultToWorld`：`(x, h, y)` 直通，注释自认「与 coords.ts 约定一致」。

`cellSize = 1` 时三者相等；谁改 `GRID.cellSize` 谁负责全场错位。处置（P2）：app 与 vfx 的
换算点改调 `cellToWorld`/`worldToCell`（vfx 已留 `toWorld` 注入口，由装配层传进去即可，
不改 vfx 内部）。

### 1.5 敌人 id 常量双份同名导出（A5）

`combat/data/ids.ts` 与 `gameplay/waves/enemyMeta.ts` 各有一个 `ENEMY_IDS`，**值同键不同**
（`scoutWasp` vs `scoutBee`、`demoSapper` vs `sapperCrab`…），且两个模块的 index 都公开
导出。`app/config.ts` 用的是 combat 那份——选错 import 不报错、不炸编译，只会在改键名时
静默漂移。处置（P2）：gameplay 那份改名 `WAVE_ENEMY_IDS` 或从公开面撤下，二选一。

### 1.6 已声明、可留的双实现（登记不动）

| 项 | 现状 | 判 |
|---|---|---|
| `engine/grid/GridView` vs `app/view/BoardView` | Engine **无条件**构造 GridView 并挂场景，game.ts 再 `visible = false` 藏掉 | 留；engine 独立 harness 还用它。可选微修：Engine 加 `gridView?: false` 构造开关，省一份死几何 |
| `engine/scene/EmissiveTestbed` | `testbed: false` 关闭，R1 脚手架 | 留（engine demo 用） |
| `engine/boot.ts`(`__lastWatt`) vs `src/main.ts`(`__lastWattGame`) | 双入口双 console 句柄，index.html 只挂 main | 留；boot 是引擎独立起搏器 |
| `engine/debug/DebugHud` vs `app/devOverlay` + `app/runOverlay` | 三个自注入样式的 overlay，id 命名空间已隔离，G 键冲突是分立的原因 | 留 |
| `gameplay/integration/stubCombat.ts` | `CombatPort` 的无头替身，仅 selfcheck 用 | 留（合法测试替身）；但 `STUB_*` 从 `gameplay/index.ts` 公开面撤下更净 |
| `gameplay/maps/map1Powerhouse.ts` vs `data/maps/map1.json` | TS 灰盒图仅 selfcheck 用，README 自认「正式关卡落 data/」 | 留，禁止新代码引用 |
| `vfx/demo/integration.ts` | app/game 的前身——另一套五模块装配 | 留作 vfx 验收台；**禁止再演进**，新接线只进 `src/app` |
| `enemyMeta.icon`（`enemy_scavenger_bug`） | 从未被消费，hudBridge 用自己的 `ENEMY_ICONS`（`enemy-bug`） | P2：删字段或对齐词表，别留第三套图标名 |

---

## 2. 越界 import

对照 ARCHITECTURE §4 白名单逐模块扫描（`rg "from '\.\./"` 全量）。

### 2.1 红线：通过

`src/gameplay/**` 与 `src/combat/**` **零** `three` import、零 `document`/`window` 触碰。
逻辑核可无头，G1 的静态扫描应把这条固化成测试（若尚未有）。

### 2.2 违规：视图直写 Sim 状态（A2，P0）

```76:81:games/last-watt/src/app/hudBridge.ts
        this.run(commands.sell(Number(towerId)));
        this.interaction.selectedTowerId = null;
      },
      onTargetPriority: (towerId, priority) => {
        const tower = this.combat.getTower(Number(towerId));
        if (tower) tower.targetStrategy = priority;
```

卖塔走 `commands.sell`，索敌优先级却直接改 combat 实体字段。这是全仓唯一一处
「视图层直写玩法状态」，同时违反 §2.2（`set_priority` 是 PlayerCommand）、§4.4-3
（HUD 回调即发命令，不得直改）与 ARCHITECTURE §5.2。处置：`CommandCenter` 加一个
`setPriority(towerUid, priority)`（与 `sell` 同构，转调 combat，几行），hudBridge 改道。
不算扩系统——命令面板本来就是这类动词的家。

### 2.3 白名单外的模块间 import（type-only，记账豁免）

| 出发 → 到达 | 文件 | 性质 |
|---|---|---|
| ui → vfx | `ui/theme.ts` L1（`PALETTE_HEX`、`cssColor`，**运行时**） | 违白名单；但这是「六色立法只有一份」的落实手段，方向反了而已 |
| ui → vfx | `ui/Hud.ts` L1、`ui/components/ImpactOverlay.ts` L2-3（`ImpactState`/`RGBA`，type-only） | 同上 |
| vfx → combat | `vfx/combatBridge.ts` L1、`vfx/selfcheck.ts` L3（`CombatEventMap`，type-only） | combatBridge 就是 §4.4-4 绑定表的现实形态，它必须认识战斗事件的形状 |

按原架构这些类型该住在 `engine/contracts`——那个目录不存在（§4.1-4 未执行），R3 也不该
为此新建目录。处置：全部**记账豁免**，在 ARCHITECTURE §4 白名单上补两行注记
（「ui 可 type-only import vfx 的 ImpactState/palette；vfx 可 type-only import
combat/events」），把例外写成法条而不是留成先例。`ui/theme.ts` 的运行时 import 若要消除，
最小改法是六色值以 engine `PALETTE` 为源（见 §1.3），v2 再议。

### 2.4 配表加载散点（A7 关联）

`engine/assets`（§4.1-5）不存在，JSON import 散在五处：`app/game.ts`（map/waves）、
`gameplay/economy/Economy.ts` 与 `gameplay/engineering/EngineeringSystem.ts`（defaults，
**模块级默认参数**）、`gameplay/selfcheck.ts`、`combat/selfcheck.ts`。Vite 静态 import
下无运行时代价，且不碰 three/DOM 红线；真正的坏味道是 gameplay 两处把「配表值」焊进了
模块默认参数——换表要改代码。记账 v2，不动。

### 2.5 装配层特权使用（登记）

`src/app/**` 走 `main.ts` 的「一切（装配）」白名单行，import combat 实体（`Tower`/`Enemy`）、
gameplay 内部枚举（`TerrainName`）与寻路内部件（`tracePolyline`），并每帧读
`combat.towerList()/enemyList()` 活实体而非快照。这偏离 ARCHITECTURE §5.2「视图只读
快照/只听事件」，但装配层是它法定的居住地，`ui/**`、`vfx/**` 两个模块本体仍是纯事件/
快照驱动——**边界守住了，特权只在 app 用**。两点风险登记：

1. `app/config.TERRAIN_STYLES` 以内部 `TerrainName`（`trench`/`path`/`rock`…）为键，
   出站翻译 `toCanonicalTerrain` 在这条路径上没被使用；R3 后任何内部地形改名会连坐 app
   （TS 类型会拦住，但 canonical 词表从此管不到表现层的键）。
2. 每帧 `towerList()` 分配数组 ×3 处（present/diagnostics），性能预算紧了再收。

---

## 3. 未删别名（§3 总则：兼容别名只保留 R2，R3 起删除）

### 3.1 先修再删：已经死掉的旧名分支（A1，P0）

```90:96:games/last-watt/src/app/view/TowerView.ts
  switch (defId) {
    case 'rivet_mg': {
      const body = new Mesh(new BoxGeometry(0.34, 0.26, 0.34), BODY);
      body.position.y = 0.13;
      const barrel = new Mesh(new BoxGeometry(0.1, 0.1, 0.52), DARK);
      barrel.position.set(0, 0.17, 0.3);
      accentMesh = new Mesh(new BoxGeometry(0.08, 0.08, 0.08), ACCENTS.rivet.clone());
```

`tower_built.defId` 自 `43b9dea`（combat 主键 canonical 化）起只可能是 `mg_rivet` /
`condenser_jet` / `hydraulic_breaker`…，而 TowerView 的 switch 还留在 R1 词表：
`rivet_mg`、`condenser`、`hydraulic_hammer` 三个分支**永远不命中**，这三座塔全部落进
default 的中性方块——五塔里三塔丢了轮廓语言（`tar_sprayer`、`generator` 因新旧同名幸存）。
这直接打 V-01「一眼认塔」，且冷凝/破碎锤正是冰碎教学的主角。**修法一行一个 case：三个
字符串改 canonical id。归 O1（app 层）或 O4，本轮必修。**

### 3.2 别名表清单（P1，删）

| 表 | 位置 | 条目 | 删除时须连带 |
|---|---|---|---|
| `LEGACY_TOWER_IDS` / `LEGACY_UPGRADE_IDS` / `LEGACY_ENEMY_IDS` + `resolve*` + `isLegacyId` | `combat/data/ids.ts` | 4+14+4 | `combat/index.ts` 与 `combat/data/index.ts` 的公开导出；`ContentRegistry.towerId/upgradeId/enemyId` 退化为恒等（可整段删） |
| `ENEMY_ID_ALIASES` + `normalizeEnemyId`（`@deprecated R2`） | `gameplay/waves/enemyMeta.ts` | 9 | `gameplay/index.ts` 导出；`importers.ts` L283 的兜底调用；README「R3 删」承诺兑现 |
| `COMBO_ALIASES`（`ice-shatter`→`shatter`、`oil-fire`→`oil_fire`） | `ui/components/ComboToast.ts` | 2 | 调用方已全走 canonical（combat `combo_first_seen` 发 `shatter`），可直删 |
| `DEFAULT_MIST_TOWERS` 里的 `'condenser'` | `vfx/combatBridge.ts` L90 | 1 | 装配层本就显式传 `TOWER_IDS.condenserJet`，默认值瘦身零风险 |

### 3.3 删除连坐面（先改这些，别名才能死）

- **tests**：`tests/last-watt-rules.test.ts` L95/112/152-155 用 `armored_hauler`、
  `scurry_rats`、`scout_bee`、`sapper_crab`（靠 resolver 兜底活着），L128 断言
  `chill_immune`；`tests/fixtures/rules-mock.mjs`、`tests/mock-control.test.mjs` 同源。归 G1。
- **bench**：`bench/scenarios/wave-10-shatter.json`、`bench/run.mjs`、
  `bench/lib/production-runtime-probe.mjs` 含旧词表引用。归 G2。
- **combat/selfcheck.ts** L180-181 故意用旧名测 resolver——删 resolver 时同步删这几条用例。
- **vfx/demo/main.ts** L45/52 的 `'condenser'`（demo 假数据，顺手改）。
- gameplay README「R3 删别名时，data/ 里仍写旧名的表会在导入期直接炸，这是故意的」——
  已验证 `waves.map1.json` 出怪 id 全部 canonical，炸不了，可以放心删。

### 3.4 不在删除令内（防误伤）

- `TERRAIN_NAME_ALIASES`（`gameplay/data/importers.ts`）：§3.7 明文允许的**单向进站翻译**，
  永久件，不删。
- `CLASS_KEY_ALIASES`（`flyer`→`flying`、`demolisher`→`sapper`）：`map1.json` 的
  `first_appearance_waves`/权重键仍写旧类名，翻译层承重中。要么 F3 改表后删，要么归入
  永久进站翻译——二选一并在 INTEGRATION §3.2 补注，别让它成为无名件。
- `vfx/events.ts` 的 kebab-case 事件名（`ice-shatter` 等）：§4.4-5 明文的模块内部 API，不删。

---

## 4. INTEGRATION 义务核销单（未执行项，全部记账）

| 义务 | 现实 | 判 |
|---|---|---|
| §4.1-2 `src/sim.ts`：CommandQueue + GameEventHub | 由 `src/app/game.ts`（直订 `combat.bus`）+ `CommandCenter`（同步执行）替代；`sim:*` 事件族不存在，HUD 每帧重建快照；命令即时执行而非 tick 边界消费，§5-3「同种子+同命令序列（含 tick 编号）」的回放契约**无法按原文验收** | 记账 v2；ACCEPTANCE 相应条目按现实装配面改写 |
| §4.1-4 `engine/contracts/` | 不存在；`PlayerCommand` 类型从未落盘，§2.2 的形状只活在文档里 | 记账 v2（连带 §2.3 的豁免注记） |
| §4.1-5 `engine/assets/` | 见 §2.4，五处散装 import | 记账 v2 |
| §4.1-7 ARCHITECTURE 勘误注记 | 全文无一处「以 INTEGRATION.md 为准」，30Hz 条目原样躺着 | **R3 可做**：纯文档，归 F1/F4 收尾时顺手补 |
| §4.4-2 `TowerInspectState.towerId` 拆 `towerUid`+`defId`；回调改 `towerUid: number` | 未拆；hudBridge 里 `String()`/`Number()` 来回转 | 记账 v2（A2 修掉后仅剩接口洁癖） |
| §4.4-4 `vfx/bindings` 声明式绑定表 | `combatBridge.ts` 硬编码 switch 承担同职；未登记 id 的行为是「不订阅」而非「no-op+告警」 | 记账 v2；R3 冻结 §3.8 fx 注册表即可 |
| §7.5 `window.__lastWatt.metrics` | 实际为 `window.__lastWattGame.game.diagnostics()` | 文档对齐即可 |

## 5. 工程卫生（顺手项）

- `games/last-watt/probe.tmp.ts`：无头探针残留在游戏根，删除或移入 `tests/`。
- `gameplay/index.ts` 公开导出 `STUB_*`、`MAP1_POWERHOUSE`（仅 selfcheck 使用）——从公开面撤下。

## 6. 处置汇总

| 级 | 动作 | 归属 |
|---|---|---|
| P0 | TowerView 三个 case 改 canonical id（§3.1）；`setPriority` 走命令层（§2.2 违规修复） | O1/O4；O1+O3 |
| P1 | 删四张别名表 + 连坐 tests/bench/demo 改 canonical（§3.2-3.3）；`chilled`→`wet_cold`、`chill_immune`→`freeze_immunity` 全量改名 + F3 补登 `slowed/stunned/armor_broken`（§1.2） | O3 主刀，G1/G2 收测试 |
| P2 | 调色板删两份（§1.3）；换算统一 `cellToWorld`（§1.4）；`ENEMY_IDS` 消歧（§1.5）；`enemyMeta.icon` 删或对齐（§1.6）；`probe.tmp.ts` 删（§5） | O1–O4 各自目录 |
| P3 | §4 全表记账进 ACCEPTANCE/INTEGRATION 备注；§5-1 ID 扫描测试范围扩到状态 id 与本文 §3.2 清单 | F4 / G1 |

*本文为 Round 3 终验审计。发现按级别归 Owner；P0/P1 未闭合前，对应 ACCEPTANCE 条目不得标绿。*
