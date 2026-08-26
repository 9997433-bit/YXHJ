# GitHub Pages 部署

## 站点结构

一个仓库承载多个游戏，每个游戏独占一级子路径，站点根目录只放一份索引页（源文件 `site/index.html`）。

```
https://9997433-bit.github.io/YXHJ/                 索引页，链到各游戏
https://9997433-bit.github.io/YXHJ/last-watt/       《余电》Last Watt
https://9997433-bit.github.io/YXHJ/<game-id>/       以后每个新游戏
```

仓库名是 `YXHJ`（用户提到的 `YHJH` 在该账号下不存在，`gh repo list 9997433-bit` 已核对），
所以 Pages 的项目站点前缀是 `/YXHJ/`。`https://9997433-bit.github.io/YHJH/` 是 404，
且改不了——那个仓库不存在，只能改用 `/YXHJ/` 的地址。

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

`.github/workflows/pages.yml` 在 `main` 上 `games/last-watt/**`、`site/**`
或 workflow 自身有改动时重建站点。`cursor/pages-**` 分支上也会跑，但只构建、不发布。
另外挂了一条 6 小时一次的 `schedule`：在 Settings 里开 Pages 不会触发任何事件，
没有它，「先开 Pages、后来再也没人 push」的仓库会一直空着。

workflow 先读一次 `GET /repos/:owner/:repo/pages`，按当前的 Pages source 决定怎么发：

| Pages source | workflow 的动作 |
| --- | --- |
| `Deploy from a branch`（`build_type: legacy`） | 把产物推到 `gh-pages` 分支 |
| `GitHub Actions`（`build_type: workflow`） | `upload-pages-artifact` + `deploy-pages` |
| 未开启（API 404） | 只构建，写一条 job summary 说明还差哪一步，**不报红** |

推 `gh-pages` 时只重写 `last-watt/` 这一个目录，分支上其它游戏的目录不受影响。
加新游戏时复制 build + stage 两步，把 `last-watt` 换成新的 game id，并在 `site/index.html` 加一行链接。

## 仍需人工在 GitHub 网页上完成的一步

**开启 Pages 站点这件事，任何 workflow 都做不到。** 创建和修改 Pages 站点算仓库管理操作，
GitHub 返回的 `X-Accepted-Github-Permissions` 写得很清楚：

```
X-Accepted-Github-Permissions: pages=write,administration=write
```

`administration` 这一项无法授予任何 GitHub App token——包括 Actions 的 `GITHUB_TOKEN`
和 Cloud Agent 的 token，`permissions:` 里写什么都拿不到，只有用户级 token（PAT/OAuth）
才行。实测三条路全是 403 `Resource not accessible by integration`：

```bash
gh api -X POST repos/9997433-bit/YXHJ/pages -f build_type=workflow          # 403 创建
gh api -X POST repos/9997433-bit/YXHJ/pages -f 'source[branch]=gh-pages'    # 403 创建
gh api -X PUT  repos/9997433-bit/YXHJ/pages -f build_type=workflow          # 403 修改
```

`actions/configure-pages` 的 `enablement: true` 走的是同一个接口，同样 403，所以已经从
workflow 里去掉了。

请仓库 owner 手动开一次，只需一次：

**Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`
→ Branch 选 `gh-pages`，目录选 `/ (root)` → Save。**

选 `gh-pages` 分支是因为该分支上已经有构建好的站点（`index.html`、`last-watt/`、`.nojekyll`，
资源前缀 `/YXHJ/last-watt/`），保存后 1–2 分钟站点就能打开，不需要跑任何 workflow。

选 `GitHub Actions` 也能用，但保存的一刻不会触发任何构建，站点会先空着——要么去
Actions 里手点一次 `Deploy games to GitHub Pages` → `Run workflow`，要么等那条
6 小时的 `schedule` 自己补上。所以推荐前者。

Branch 必须选 `gh-pages`、目录必须是 `/ (root)`。选 `main` 的任何目录都是 404：
`main` 上只有源码，没有构建产物。

如果 Actions 推 `gh-pages` 失败并提示权限不足，再检查
**Settings → Actions → General → Workflow permissions**，选 `Read and write permissions`。
