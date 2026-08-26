# `src/gameplay` — 网格 / 寻路 / 工程操作 / 波次 / 经济 / 一局游戏

O2 独占子树。对应 GDD §5（地图与改路）、§6（双资源）、§8.3（波次乘区）、§10（完整度）、§17.2 模块 1/2/3/7。

**本模块拥有**：棋盘与地形、地面寻路、挖沟/搭桥合法性与施工、变电区断电与闸门支路、波次时间表、金币/供电/储能/核心完整度（INTEGRATION.md §4.2-3、§4.2-5）、建造合法性与塔占格、玩家命令的校验与驳回、一局的胜负状态。

**本模块不拥有**：塔与敌人实体、伤害与状态、格子涂层（油/火，全归 `src/combat`）、渲染（`src/engine`、`src/vfx`）、跨模块总线与装配（`src/sim.ts`）。这些系统通过下文的端口和事件与本模块交互，本模块从不反向 import 它们。

---

## 30 秒上手

两层门面，按需要挑一层。

**`GameSession` —— 一局完整的游戏**（棋盘 + 钱包 + 波次 + 战斗）：

```ts
import { createGameSession, MAP1_POWERHOUSE } from '@/gameplay';
import { CombatSystem } from '@/combat';

const session = createGameSession({ map: MAP1_POWERHOUSE });
const combat = new CombatSystem({
  terrain: session.terrain,   // combat.TerrainQuery
  movement: session.movement, // 地面走场、飞行走直线
  power: session.power,       // combat.PowerSupply（§6.2 储能）
});
session.attachCombat(combat); // 出怪、赏金、漏怪、拆桥、丢区断电

session.commands.armDig();    // 挖沟按钮
session.commands.clickCell(8, 2);
session.commands.startWave();

session.tick(1 / 60);         // 固定步长（engine SIM.fixedDelta = 1/60）
hud.update(session.snapshot());
```

**`GameplayWorld` —— 只要棋盘**（`tests/`、`bench/` 里推荐这层）：

```ts
import { createGameplayWorld, MAP1_POWERHOUSE } from '@/gameplay';

const world = createGameplayWorld({ map: MAP1_POWERHOUSE, getGold: () => wallet.gold });
world.events.on('wave_spawn', (request) => combat.spawn(request));
world.startWave({ early: false });
world.tick(1 / 60);
```

`Grid` / `EngineeringSystem` / `WaveRunner` / `Economy` / `BuildSystem` / `computeFlowField` 也都能单独用；两个门面只是接线，不含额外玩法。

战斗是可选的：不 attach 时棋盘、钱包、波次时钟和每一条合法性规则照常跑，`selfcheck.ts` 与 bench 就是这么用的。

---

## 坐标约定

整数格坐标一律 `cx` / `cy`，与 `src/combat` 完全一致（`CellCoord { cx, cy }` 是结构等价的，无需转换）。`src/engine/grid/coords.ts` 把同一对量叫 `col` / `row`，数值相同。世界坐标 1.0 单位 = 1 格，格心 = `(cx + 0.5, cy + 0.5)`。

---

## 跨模块契约

### 给 `src/combat`

三个入站端口（combat 的 `ports.ts`）由本模块实现，**结构等价、不跨子树 import**：

| combat 侧 | gameplay 侧 | 说明 |
|---|---|---|
| `TerrainQuery` | `session.terrain` / `world.terrain`（`GridTerrainQuery`） | `isBridge()` 只对**玩家搭的桥**返回 true，正是拆迁蟹的合法目标 |
| `MovementDriver` | `session.movement`（`RoutedMovement`） | 见下方「一个驱动，两条路线」 |
| `PowerSupply` | `session.power`（`Economy`） | `tryConsumeBattery()` 扣不动就拒绝，不会透支 |

反过来，本模块通过 `integration/combatPort.ts` 里的**结构接口**读 combat：`CombatPort` 描述 `spawnEnemy` / `buildTower` / `sellTower` / `setTowerPowered` / `bus` / `content`，`CombatSystem` 天然满足它，于是 `attachCombat()` 不需要任何一行 `import from '../combat'`。`integration/stubCombat.ts` 是同一份接口的无头实现，自检用它把 gameplay 单独跑起来。

