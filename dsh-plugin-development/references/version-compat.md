# 版本与兼容（升级前后怎么快速对齐）

本文件基线：**DSH `0.2.2-rc.1`**（cordis `4.1.0`、schemastery `3.19.0`、cordis-plugin-loader `1.1.0`、cordis-plugin-include `1.1.0`、Node `24.21.0`）。DSH 迭代很快，**下文所有「实测」都绑这个版本**；升级后按 §1 → §3 → §4 重新核对，不要照搬。

## 1. 先读出版本（不要凭记忆）

| 想知道 | 从哪读 |
|---|---|
| harness 发行版本 | 安装目录 `resources/runtime/primary-runtime/runtime.json` → `desktopVersion`（同文件另有 `node` / `pnpm` / `python` 版本） |
| 核心包版本 | 安装目录 `app.asar` 内 `dsh/package.json`、`dsh/node_modules/@deepseek-ai/*/package.json` |
| 每个插件的版本 | 插件自己的 `package.json`；profile 里用 `link:` 时即仓库的版本 |

安装目录的定位见 `paths.md` §2（`process.resourcesPath`），**不要写死**。

> 实测：`runtime.json` 的 `desktopVersion` 与 `dsh` 包版本一致，但各包版本并不统一（cordis `4.1.0`、schemastery `3.19.0`，其余多为发行版本号）。所以「DSH 版本」要区分发行版本与单个包版本。

**想知道「有没有新版、哪天发的」**：安装目录 `resources/app-update.yml` 给出更新源（provider / url / channel）。按该 url 与 channel 取频道版本清单，能读到最新版本号、文件名、sha512、releaseDate。这是安装侧唯一的版本时间线。

## 2. 官方没有随包 CHANGELOG

安装内的 `@deepseek-ai/*` 里**没有** DSH 自己的 CHANGELOG 或 docs 目录；更新源的版本清单也只有 `version / files / path / sha512 / releaseDate`，没有 releaseNotes。所以「这个版本到底改了什么」在安装侧读不到，可用的信息源按优先级：

1. **活体 API 目录（最准，需 creator mode）**：`cordis_inspect_query` 查 `Service`、`Event`、`Tool`、`Slots`、`Theme`、`Config.listConfigs`——读的是**当前正在运行**的进程，永远与版本一致。
2. **每个包的 README + `lib/index.js`**：README 描述契约，`lib` 是实际实现；两者都在同一个包目录里。
3. **快照对比**：升级前后各采一次 API 表面，用 `scripts/api-snapshot.mjs` 输出变化清单（§3）。
4. **上游仓库的 upgrade-guide**：`docs/upgrade-guide/<版本>/<主题>/guide.zh.md` 是官方唯一成体系的破坏性改动说明；以安装内的实际契约为准。

## 3. 升级前后做 API 快照 diff

`scripts/api-snapshot.mjs` 在宿主进程内采集：发行版本 + 每包版本 + 客户端槽位名与声明包 + 宿主 cordis 服务名。

```js
// 升级前：agent 会话里用 run_code 执行（需要宿主进程的 fs 才能读 asar）
//   node api-snapshot.mjs --out before.json
// 升级后：
//   node api-snapshot.mjs --out after.json
//   node api-snapshot.mjs --diff before.json
```

diff 输出四类变化：**版本变化、新增槽位、消失槽位、新增/移除服务**。这三类正好对应插件最容易被打断的三种依赖——注册目标、注入服务，以及「哪个包还在」。

**不想跑脚本时的手工办法**：直接读安装内该包的 `lib/*.js`，搜你依赖的符号。能在安装里搜到 ≠ 契约没变（可能仍保留兼容实现），搜不到 = 一定没有。asar 需要宿主进程的 `fs`，或按 `paths.md` §2 的说明解析归档。

## 4. 必须知道的破坏性改动（截至 `0.2.2-rc.1`）

每条都标「现状」：**已生效**=安装里就是新契约；**弃用**=旧写法还能跑但已标记废弃；**未生效**=指南已发布、当前安装还是旧契约。

> **别信指南目录名**：`docs/upgrade-guide/<版本>/` 的目录按计划归口，代码可能晚一档发布（实测：投影句柄的指南在 `v0.2.1-rc.2/` 下，代码到 `0.2.2-alpha.2` 才进 tag；右键菜单与 Loader 条目树的指南在 `v0.2.2-alpha.2/` 下，代码到 `0.2.2-alpha.3` 才进 tag）。判断某个改动是否已生效，以安装内代码为准（§3 的手工办法）。

### 4.1 Session 投影注册改为异步句柄（`0.2.2-alpha.2` 起）

**现状：已生效；旧写法保留兼容但已弃用。** 指南：`docs/upgrade-guide/v0.2.1-rc.2/session-projection-handles/`（目录名早于代码，见上注）。

