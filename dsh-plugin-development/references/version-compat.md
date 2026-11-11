# 版本与兼容（升级前后怎么快速对齐）

本文件基线：**DSH `0.2.2-rc.2`**（cordis `4.1.0`、schemastery `3.19.0`、cordis-plugin-loader `1.1.0`、cordis-plugin-include `1.1.0`、cosmokit `1.9.0`、Node `24.21.0`）。DSH 迭代很快，**下文所有「实测」都绑这个版本**；升级后按 §1 → §3 → §4 重新核对，不要照搬。

## 1. 先读出版本（不要凭记忆）

| 想知道 | 从哪读 |
|---|---|
| 发行版本、host 协议版本 | **安装根**（`$DSH_INSTALL_DIR/../../..`，包名 `@deepseek-ai/dsh-desktop-runtime`）的 `desktop-runtime.json`：`release.version` / `release.hostProtocolVersion` |
| 运行时（Node / pnpm / Python） | 安装根同级的 `resources/runtime/primary-runtime/runtime.json`（`desktopVersion`、`node`、`pnpm`、`pythonPackages`） |
| 每个包的版本 | `$DSH_INSTALL_DIR/../<pkg>/package.json`；上面那个 `desktop-runtime.json` 的 `sharedPackages` 也列了一遍 |
| 官方发布说明 | `$DSH_INSTALL_DIR/docs/upgrade-guide/README.md`（生成的索引）+ 各版本目录（见 §2） |

安装目录的定位见 `paths.md` §1–§2（`DSH_INSTALL_DIR` / `process.resourcesPath`），**不要写死**。

> 实测：`runtime.json` 的 `desktopVersion`、`dsh` 包版本、`desktop-runtime.json` 的 `release.version` 三者一致；但各子包版本并不统一（cordis `4.1.0`、schemastery `3.19.0`，其余多为发行版本号）。所以「DSH 版本」要区分发行版本与单个包版本。

## 2. 官方没有 CHANGELOG，但 `0.2.2-rc.2` 起文档随安装发布

安装内**仍然没有** CHANGELOG；但 `$DSH_INSTALL_DIR/docs/` 已经是一整套与当前版本一致的文档，信息源按优先级：

1. **活体 API 目录（最准，需 creator mode）**：`cordis_inspect_query` 查 `Service`、`Event`、`Tool`、`Slots`/`what:"client"`、`Theme`、`Config.listConfigs`——读的是**当前正在运行**的进程。
2. **`docs/upgrade-guide/`**：官方唯一成体系的破坏性改动说明，按版本目录组织，`guide.zh.md` 是中文；**这份现在随安装发布**，不用去仓库找。先读 `README.md` 索引再挑主题。
3. **`docs/subsystems/`、`docs/user/develop/`、`docs/cookbook/`**：机制契约与做法（槽位、client 模块、Web 客户端、设置、工具、插件发布）。
4. **每个包的 `README.md` + `src/*.ts`**：README 描述契约，`src` 是原始 TS 实现（`0.2.2-rc.2` 起几乎每个包都带），`lib/index.js` 只是构建产物。
5. **快照对比**：升级前后各采一次 API 表面，用 `scripts/api-snapshot.mjs` 输出变化清单（§3）。

## 3. 升级前后做 API 快照 diff

`scripts/api-snapshot.mjs` 采集：发行版本 + 每包版本 + **槽位（直接解析安装内的 `slot-catalog.ts`）** + 宿主 cordis 服务名（扫描 `super(ctx, "<name>")`）。

```
# 在宿主进程内（run_code 的 node:fs 能读 asar），或 shell 里用 ELECTRON_RUN_AS_NODE 跑
node api-snapshot.mjs --out before.json
# …升级…
node api-snapshot.mjs --out after.json
node api-snapshot.mjs --diff before.json
```

diff 输出五类变化：**包新增/移除、包版本变化、槽位新增、槽位消失、服务新增/消失**。这几类正好对应插件最容易被打断的依赖——注册目标、注入服务，以及「哪个包还在」。

**不想跑脚本时的手工办法**：读安装内该包的 `src/*.ts`，搜你依赖的符号。搜不到 = 一定没有；搜得到 ≠ 契约没变（可能保留兼容实现，也可能只是内部用法）。
## 4. 必须知道的破坏性改动（截至 `0.2.2-rc.2`）

每条都标「现状」：**已生效**=安装里就是新契约；**弃用**=旧写法还能跑但已标记废弃；**未生效**=指南已发布、当前安装还是旧契约。

