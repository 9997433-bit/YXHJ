# Last Watt 规则探针

这里的测试把 `docs/GDD-余电.md` 第 5–10 章转换成可执行契约，并直接导入生产模块：

- `src/gameplay` 的 `runGameplaySelfCheck()` 执行地图、寻路、工程、区域和波次不变量。
- `src/combat` 的 `OpenFieldTerrain` 与 `runIceShatterProbe()` 执行无渲染器的真实战斗链。
- `fixtures/rules-mock.mjs` 只由 `mock-control.test.mjs` 保留一条旧契约对照，不再作为主测试对象。

## 运行

需要 Node.js 20.19 或更高版本。先在游戏目录安装依赖：

```bash
npm --prefix games/last-watt install
```

从仓库根目录运行真实模块测试和 mock 对照：

```bash
npm --prefix games/last-watt/tests test
```

也可以直接从游戏目录运行：

```bash
npm --prefix games/last-watt test
```

## 已覆盖契约

- gameplay 自检中的 47 条真实不变量，包括反向 flow field、挖沟/搭桥、堵路拒绝、施工计时、改道、区域失电和波次。
- combat 的真实冰碎反应表、40 伤害阈值、250% 无视护甲伤害、溅射、命中停顿及冻结后免疫。
- `OpenFieldTerrain` 无头端口、湿/油唯一涂层槽，以及所有生产敌人的漏怪事件载荷。
- 一条隔离的旧 mock 对照，确保历史契约夹具仍可执行。
