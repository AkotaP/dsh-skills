# 坑清单

下列各条均来自真实故障或实测复现。**动手前扫一眼，能省一次重启。**

## 加载与依赖

1. **宿主半 import 了没装进自己 `node_modules` 的 `@deepseek-ai/*`** → `ERR_MODULE_NOT_FOUND` → **整个插件不加载**，UI 什么都不出现且几乎没有明显报错。宿主半的裸包名只沿模块目录往上找，不会从 app.asar 里"顺便"解析到。
2. **`Config` 字段忘了 `.volatile()`** → 设置项静默失效、写入被宿主编译拒绝（`Plugin entry "…" has no volatile fields`）。`volatile()` 只在 `@deepseek-ai/schemastery ≥ 3.18.3`，且必须真装进插件自己的 `node_modules`。
3. **客户端服务没写进 `inject`** → `ctx.get()` 返回 `undefined`，功能"看着有、实际不生效"（`configForms` 踩过）。
4. **`dsh.client.inject` 漏声明客户端包** → `require` 在浏览器模块表里解析失败，槽位条目直接崩。
5. **客户端 bundle 的 `id` 与包名不一致 / `configForms.get(id)` 用的不是 patch 行 id** → 配置读写打在空气上。应写断言锁住"配置命名空间必须等于 `cordis.patch.yml` 里的条目 id"。

## 生命周期与热更

6. **裸注册（不进 `ctx.effect`）** → 热更/卸载后残留路由、监听、定时器。
7. **样式"只插一次"**（先查 head 里有没有再插）→ 热更后旧 `<style>` 还在，新 CSS 永远不生效，改颜色看着像没做。正确做法：**每次加载先删同名旧标签再插**。
8. **弹窗挂在会卸载的容器里**（比如「…」菜单内部）→ `setMenuOpen(false)` 与 `setOpen(true)` 同批处理后一起消失，表现为**"点了没反应"**。弹窗放 `shell.overlay`。
9. **`dsh-client-hmr` 重载会清掉旧 fiber 的样式、且失败不回滚** → 不要依赖"上次注入的东西还在"；重载后新 bundle 必须能自己重建全部资源。
10. **改完宿主半没重启 DSH 就宣称生效** → 假报告。host 模块不参与热更。

## 权限与状态

11. **运行中会话不能删**（建议返回 409 `session-busy`），批量删除会"部分成功"并汇总失败数。
12. **宿主拿不到"浏览器当前会话"** → 单个删除路径可以删掉用户正在看的空闲会话；批量路径靠 `selectableIds` 排除 current 行。
13. **产出文件判定只认外层 `tool/call`** → 本 harness 里 agent 只直接调 `run_code`，真正的写文件记在 **`tool/ptc-dispatch-start` / `tool/ptc-dispatch`**；且相对路径必须按**会话 cwd** 绝对化。只认外层会让统计与删除一起失效。
14. **往 session 里 append 新 `type` 的事件** → 读取端只接受带 `ignorable: true` 的未知事件，而 `Session.append()` 设不了这个标记，会话将无法重新打开。

## 环境相关（官方 skill 未覆盖）

15. **`dsh --profile desktop --dump-config` 在 Desktop profile 下失败**：`error: profile "desktop" is managed exclusively by the Electron application`。Desktop profile 只能靠读 bundle patch + profile patch 或 UI 插件页来看合成结果。
16. **默认 preset 是 `ptc`，没有 `plugin_manager` / `cordis_inspect_*`**。照官方 `cordis-plugin-development` 的流程直接找这两个工具会卡住——要么切 `cordis` preset，要么走手工 link 路线（`install-and-devloop.md` §B）。
17. **`node --test` 在 DSH 沙箱下报 `spawn EPERM`**（子进程管道被禁）。加 `--test-isolation=none` 进程内跑即通过。
18. **asar 里的官方源码只有宿主进程自己的 `fs` 读得动**：`rg`/`glob`/`pwsh` 的 `ls/cat/cp` 全部 `ENOENT`。要用 `run_code` 里的 `node:fs`，按 `paths.md` §2 定位包目录后再读，不要拼某个固定安装路径。
19. **patch 覆盖语义**：带 `id` 无 `insert` 是**整体替换**该行，`config` **不深合并**；覆盖官方行时必须把该行需要的字段全部重述。非 `insert` 且无 `id` 的条目会被警告并跳过。

## 写测试时的坑

20. **组件里的 `setInterval` 不清除会让 `node --test` 永不退出**（harness 里把 interval 变 no-op，`setTimeout` 保持真实）。
21. **把「实测」结论当成跨版本真理** → harness 升级会改 API：`0.1.7-rc.2` → `0.2.0-rc.2` 就新增了槽位、Node 从 24.15 升到 24.18。升级后先跑 `scripts/api-snapshot.mjs --diff` 再跑插件测试，别凭记忆断言。
22. **`lib/client.js` 是构建产物**（CRLF、超长 CSS 字符串、类名映射）——用工具改，别手抄；改完必须过语法检查 + harness。
