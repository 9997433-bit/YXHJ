# GitHub Pages 部署

## 站点结构

一个仓库承载多个游戏，每个游戏独占一级子路径，站点根目录只放一份索引页（源文件 `site/index.html`）。

```
https://9997433-bit.github.io/YXHJ/                 索引页，链到各游戏
https://9997433-bit.github.io/YXHJ/last-watt/       《余电》Last Watt
https://9997433-bit.github.io/YXHJ/<game-id>/       以后每个新游戏
```

仓库名是 `YXHJ`（用户提到的 `YHJH` 在该账号下不存在，`gh repo list 9997433-bit` 已核对），
所以 Pages 的项目站点前缀是 `/YXHJ/`。

## Vite base

`games/last-watt/vite.config.ts` 的 `base` 默认是 `/YXHJ/last-watt/`，和真实 Pages 路径一致。
需要换路径时用环境变量覆盖，不用改代码：

```bash
LW_BASE=/ npm run build          # 部署到某个站点根
LW_BASE=/YHJH/last-watt/ npm run build
```

## 本地预览

```bash
cd games/last-watt
npm ci
npm run dev        # http://localhost:5173/YXHJ/last-watt/
```

`base` 不是 `/`，所以 dev server 和 `npm run preview` 的地址都带 `/YXHJ/last-watt/` 前缀，
访问 `http://localhost:5173/` 会 404，这是预期行为。想在根路径开发就用 `LW_BASE=/ npm run dev`。

构建产物同样只能在子路径下打开：

```bash
npm run build
cd dist && mkdir -p ../.preview/YXHJ && cp -R . ../.preview/YXHJ/last-watt
cd ../.preview && python3 -m http.server 8080   # http://localhost:8080/YXHJ/last-watt/
```

## 发布方式

`gh-pages` 分支托管构建产物，`main` 只放源码。

- 首次发布由人工推了一次 `gh-pages`（`last-watt/` 前缀 + 根索引页 + `.nojekyll`）。
- 之后 `.github/workflows/pages.yml` 接管：`main` 上 `games/last-watt/**` 或 `site/**` 有改动就重建并推 `gh-pages`。
  该 workflow 只重写 `last-watt/` 这一个目录，`gh-pages` 上其它游戏的目录不受影响。
- 加新游戏时，复制 workflow 里的 build + stage 两步，把 `last-watt` 换成新的 game id，并在 `site/index.html` 加一行链接。

## 仍需人工在 GitHub 网页上完成的一步

当前 Cloud Agent 的 token 对本仓库没有 admin 权限（`gh api repos/9997433-bit/YXHJ` 返回 `admin: false`，
`/pages` 返回 404），无法用 API 打开 Pages。请仓库 owner 手动开一次，只需一次：

**Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`
→ Branch 选 `gh-pages`，目录选 `/ (root)` → Save。**

保存后等 1–2 分钟，站点就在 `https://9997433-bit.github.io/YXHJ/last-watt/`。

如果 Actions 推 `gh-pages` 失败并提示权限不足，再检查
**Settings → Actions → General → Workflow permissions**，选 `Read and write permissions`。