- `ctx.sessionProjections.register(definition)` 返回 `Promise<ProjectionHandle<S>>`；定义仍同步安装，await 之后拿到带 `stateOf(session)` 与 `dispose()` 的句柄。
- 运行时返回值是**可调用的 thenable**（`typeof registration === 'function'`，`instanceof Promise` 为 false）：直接把它当 disposer 调用仍会释放注册，但该用法已弃用；按 `typeof` / `instanceof` 分支的代码会被它骗过（Vitest 的 `.rejects` 会**调用**它，而不是观察拒绝）。
- 注册表级 `ctx.sessionProjections.stateOf(session, key)` 已弃用（调用会 warn，且没有该 key 的注册时返回 `undefined`）；`SessionProjectionStateMap` 已移除，宿主状态类型写在 `ProjectionDefinition<K, S>` 的第二个类型参数上。
- 迁移：在异步 `apply()` 或 `[Service.init]()` 里 `const handle = await ctx.sessionProjections.register(definition)`，**先保存句柄再对外提供依赖它的能力**；读宿主状态改用 `handle.stateOf(session)` 或所属域服务（`ctx.agents.turnBoundaryOf(session)`、`ctx.agentPresets.presetForSession(session)`、`ctx.tokenMeter.contextPressure(session)`）；释放用 `await handle.dispose()`（fiber 释放仍自动释放）；需要原生 Promise 时包一层 `Promise.resolve(registration)`。

### 4.2 客户端插件右键菜单改名（`0.2.2-alpha.3` 起）

**现状：已生效，无兼容别名。** 指南：`docs/upgrade-guide/v0.2.2-alpha.2/context-menu-target/`。

- `MenuTarget` → `ContextMenuTarget`（与 `ContextMenuTargetMap` 同名族）；目标字段与运行时行为不变。
- 工作区与侧栏注入的 `menuTarget` / `useMenuTarget` → `contextMenuTarget` / `useContextMenuTarget`。
- 操作图标不再接受 React 节点，改为 `{ key, src? }`，通过 keyed 槽位 `contextMenu.icon` 渲染。
- 迁移：换类型与注入名 → 图标元素换成 `{ key: 'my-plugin.action' }`（需要图片时带 `src`）→ 用 `ctx.slots.inject('contextMenu.icon', …)` + `ctx.slots.register()` 注册该 key → 重新构建客户端，确认类型检查通过、菜单渲染与插件卸载后的清理。

### 4.3 投影 snapshot 的计算范围（`0.2.2-alpha.3` 起）

**现状：已生效。** 指南：`docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/`。

- `ctx.sessionProjections.snapshot(session, keys)` **只计算它返回的单元**：传 `keys` 时只算选中的，不传时只算定义了 `wire` 的；不能假设调用后其他单元也已算好。
- 注册表 `cachedSnapshot(session, keys)` 已弃用（只返回别处已算好的值，可能缺 key）；持久化缓存的 `ctx.sessionProjectionCache.cachedSnapshot(header, keys)` 不变。
- `session.list` 摘要的 `projections` 不再带 `contextBreakdown` 与 `contextPressure`；要读就从打开的 Session 的投影 snapshot 或 follow 基线读。
- 迁移：用 `await ctx.sessionProjections.register()` 返回句柄的 `handle.stateOf(session)` 读自己单元的宿主状态；`cachedSnapshot` 调用换成 `snapshot`。

### 4.4 Loader 条目树与 Include 持久化（`0.2.2-alpha.3` 起）

**现状：已生效。** 指南：`docs/upgrade-guide/v0.2.2-alpha.2/cordis-loader-entry-trees/`。普通插件无感；只有**自己实现 `EntryTree` 子类、调用 `applyEntryPatches`、或依赖 Include 写盘**的代码受影响。

- `EntryTree.write()` 移除，子类改为实现 `commit(change: EntryChange)`（创建/更新/移动/删除/显式 Fiber 保存都会同步到达；内存树实现为空操作）。
- `applyEntryPatches(data, patches, warn)` 总是返回克隆后的条目，调用方不能再通过结果改输入。
- Include 通过与最新文件协调的 journal 持久化运行时变更；文件编辑在字段冲突时优先。要确认落盘要 `await include.flush()`（仍有未保存变更时拒绝）；patch 所拥有的字段与插入行写入**父 Include 的 patch**。
- 实践含义：profile 根 Include 的父级是内存中的 Loader，所以「运行时给 bundle 插入行写 `disabled: true`」这类改动**重启后不再保留**（以前整棵已应用 patch 的树会被写回 `cordis.yml`）。需要持久化的开关请直接改 profile 的 `cordis.patch.yml`。
- 另有长期规则：**插件代码不得读取、改写 profile 的 `cordis.patch.yml`**（那是用户的文件，含别的插件的 insert 行、注释与 `!!js` 表达式）。插件要改自己的配置，调用 `ctx.get('configEditor')?.edit(ctx.fiber.entry, current => ({ ...current, field }))`，并把字段声明 `.volatile()`。

### 4.5 CSS 锚定菜单（`0.2.2` 指南已发布）

**现状：截至 `0.2.2-rc.1` 尚未生效**（安装内仍能搜到 `useAnchoredPosition` 与 `getAnchorRect`）。指南：`docs/upgrade-guide/v0.2.2-alpha.2/css-anchored-menus/`。升级到真正移除它们的版本前，自定义 Client UI 需要迁移：