> **别信指南目录名**：`docs/upgrade-guide/<版本>/` 的目录按计划归口，代码可能晚一档发布（实测：投影句柄的指南在 `v0.2.1-rc.2/` 下，代码到 `0.2.2-alpha.2` 才进 tag）。判断某个改动是否已生效，以安装内 `src/` 为准（§3 的手工办法）。

### 4.1 Session 投影注册改为异步句柄（`0.2.2-alpha.2` 起）

**现状：已生效；旧写法保留兼容但已弃用。** 指南：`docs/upgrade-guide/v0.2.1-rc.2/session-projection-handles/`。

- `ctx.sessionProjections.register(definition)` 返回 `Promise<ProjectionHandle<S>>`；定义仍同步安装，await 之后拿到带 `stateOf(session)` 与 `dispose()` 的句柄。
- 运行时返回值是**可调用的 thenable**（`typeof registration === 'function'`，`instanceof Promise` 为 false）：直接把它当 disposer 调用仍会释放注册，但该用法已弃用；按 `typeof` / `instanceof` 分支的代码会被它骗过（Vitest 的 `.rejects` 会**调用**它，而不是观察拒绝）。
- 注册表级 `ctx.sessionProjections.stateOf(session, key)` 已弃用；`SessionProjectionStateMap` 已移除，宿主状态类型写在 `ProjectionDefinition<K, S>` 的第二个类型参数上。
- 迁移：在异步 `apply()` 或 `[Service.init]()` 里 `const handle = await ctx.sessionProjections.register(definition)`，**先保存句柄再对外提供依赖它的能力**；读宿主状态改用 `handle.stateOf(session)` 或所属域服务（`ctx.agents.turnBoundaryOf(session)`、`ctx.agentPresets.presetForSession(session)`、`ctx.tokenMeter.contextPressure(session)`）；释放用 `await handle.dispose()`（fiber 释放仍自动释放）。

### 4.2 客户端右键菜单：类型、服务与图标（`0.2.1-rc.2` / `0.2.2-alpha.3` 起）

**现状：已生效，无兼容别名。** 指南：`docs/upgrade-guide/v0.2.2-alpha.2/context-menu-target/` + `v0.2.1-rc.2/context-menu-services/`；契约细节看 `@deepseek-ai/dsh-client-ui-context-menu` 的 `README.zh.md`。

- `MenuTarget` → `ContextMenuTarget`（与 `ContextMenuTargetMap` 同名族）；目标字段与运行时行为不变。
- 工作区与侧栏注入的 `menuTarget` / `useMenuTarget` → `contextMenuTarget` / `useContextMenuTarget`。
- **服务也改名**：`ctx.menus` → `ctx.contextMenus`；`MenuTargetMap` → `ContextMenuTargetMap`。
- 菜单项**改成数据贡献**：`ctx.effect(() => ctx.contextMenus.register({ id, target, order, resolve }))`，`resolve` 返回本地化动作（`id` / 禁用状态 / 子菜单 / `run`）；旧 React Slot 不再覆盖内置动作的排序。可用 `commandId` 关联已有快捷键命令（仅展示，不调度）。
- 图标不再接受 React 节点，改为 `{ key, src? }`，通过 keyed 槽位 `contextMenu.icon` 渲染：`ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({ name: 'contextMenu.icon', key: 'my-plugin.action' }, Icon))`。
- 打开菜单的组件侧：`const { getTriggerProps } = useContextMenu()`，把 `getTriggerProps(target, handlers?)` 展开到每个触发元素（可在循环里调）。`ctx.contextMenus.open(target, { x, y })` 供 Canvas/特殊编辑器直接开。
- 会话行/标签行的菜单项 Slot 名仍可用，但**拥有权移到了 `contextMenu.content` 适配器**：自定义 Slot 宿主应停止声明 `sidebar.workspaces.session.menu.item` 与 `sidebar.right.tab.menu.item`。

### 4.3 投影 snapshot 的计算范围（`0.2.2-alpha.3` 起）

**现状：已生效。** 指南：`docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/`。

- `ctx.sessionProjections.snapshot(session, keys)` **只计算它返回的单元**：传 `keys` 时只算选中的，不传时只算定义了 `wire` 的。
- 注册表 `cachedSnapshot(session, keys)` 已弃用；持久化缓存的 `ctx.sessionProjectionCache.cachedSnapshot(header, keys)` 不变。
- `session.list` 摘要的 `projections` 不再带 `contextBreakdown` 与 `contextPressure`。
- 迁移：用 `register()` 返回句柄的 `handle.stateOf(session)` 读自己单元的宿主状态；`cachedSnapshot` 换成 `snapshot`。