**一个驱动，两条路线**：combat 每个单位只挂一个 `MovementDriver`，所以 `RoutedMovement` 在内部分流——地面单位走共享 flow field（波中挖沟能让**已经在路上**的敌人改道，GDD §5.1），飞行单位走 `PolylineMovement` 直插核心，两者都乘上 `SpawnRequest.speedMultiplier`。想自己接线时，裸组件仍在：`world.polylineFromGate(gateId)`、`world.flightPathFromGate(gateId)`。

**接线表**（`integration/CombatLink.ts`，对应 INTEGRATION.md §2.4）：

| 方向 | 事件 / 调用 | 动作 |
|---|---|---|
| gameplay → combat | `wave_spawn` | 按 `SpawnRequest` 调 `spawnEnemy`，落在出怪口格心，带 HP/速度乘区 |
| gameplay → combat | 建塔 / 卖塔 | `grid.setOccupied()` 先占格（`isBuildable` 转 false 并 bump `buildVersion`），再 `buildTower` / `sellTower` |
| gameplay → combat | 丢区断电 | 区内每座塔 `setTowerPowered(id, false)`；**供电占用不释放**（SYSTEMS.md D11，逼你卖塔） |
| combat → gameplay | `enemy_killed` | 入账赏金（已含 `bountyMultiplier`） |
| combat → gameplay | `enemy_leaked` | 抢金 + 扣完整度 → 丢区结算；`lossOnLeak` 直接判负 |
| combat → gameplay | `bridge_destroyed`（拆迁蟹） | `world.destroyBridge(cx, cy)` 改回沟壑并重刷场；**次数不返还** |
| combat → gameplay | `enemy_spawned` / `enemy_died` | 数场上还剩几只——包括母舰在 combat 内部裂出的子机，波次清场靠它 |

### 经济与完整度（本模块内）

`economy/Economy.ts` 一个对象同时管金币、供电（上限/占用/空闲/缺口）、储能、完整度与大招充能，因为 §6.3 里每条有意思的规则都是它们之间的耦合。它只管数字，不管决策：合法性在 `BuildSystem` / `EngineeringSystem`。

| 时机 | 调用 |
|---|---|
| 完整度增减（漏怪、修复、调试） | `session.applyIntegrity(delta, reason)` → 改数字、发 `integrity_changed`、结算 80/50 丢区、判负，一次搞定（INTEGRATION.md §4.2-4） |
| 只要丢区结算 | `world.applyIntegrity(n)` 收的是**绝对值**不是增量，返回本次丢掉的变电区。阈值只触发一次，丢区不可赎回 |
| 工程扣款 | `GameSession` 监听 `engineering_started` 扣款；`EngineeringSystem` 本身不碰钱包 |
| 波次奖励 | `waves.notifyWaveCleared()` 返回 `{ reward, earlyBonus, total }`，同时发 `wave_cleared` |
| 赏金递减 | 每个 `SpawnRequest` 自带 `bountyMultiplier`（波 10 后 0.8、波 15 后 0.6） |

**没有一个数字写死在代码里**：起始金 220、供电上限 8、储能上限 100、卖出返还 0.7、修复 100 金 /+20、大招每 5 波 1 层上限 2、挖沟 50 / 搭桥 80 / 施工 3s，全部由 `data/gameStateDefaults.ts` 从 `data/game_state.defaults.json` 读出来（INTEGRATION.md J4、§4.1-5）。改 JSON 重跑，数值跟着变——自检里有一条就是盯这个的。

### 给 UI

`session.snapshot()` 一次给全 HUD 需要的东西：金币、波次与下一波预览、供电、储能、完整度与阈值、大招充能、工程剩余次数与按钮态、建造菜单（含解锁 / 买得起 / 差几点电）、场上敌人数。

命令走 `session.commands`（`commands/CommandCenter.ts`），语义即 INTEGRATION.md §2.2 的 `PlayerCommand`：

- 工具流：`armDig()` / `armBridge()` / `selectBuild(defId)` → `highlightTargets()` 高亮合法格 → `clickCell(cx, cy)` 落子。**非法点击不解除武装**，钱包也不动，返回值里带 `reason` 和中文 `message`。
- 直接命令：`startWave({ early })`、`sellAt(cx, cy)` / `sell(towerId)`、`repair()`、`ultimate()`、`overload(towerId)`、`upgrade(towerId, upgradeId)`。`dig` / `bridge` / `buildAt` 也能绕过武装流程直接调，UI 之外的调用方（测试、回放）用这条。
- 按钮态：`buttons()` 返回每个按钮的 `enabled` / `message` / `badge`，UI 不用自己判断为什么灰。
- 下一波预览：`world.waves.nextPreview` → `WavePreviewEntry[]`，含 `icon` / `count` / `air`（对空警示）/ `threat`（`breaker` 高亮拆与疗）。**预览与实际出怪来自同一份 `ResolvedWave.spawns`**，不会对不上。