- `@deepseek-ai/dsh-client-ui-primitives` 的 `useAnchoredPosition` 与 `AnchoredPositionOptions` 移除。
- `Menu` 的 `getAnchorRect` 换成 `anchorRef`（指向触发元素的 ref）或 `anchorPoint`（`{ x, y }`，客户端视口坐标）。
- 自定义面板改为自己设 `anchor-name` / `position-anchor` 的 CSS 锚点定位。
- 受影响面：任何装了 `dsh-better-sidebar`（4 处 `getAnchorRect`）、`dsh-codex-subscription`（1 处 `useAnchoredPosition`）这类第三方客户端插件的安装，升级到该版本后这些菜单会失效，等插件作者发版或自己打补丁。

## 5. 声明宿主版本：会被真实检查（不是纯声明）

插件可以在 `package.json` 里声明自己支持的 DSH 版本——DSH 会读它，不满足就禁用插件或拒绝安装。判定在 `@deepseek-ai/dsh-app-boot` 的 `plugin-compatibility` 模块里（`evaluatePluginCompatibility`，只读 manifest、不执行插件代码）：

1. 写了 `engines.dsh`（SemVer 范围）→ **只看它**，`peerDependencies` 被忽略；
2. 没写 `engines.dsh` → 回退检查 `peerDependencies` 中所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的范围；
3. 比较用 `semver.satisfies(runtime, range, { includePrerelease: true })`，prerelease 参与；
4. `engines.dsh` 的 `workspace:` 范围视为不满足；peer 的 `workspace:^/~/*` 视为当前运行时；空/非法范围不满足。

不满足的后果：启动加载 profile 时逐条目 preflight → `row.disabled = true`，stderr 输出 `dsh: disabling profile plugin <id>: Plugin <pkg@ver> is incompatible with dsh <ver>: requirements {...}`；bundle 的 package.json 不兼容则整个 bundle 跳过（`skippedBundles`）；安装时在 pnpm 之前预检，直接拒绝（`incompatible-version`），装完复查不兼容会回滚。已装但未改动的包保持安装，只是启动时被禁用。

**反制：精确版本豁免**（明知风险也要跑时）：

- 记录在 profile 目录的 `compatibility.json`：`{ "包名@精确版本": ["精确 dsh 版本", ...] }`
- 授予：`dsh plugin allow-version <pkg@version> --dsh-version <exact> --accept-risk`，或插件管理器；撤销 `dsh plugin revoke-version`；查看 `dsh plugin version-exemptions`
- 只对精确 `name@version` + 精确宿主版本生效；豁免后允许运行，但警告可能崩溃或数据丢失。

**自测自己的 manifest**（宿主进程内，用 `run_code`；`pkgsRoot` 按 `paths.md` §2 定位）：

```js
const { evaluatePluginCompatibility } = await import(
  pathToFileURL(join(pkgsRoot, "dsh-app-boot", "lib", "index.js")).href,
)
evaluatePluginCompatibility(JSON.parse(readFileSync("<插件目录>/package.json", "utf8")))
// undefined = 兼容；否则返回 { name, version, runtimeVersion, requirements, exempted }
```

**写法建议**：只支持当前线就写 `engines.dsh`（如 `">=0.2.2"`）；想同时兼容 `0.2.0` 旧宿主，再在 `peerDependencies["@deepseek-ai/dsh"]` 写同范围——新宿主仍只认 `engines.dsh`。声明错版本会让插件在用户机器上直接消失，这比 API 漂移更常见。

- `dsh.manifestVersion` 在安装里检索不到任何读取逻辑，**不要依赖它**。
- DSH 包在 `peerDependencies` 里还有生态含义：非必需的用 `peerDependenciesMeta.optional` 标记；宿主半真正 `import` 的第三方库才进 `dependencies`（见 `install-and-devloop.md`）。
- 插件要「锁定」某个 API，靠的是**自己的测试**和**快照 diff**，不是版本号声明。

## 6. 升级后的回归清单

1. `node --test --test-isolation=none`（沙箱环境）——离线契约测试全绿。
2. 跑 `api-snapshot.mjs --diff`——确认注册的槽位、读取的服务都还在。
3. 确认宿主已加载新版本（HMR 重组完成；必要时按 `install-and-devloop.md` 的「HMR 与重启边界」重启）后，验证宿主路由/接口状态码（`host-half.md` 的错误码约定）。
4. 验证 volatile 配置通道仍能投影与写入（`config-channel.md`）。
5. 按 §4 逐条核对自己用到的接口：投影注册是否已 `await`、右键菜单类型/图标是否已换、菜单锚点是否还传 `getAnchorRect`、有没有改 profile patch。
6. UI：让用户刷新页面确认；没有浏览器控制工具时**不要**声称界面正常。
7. 把新的实测结论与版本号一起写进插件文档，**不要只写「改了什么」**。
8. 核对 `engines.dsh` / `@deepseek-ai/dsh*` peer 与目标宿主版本（§5）——声明错版本会让插件在安装或启动时被直接禁用。