### 4.4 Loader 条目树与 Include 持久化（`0.2.2-alpha.3` 起）

**现状：已生效。** 指南：`docs/upgrade-guide/v0.2.2-alpha.2/cordis-loader-entry-trees/`。普通插件无感；只有**自己实现 `EntryTree` 子类、调用 `applyEntryPatches`、或依赖 Include 写盘**的代码受影响。

- `EntryTree.write()` 移除，子类改为实现 `commit(change: EntryChange)`。
- `applyEntryPatches(data, patches, warn)` 总是返回克隆后的条目。
- Include 用 journal 持久化运行时变更；要确认落盘要 `await include.flush()`；patch 所拥有的字段与插入行写入**父 Include 的 patch**。
- 实践含义：「运行时给 bundle 插入行写 `disabled: true`」这类改动**重启后不再保留**。需要持久化的开关请直接改 profile 的 `cordis.patch.yml`。
- 长期规则：**插件代码不得读取、改写 profile 的 `cordis.patch.yml`**。插件要改自己的配置，调用 `ctx.get('configEditor')?.edit(ctx.fiber.entry, current => ({ ...current, field }))`，并把字段声明 `.volatile()`。

### 4.5 CSS 锚定菜单（`0.2.2-rc.2` 起：**已生效**）

**现状：已生效。** `0.2.2-rc.1` 时还能在安装里搜到 `useAnchoredPosition` / `getAnchorRect`，`0.2.2-rc.2` 已经**搜不到了**——旧代码不是警告，是直接拿到 `undefined`。指南：`docs/upgrade-guide/v0.2.2-alpha.2/css-anchored-menus/`。

- `@deepseek-ai/dsh-client-ui-primitives` 移除了 `useAnchoredPosition`（值导出）与 `AnchoredPositionOptions`（类型导出）。这个包**不是独立安装包**，只作为浏览器模块表里的基线模块存在（§4.6），require 仍然可行。
- `Menu` 的 `getAnchorRect` 换成 `anchorRef`（指向触发元素的 ref）或 `anchorPoint`（`{ x, y }`，客户端视口坐标，等同 `event.clientX/clientY` 或 `getBoundingClientRect()`）。
- 自己实现的面板改用 CSS Anchor Positioning：触发元素设唯一 `anchor-name`，面板设 `position-anchor`，位置与尺寸限制用 CSS 写。
- `anchorPoint` 由 `Menu` 在打开或坐标变化时做 Safari → 布局视口的换算，**调用方不要自己再叠加视觉视口偏移**。
- 受影响面：任何装了 `dsh-better-sidebar`（4 处 `getAnchorRect`）、`dsh-codex-subscription`（1 处 `useAnchoredPosition`）这类第三方客户端插件的安装，在这个版本起这些菜单会失效，等插件作者发版或自己打补丁。
- macOS Desktop 另有窗口区域规则：覆盖可拖动页头的自定义浮层要在可见视口元素上声明 `data-window-drag-exclude`（或 `data-window-drag-controls`），否则交互控件会被当成拖动区（`v0.2.2-rc.1/window-drag-regions/`）。仅影响 macOS Desktop。

### 4.6 客户端清单新增 `dsh.client.external`，`inject` 只是包依赖（`0.2.2-rc.2`）

**现状：已生效（新字段 + 语义澄清）。** 字段定义在 `@deepseek-ai/dsh-package-manifest` 的 `DshClientManifest`。

- `dsh.client.inject`：**包名依赖边**（决定工厂到达顺序与客户端组合），**不是 Cordis 服务注入**。服务注入仍写在客户端插件的 `return { inject: [...] }` 里。
- `dsh.client.external`：超出**基线模块表**的精确模块请求，含子路径（如 `<pkg>/client`）；类型导入会被擦除，不产生请求。
- **基线模块表**（Web 外壳静态提供，随安装固定）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。这些**不需要安装、也不该写进 dependencies**。
- 其余模块要么写进 `dsh.client.external`（由宿主组合进图），要么就别 require——运行时解析不到会直接抛，客户端 bundle 整个不加载。

### 4.7 Plugin Manager API：`updatable` → `update`（`0.2.2-rc.1` 起）

**现状：已生效。** 指南：`docs/upgrade-guide/v0.2.2-rc.1/plugin-update-method/`。只影响**读取 Plugin Manager Host API / `@deepseek-ai/dsh-plugin-manager/types` / 远端客户端**的代码；`plugin_manager` 工具本身不变。