裸组件仍在：`engineering.checkDig(cx, cy)` / `checkBridge(cx, cy)` 返回 `OperationCheck`（`reason` 枚举、`message` 中文、`cost`、`quotaLeft`、`blockedGates`），`engineering.legalTargets('dig' | 'bridge')`、`engineering.digLeft` / `bridgeLeft`。

### tick 顺序

`GameSession.tick(dt)` 按 INTEGRATION.md §1.2 走，顺序有意义：

1. `world.tick(dt)`：施工计时、闸门/丢区事件、`WaveRunner` 出怪 —— 这一 tick 完工的沟先改地形再重刷场，后面才有人动；
2. `link.dispatch(requests)`：把 `SpawnRequest` 变成 combat 里的实体；
3. `combat.update(dt)`：移动、索敌、伤害、反应、死亡与漏怪（`driveCombat: false` 时交给装配层调）；
4. `economy.tick(dt)`：储能按空闲供电点充能；
5. 清场判定：全部出完且场上为空 → 结算奖励，最后一波则判胜。

命令在 tick 之外的边界消费（§1.2 第 1 步由 `src/sim.ts` 负责）。本模块任何地方都不写步长字面量，一律用传入的 `dt`（§1.3）。

---

## 网格

地图用 ASCII 编写，一格一字符（图例见 `grid/mapDef.ts` 的 `DEFAULT_LEGEND`）：

```
.  地基（可建）      #  岩石        =  路面        d  可挖路段（路面 + 可挖标记）
~  水洼（路面变体）  ,  软土        v  沟壑        w  水面        b  预置桥
C  核心              1/2/3 出怪口   L/M/N 闸门组   F  泄洪道      g  地热裂隙
```

不能用一格一字符表达的东西（变电区矩形、出怪口开启波次、工程次数、波次乘区）放在 `MapDef` 的兄弟字段里。`MapDef` 是纯 JSON 可序列化的：等 `data/` 出正式关卡表，用 `loadMapDef()` 走同一条校验路径接进来即可。

地形特性由 `TERRAIN_TRAITS` 统一裁决（walkable / buildable / road / water / bridgeable），不要在别处再写一份判断。`isBuildable` 已经把地形、占位、施工中、变电区断电四件事一起算好了。

**两个版本号**：`grid.version` 只在**可通行性**变化时自增（挖沟完工、拆桥、开闸），flow field 以它为唯一缓存依据；`grid.buildVersion` 在**可建造性**变化时自增（建塔/卖塔、变电区断电）。分开是为了让建塔不会白白触发一次全图重刷路。

---

## 寻路

`computeFlowField(view, targets, opts)` 从核心反向刷 Dijkstra，产出 `cost`（到核心的步数）与 `direction`（`DIRECTIONS` 下标）。四邻域，方向在第二遍单独计算，平局固定按 N→E→S→W 取，**与堆的弹出顺序无关**，所以同一张图必然得到同一条路径（回放与埋点可复现）。

两种模式：

- **严格**（`blockedPenalty: Infinity`，默认）：不可通行格 `cost = Infinity`、`direction = -1`。合法性校验用它。
- **惩罚**（`GameplayWorld` 默认 `1000`）：穿墙代价极高但有限，于是**每一格都有方向**。拆迁蟹把敌人脚下的桥炸了也不会出现「没有方向可走」的僵死。`isReachable()` 判的是 `cost < reachableThreshold`，仍能区分真通与假通。

改路是全量重算（GDD §5.1），240 格的重算成本可以忽略；`world.groundField` 按 `grid.version` 惰性重建并发 `flow_field_rebuilt`（payload 里带不可达的出怪口列表）。

---

## 工程操作（挖沟 / 搭桥）

| | 挖沟 | 搭桥 |
|---|---|---|
| 代价 | 50 金 / 3s | 80 金 / 3s |
| 目标 | 标了 `Diggable` 的路面（可挖路段） | 沟壑 / 水面 |
| 施工期间 | **仍可通行**（GDD §5.1） | 不可通行，完工才通 |
| 结果 | 路面 → 沟壑 | 沟壑/水面 → 桥（打 `PlayerBridge` 标记） |

合法性（`check()`）比「当前这一格能不能挖」更严，三点值得注意：

1. **按完工后的棋盘判**。所有**已排队但未完工**的工程一并计入，所以「单独看都合法、加起来堵死」的两次挖沟会在第二次就被拒。
2. **尚未开启的出怪口也要保持连通**。否则波 3 挖一刀，波 10 第二出怪口一开就直接死锁。（`config.includeUnopenedGates`，默认开。）
3. **桥依赖只是警告，不是拒绝**。如果某条通路只在玩家搭的桥存在时才成立，`warnings` 里会出现 `bridge_dependent_route`——把敌人引上桥本来就是正当玩法，但 UI 应该提示玩家拆迁蟹能拆掉它。

拒绝时 `reason` 是枚举，`blockedGates` 告诉你是哪个口断了。

---

## 波次

一份 20 波基础表（`BASE_WAVE_TABLE`）× 每图乘区（`MapDef.waveModifiers`），不为每图手写波表（GDD §8.3）。乘区能做四件事：

- `hpMultiplier` / `speedMultiplier`：整图难度列。
- `countMultipliers`：按**类别**缩放数量（`flying` / `healer` / `sapper` / …），例如图 2 的对空考核是 `flying: 1.5`。缩放后至少保留 1 只，不会把一个小队四舍五入抹掉。
- `firstAppearance`：破阵敌首次登场波。早于该波的编组自动换成替身（侦察蜂→疾行鼠、拆迁蟹→装甲车、修理机→拾荒虫），波压不塌；恰好在该波而基础表没排的，补一个小队进去。
- `waveOverrides`：按波做手术（图 3 波 15 母舰 ×2、波 20 利维坦 HP ×1.2 就是这么来的）。

`MAP_WAVE_MODIFIER_PRESETS` 里已经按 GDD §8.3 表格备好了 `map1` / `map2` / `map3` 三列。

`WaveRunner` 只管波次状态与出怪时刻，不创建敌人，也**不知道场上还剩几只**——清场由调用方调 `notifyWaveCleared()` 告知。状态机：`preparing → spawning → clearing → preparing …→ complete`。

> 基础波表与灰盒图 1 都标了 PROVISIONAL：数值是按 GDD §11 教学脚本和 §12 曲线推的可玩初稿，等 `data/` 的正式配表落地后原地替换，生成器不关心数据从哪来。

---

## 接 `data/` 的正式配表

`data/importers.ts` 是单向适配器：`data/` 保持它自己那套可读的 snake_case 设计稿，`MapDef` / `WaveTableDef` 保持运行时形状，两边都不用迁就对方。

```ts
import mapJson from '../../data/maps/map1.json';
import wavesJson from '../../data/waves.map1.json';
import { importMapDefJson, importWaveTableJson, createGameplayWorld } from '@/gameplay';

const map = importMapDefJson(mapJson as unknown as MapJson);
const waveTable = importWaveTableJson(wavesJson as unknown as WaveTableJson, map.gates.map((g) => g.id));
const world = createGameplayWorld({ map, waveTable });
```

导入时会跑完整校验（`loadMapDef` / `loadWaveTable`），配表写错在加载期就炸，不会变成三个系统之后的诡异寻路 bug。`selfcheck.ts` 有一整段断言专门跑**已授权的** `data/maps/map1.json` 与 `data/waves.map1.json`（清单见下方「自检」）。

### id 与地形名的单向翻译层

INTEGRATION.md §3 把 `data/*.json` 定为 id 的唯一来源，本模块照办：

- **敌人 id**：`ENEMY_IDS` 现在就是 canonical（`swift_rat` / `armored_truck` / `scout_wasp` / `demo_sapper` …），`wave_spawn` 只发这一套。Round 1 的两套旧名（combat 代码表的 `scurry_rats` 等、本模块初稿的 `sprinter` 等）退进 `ENEMY_ID_ALIASES`，`normalizeEnemyId()` 在导入配表时消化掉。**别名只保留 R2，R3 删。**
- **地形名**：`TerrainName`（`trench` / `path` / `rock` …）是实现枚举，允许留着，但不许泄漏出模块。进来走 `TERRAIN_NAME_ALIASES`，出去走 `toCanonicalTerrain()`——所以挖沟完工时 `engineering_completed.terrain` 是 `gully` 而不是 `trench`。出站方向是多对一的反向，会丢掉 `diggable_road` / `locked_road` / `event_sealed` 这类**编图期**的区分，这是有意的：格子挖过之后「它原本是闸门封锁路」属于地图作者的历史，不是运行时状态。