- `pluginManager.listBundles()` 不再返回 `BundleInfo.updatable: boolean`，改为可选 `BundleInfo.update: 'registry' | 'git'`。判「能不能列版本」看 `update === 'registry'`；判「能不能被 `updateBundle` 替换」看 `update !== undefined`。
- `ManagementError['code']` 新增 `unexpected-package`（安装到的包名/版本与请求不符，已回滚）。对错误码做穷尽 `switch` 的代码要补这一支。

## 5. 声明宿主版本：会被真实检查（不是纯声明）

插件可以在 `package.json` 里声明自己支持的 DSH 版本——DSH 会读它，不满足就禁用插件或拒绝安装。判定在 `@deepseek-ai/dsh-app-boot` 的 `plugin-compatibility` 模块里（`evaluatePluginCompatibility`，只读 manifest、不执行插件代码）：

1. 写了 `engines.dsh`（SemVer 范围）→ **只看它**，`peerDependencies` 被忽略；
2. 没写 `engines.dsh` → 回退检查 `peerDependencies` 中所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的范围；
3. 比较用 `semver.satisfies(runtime, range, { includePrerelease: true })`，prerelease 参与；
4. `engines.dsh` 的 `workspace:` 范围视为不满足；peer 的 `workspace:^/~/*` 视为当前运行时；空/非法范围不满足。

不满足的后果：启动加载 profile 时逐条目 preflight → `row.disabled = true`，stderr 输出 `dsh: disabling profile plugin <id>: …`；bundle 的 package.json 不兼容则整个 bundle 跳过；安装时在 pnpm 之前预检，直接拒绝（`incompatible-version`），装完复查不兼容会回滚。

**反制：精确版本豁免**（明知风险也要跑时）：

- 记录在 profile 目录的 `compatibility.json`：`{ "包名@精确版本": ["精确 dsh 版本", ...] }`
- 授予：`dsh plugin allow-version <pkg@version> --dsh-version <exact> --accept-risk`，或插件管理器；撤销 `dsh plugin revoke-version`；查看 `dsh plugin version-exemptions`
- 只对精确 `name@version` + 精确宿主版本生效；豁免后允许运行，但警告可能崩溃或数据丢失。

**自测自己的 manifest**（宿主进程内，用 `run_code`）：

```js
const { evaluatePluginCompatibility } = await import(
  pathToFileURL(join(packagesRoot(), "dsh-app-boot", "lib", "index.js")).href,
)
evaluatePluginCompatibility(JSON.parse(readFileSync("<插件目录>/package.json", "utf8")))
// undefined = 兼容；否则返回 { name, version, runtimeVersion, requirements, exempted }
```

**写法建议**：只支持当前线就写 `engines.dsh`（如 `">=0.2.2"`）；想同时兼容 `0.2.0` 旧宿主，再在 `peerDependencies["@deepseek-ai/dsh"]` 写同范围——新宿主仍只认 `engines.dsh`。

- `dsh.manifestVersion` 在安装里检索不到任何读取逻辑，**不要依赖它**。
- DSH 包在 `peerDependencies` 里还有生态含义：非必需的用 `peerDependenciesMeta.optional` 标记；宿主半真正 `import` 的第三方库才进 `dependencies`。

## 6. 升级后的回归清单

1. `node --test --test-isolation=none`（沙箱环境）——离线契约测试全绿。
2. 跑 `api-snapshot.mjs --diff`——确认注册的槽位、读取的服务都还在（槽位清单直接来自安装内的 slot 目录）。
3. 确认宿主已加载新版本（HMR 重组完成；必要时按 `install-and-devloop.md` 的「HMR 与重启边界」重启）后，验证宿主路由/接口状态码。
4. 验证 volatile 配置通道仍能投影与写入（`config-channel.md`）。
5. 按 §4 逐条核对自己用到的接口：投影注册是否已 `await`、右键菜单是否用 `ctx.contextMenus` + 数据贡献 + keyed 图标、菜单锚点是否还传 `getAnchorRect`、客户端清单是否需要 `external`、有没有改 profile patch。
6. UI：让用户刷新页面确认；没有浏览器控制工具时**不要**声称界面正常。
7. 把新的实测结论与版本号一起写进插件文档，**不要只写「改了什么」**。
8. 核对 `engines.dsh` / `@deepseek-ai/dsh*` peer 与目标宿主版本（§5）。