## 灰盒图 1「主厂房」

`maps/map1Powerhouse.ts` 是一张**系统优先**的灰盒图，专门把本模块要支持的机制全部跑通（正式关卡设计仍应落在 `data/`）：

| 机制 | 表现 |
|---|---|
| 挖沟封捷径 | (8,2) 的横向连接把蛇形路线从 44 步缩到 32 步；挖掉它，44 步回来，且因为有环路所以合法 |
| 搭桥引怪 | 第 5 行的沟壑在 (11,5) 缺一格，搭一次桥把路程压到 22 步——玩家在自己的杀伤区正中开门 |
| 丢 B 区开支路 | `sluice_b` 闸门 (15,3)–(16,5) 是一条 21 步直插核心的路，完整度 ≤50 时打开，沿蛇形路线摆的塔瞬间打空 |
| 第二出怪口 | `gate_south` 波 10 开 |
| 工程次数 | 挖沟 3 / 搭桥 2，波 15 补发挖沟 1 |

---

## 自检

```bash
npx esbuild src/gameplay/selfcheck.main.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/gp-selfcheck.mjs && node /tmp/gp-selfcheck.mjs
```

`selfcheck.ts` 是 73 条 GDD / INTEGRATION 不变量的可执行版本，分三段：

1. **棋盘与波次**（R1）：地形特性、路径长度、施工期通行、堵死拒绝、未开启出怪口、拆桥回退、丢区开闸、乘区缩放、预览与出怪一致、提前开波 +10%。
2. **战斗接线**（R2）：塔占格与卖塔退格、供电上限拒绝建塔、发电机/电容改上限、挖沟按钮的武装→高亮→落子→解除、地面走场 / 飞行走直线 / 速度乘区、赏金与漏怪、完整度 ≤80 丢 A 区（塔变暗但占用不释放）、完整度 ≤50 开 B 区闸门并重刷场、拆迁蟹炸桥回退、清场后才结算、五波充一次大招、**波 10 第二口开启且两口都能到核心**、HUD 快照一致。
3. **已授权配表**（`data/maps/map1.json` + `data/waves.map1.json` + `data/game_state.defaults.json`）：三个出怪口都能到核心、波 5 炸墙后支路真的更短、推荐的免费挖沟格 (5,5) 在炸墙前非法炸墙后合法、丢 B 区闸门确实开出捷径、沟壑恰好吃满 2 次搭桥配额、全表 20 波跑通、出怪 id 全是 canonical、钱包数值确实来自 JSON。这些是给数据轨的设计反馈，不是本模块的单测。

战斗接线那一段用 `integration/stubCombat.ts` 跑：它实现同一个 `CombatPort`，只做移动、出怪、漏怪和事件，不做伤害与开火，所以 gameplay 的自检不依赖 combat 的数值。真正接 `CombatSystem` 的端到端验证归装配层。

它**不替代** `tests/`（那是 G1 的子树）——`runGameplaySelfCheck()` 已导出，测试可以直接把它当一组断言跑。

---

## 已知边界

- 寻路是四邻域。八邻域会让「挖一格封路」的直觉失效（斜穿角落），除非另立防穿角规则，v1 不做。
- 所有敌人共用一张 flow field。若后续要做「拆迁蟹优先找塔」之类的差异化寻路，应另刷一张场，不要改这张。
- `FlowFieldMovement` 在格心转向；这是让改道不会斜穿塔位的最简做法，但也意味着敌人不会走对角捷径。
- 格子涂层（油渍/火场）不在这里，归 `src/combat`；本模块只提供 `isRoad()`（涂层只沾路面）和 `isFloodway()`（图 2 泄洪道每波冲油）。
- 飞行单位没有独立的 `MovementDriver`，是 `RoutedMovement` 内部按敌人类型分流的——combat 每个单位只挂一个驱动，这是在不改 combat 端口的前提下同时支持两种路线的做法。
- `ENEMY_ID_ALIASES` 是 R2 的过渡品。R3 删别名时，`data/` 里任何仍写着旧名的表都会在导入期直接炸，这是故意的。
