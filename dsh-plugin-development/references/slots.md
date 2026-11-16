# 槽位（Slots）

槽位是宿主页面预留的扩展位；插件**注册进**已声明的槽位，不能自造槽位名。

## 0. 权威来源：随安装发布的 slot 目录（`0.2.2-rc.2` 起）

这份安装里带一份**生成的槽位契约目录**，比从 bundle 里正则捞字符串准得多：

- 文件：`<安装>/node_modules/@deepseek-ai/dsh-cordis-client-runner/src/client/slot-catalog.ts`（导出 `CLIENT_SLOT_API`；`lib/client.js` 里是同一份数据）。由 `scripts/gen-client-catalog.ts` 生成、由 doc-sync 的 `verify-client-catalog` 把关，因此与当前 bundle 的编译期契约一致。
- 每条给出：`key`、`kind`（`single` / `list` / `keyed` / `chain` / `hoc`）、`scope`（`root` / `session` / `session-maybe`）、`registerOptions`（含 `required` / `optional`）、`ownerProps`、`standardProps`、`keyDomain`、`hookContext`、`slotInject`、`declaredBy`、`occupants`、`replaceRisk`、`example`、`source`。
- 运行时等价物：creator mode 的 `cordis_inspect_query`（`what:"client"`）返回的就是这份目录——**有 inspect 用 inspect，没有就读上面那个文件**。
- 读取方式：`run_code` 里直接 `fs.readFileSync`（asar 可读），或用 shell 的 `ELECTRON_RUN_AS_NODE=1` + `$DSH_NODE_EXECUTABLE` 跑脚本（见 `paths.md` §3）。整份 5000+ 行，**不要整读**：按 `key: '<槽位名>'` 定位，再读同一条目里的字段。

第 5 节的清单是这份目录在 `0.2.2-rc.3` 的静态抄本（116 条），用于快速检索；**升级后以目录为准**。

## 1. 用目录回答四个问题

| 问题 | 看哪个字段 |
|---|---|
| 这个名字存在吗 | 目录里有没有这条；再不行用 `ctx.slots.spec(name)` |
| 注册必须传什么 | `registerOptions` 的 `requirement`（`id` / `key` / `select` 视 kind 而定） |
| 谁让它存在、什么时候能用 | `declaredBy`——槽位只在声明者挂载时存在，注册进未声明的槽位会 **throw** |
| 我的组件收到什么 | `ownerProps`（声明者传下的 props）+ `standardProps`（框架 hook，如 `useSessions`）+ `hookContext` |

## 2. 选槽位的纪律

- **选本来就分配了空间的槽位**（`conversation.composer.dock`、`settings.section`、`shell.overlay`…），不要用绝对定位压在宿主控件上。官方 UI 插件模板默认就用 `conversation.composer.dock`。
- **看 `replaceRisk`**：`shadows-shipped-ui` 表示注册即**顶替**宿主现有 UI（`root`、`main`、`sidebar`、`rightbar` 这类区域级 single/keyed 槽位尤其如此）；除非你就是要替换，否则选 `none`（追加）的 list / hoc / chain 槽位。
- `hoc` 槽位（`conversation.hero.frame`、`conversation.chat.markdown.fence`、`sidebar.session.action`）收到 `children`，必须原样渲染至多一次；什么都不加就 `return children`。
- `keyed` 槽位先看 `keyDomain`：已占用的 key 会被你的注册替换，别误占官方 key。
- 不要读其他插件的 DOM/样式表来猜位置。
- 需要浮层（弹窗/提示）时用 `shell.overlay`（frame 级），**不要**挂在会卸载的容器里。
- `order` 决定同槽位内顺序：官方侧边栏行操作用 100/200（archive/pin），新条目取 300 即排在其后；「…」菜单官方用到 400，新条目取 450。
- `ctx.slots.inject(ownerSlot, cb)` 的 `cb` 在声明者挂载/卸载时重跑，注册随之销毁/重建——把 `register` 写在 `cb` 里。

## 3. 典型注册示例

| 用途 | 槽位 | 注册选项 |
|---|---|---|
| 设置页一个分区 | `settings.section` | `id` + `order` + `label` + `locale` |
| 插件页自己的配置 | `plugins.bundle.config` | `key` = **包名** + `locale` |
| 插件页某一行配置 | `plugins.row.config` | `key` = `'<包名>#<行 id>'` |
| 会话标题栏按钮 | `conversation.session.header.actions` | `id` + `order` |
| 输入框下方装饰 | `conversation.composer.dock` | `id` + `order` |
| 用户消息前的装饰 | `conversation.chat.user.before`（chain） | `select` + `id` |
| 「新建会话」行内容的包裹层 | `sidebar.session.action`（hoc） | `id` |
| 确认弹窗 | `shell.overlay` | `id` + `order` |
| 右键菜单**数据项** | 不用槽位，改用 `ctx.contextMenus.register`（见 `client-half.md`） | — |
| 右键菜单图标 | `contextMenu.icon`（keyed） | `key` = 动作的 icon key |

## 4. 版本差异（以安装内目录为准）

| 版本区间 | 变化 |
|---|---|
| `0.2.2-rc.1 → 0.2.2-rc.2` | 新增 12 条：`conversation.chat.markdown.fence`、`conversation.chat.user.before`、`conversation.hero.frame`、`conversation.input.model.options`、`conversation.session.header.actions.subagent.footer`、`settings.launcher.notifications`、`sidebar.right.tab.document.office.pdf`、`sidebar.right.tab.guide`，以及区域级 `root` / `main` / `sidebar` / `rightbar`（旧清单靠正则扫 bundle，把单词形式的槽位漏了）；消失 5 条：`command.label`、`input.file`、`remote.actionCards`、`remote.officeToPdf`、`remote.pluginRecommendations` |
| `0.2.2-rc.2 → 0.2.2-rc.3` | **新增 2 条、无消失**：`sidebar.session.action`（hoc，包裹「新建会话」行内容，由 `client-ui-sidebar` 声明）、`workspace.picker.directoryFlow`（single，`workspace.picker` 工厂下的目录选择洞，由 `directory-picker-*` 填充） |

## 5. 清单（`0.2.2-rc.3`，116 条）

| 标记 | 含义 |
|---|---|
| ⚠ 顶替 | `replaceRisk: shadows-shipped-ui`：注册即替换宿主现有 UI |
| ~ 包裹 | `replaceRisk: wraps-owner-content`：你的组件包裹宿主内容，`children` 至多渲染一次 |
| — 追加 | `replaceRisk: none`：纯追加 |

### `(区域级)`（4）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `main` | keyed / root | client-ui-layout（经 `root` 条目） | ⚠ 顶替 |
| `rightbar` | single / root | client-ui-layout（经 `root` 条目） | ⚠ 顶替 |
| `root` | single / root | 运行时内置（恒存在） | ⚠ 顶替 |
| `sidebar` | single / root | client-ui-layout（经 `root` 条目） | ⚠ 顶替 |

### `shell`（4）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `shell.bottom` | single / root | client-ui-layout（经 `root` 条目） | ⚠ 顶替 |
| `shell.leading` | single / root | client-ui-layout（经 `root` 条目） | ⚠ 顶替 |
| `shell.overlay` | list / root | client-ui-layout（经 `root` 条目） | — 追加 |
| `shell.quota-notice` | chain / root | client-ui-chat（经 `shell.overlay` 条目） | — 追加 |

### `sidebar`（28）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `sidebar.brand.mark` | single / root | client-ui-sidebar（经 `sidebar` 条目） | ⚠ 顶替 |
| `sidebar.brand.name` | single / root | client-ui-sidebar（经 `sidebar` 条目） | ⚠ 顶替 |
| `sidebar.chat.conversation` | single / session | client-ui-subagent（经 `sidebar.right.pane.tab` 条目） | ⚠ 顶替 |
| `sidebar.footer.action` | list / root | client-ui-sidebar（经 `sidebar` 条目） | — 追加 |
| `sidebar.panellist` | list / root | client-ui-sidebar（组件工厂 `sidebar.panel.icon`） | — 追加 |
| `sidebar.panellist.actions` | list / root | client-ui-sidebar（经 `sidebar` 条目） | — 追加 |
| `sidebar.right.pane.tab` | keyed / session | client-ui-sidebar-right（经 `rightbar.session` 条目） | — 追加 |
| `sidebar.right.pane.tab.title` | keyed / session | client-ui-sidebar-right（经 `rightbar.session` 条目） | — 追加 |
| `sidebar.right.tab.document` | keyed / session | client-ui-sidebar-documentpreview（经 `sidebar.right.pane.tab` 条目） | — 追加 |
| `sidebar.right.tab.document.action` | keyed / session | client-ui-sidebar-documentpreview（经 `sidebar.right.pane.tab` 条目） | — 追加 |
| `sidebar.right.tab.document.actions` | list / session | client-ui-sidebar-documentpreview（经 `sidebar.right.pane.tab` 条目） | — 追加 |
| `sidebar.right.tab.document.office.pdf` | keyed / session | client-ui-sidebar-documentpreview（经 `sidebar.right.tab.document` 条目） | — 追加 |
| `sidebar.right.tab.document.unpreviewable` | list / session | client-ui-sidebar-documentpreview（经 `sidebar.right.pane.tab` 条目） | — 追加 |
| `sidebar.right.tab.files.actions` | list / session | client-ui-sidebar-files（经 `sidebar.right.pane.tab` 条目） | — 追加 |
| `sidebar.right.tab.guide` | chain / session | client-ui-sidebar-right（经 `sidebar.right.pane.tab` 条目） | — 追加 |
| `sidebar.right.tab.guide.actions` | list / root | client-ui-sidebar-right（经 `sidebar.right.pane.tab` 条目） | — 追加 |
| `sidebar.right.tab.guide.entry` | keyed / session | client-ui-sidebar-right（经 `sidebar.right.pane.tab` 条目） | — 追加 |
| `sidebar.right.tab.menu.item` | list / session | client-ui-sidebar-right（经 `contextMenu.content` 条目） | — 追加 |
| `sidebar.session.action` | hoc / root | client-ui-sidebar（经 `sidebar` 条目） | ~ 包裹 |
| `sidebar.session.row.hover` | list / root | client-ui-workspace（经 `sidebar.workspaces` 条目） | — 追加 |
| `sidebar.session.row.leading` | list / root | client-ui-workspace（经 `sidebar.workspaces` 条目） | — 追加 |
| `sidebar.session.row.trailing` | list / root | client-ui-workspace（经 `sidebar.workspaces` 条目） | — 追加 |
| `sidebar.settings` | single / root | client-ui-sidebar（经 `sidebar` 条目） | ⚠ 顶替 |
| `sidebar.toggle.badge` | single / root | client-ui-sidebar（经 `sidebar` 条目） | ⚠ 顶替 |
| `sidebar.workspaces` | single / root | client-ui-sidebar（经 `sidebar` 条目） | ⚠ 顶替 |
| `sidebar.workspaces.directoryFlow` | single / root | client-ui-workspace（经 `sidebar.workspaces` 条目） | ⚠ 顶替 |
| `sidebar.workspaces.session.menu.item` | list / root | client-ui-workspace（经 `contextMenu.content` 条目） | — 追加 |
| `sidebar.workspaces.session.row.action` | list / root | client-ui-workspace（经 `sidebar.workspaces` 条目） | — 追加 |

### `conversation`（46）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `conversation.approval.detail` | single / session | client-ui-approval（组件工厂 `conversation.approval.card`） | ⚠ 顶替 |
| `conversation.chat.assistant-actions` | list / session | client-ui-chat（经 `conversation.chat.node` 条目） | — 追加 |
| `conversation.chat.commandview` | keyed / session | client-ui-chat（经 `conversation.chat.node` 条目） | ⚠ 顶替 |
| `conversation.chat.flow` | single / session | client-ui-chat（经 `conversation.view` 条目） | ⚠ 顶替 |
| `conversation.chat.markdown.fence` | hoc / session | client-ui-chat（经 `conversation.view` 条目） | ~ 包裹 |
| `conversation.chat.message.images` | single / session | client-ui-chat（经 `conversation.chat.node` 条目） | ⚠ 顶替 |
| `conversation.chat.node` | keyed / session | client-ui-chat（经 `conversation.chat.flow` 条目） | ⚠ 顶替 |
| `conversation.chat.reasoning.body` | single / session | client-ui-chat（经 `conversation.chat.node` 条目） | ⚠ 顶替 |
| `conversation.chat.text-interaction` | keyed / session | client-ui-chat（经 `conversation.view` 条目） | ⚠ 顶替 |
| `conversation.chat.turnTail` | list / session | client-ui-chat（经 `conversation.chat.node` 条目） | — 追加 |
| `conversation.chat.user.before` | chain / session | client-ui-chat（经 `conversation.chat.node` 条目） | — 追加 |
| `conversation.chat.user.images` | single / session | client-ui-chat（组件工厂 `conversation.chat.user.content`） | ⚠ 顶替 |
| `conversation.composer` | chain / session | client-ui-conversation（组件工厂 `conversation.content`） | — 追加 |
| `conversation.composer.bar` | single / session-maybe | client-ui-conversation（组件工厂 `conversation.content`） | ⚠ 顶替 |
| `conversation.composer.dock` | list / session | client-ui-conversation（经 `conversation.composer.bar` 条目） | — 追加 |
| `conversation.header` | single / session-maybe | client-ui-conversation（经 `main.conversation` 条目） | ⚠ 顶替 |
| `conversation.header.leading` | single / root | client-ui-conversation（经 `conversation.header` 条目） | — 追加 |
| `conversation.hero.agentPreset` | single / session-maybe | client-ui-conversation（组件工厂 `conversation.content`） | ⚠ 顶替 |
| `conversation.hero.brand.mark` | single / root | client-ui-conversation（组件工厂 `conversation.content`） | — 追加 |
| `conversation.hero.frame` | hoc / root | client-ui-conversation（组件工厂 `conversation.content`） | ~ 包裹 |
| `conversation.hero.options` | list / session | client-ui-conversation（组件工厂 `conversation.content`） | — 追加 |
| `conversation.hero.workspace` | single / root | client-ui-conversation（组件工厂 `conversation.content`） | ⚠ 顶替 |
| `conversation.hero.workspace.directoryFlow` | single / root | client-ui-workspace（经 `conversation.hero.workspace` 条目） | ⚠ 顶替 |
| `conversation.input.activity` | single / session | client-ui-conversation（经 `conversation.composer.bar` 条目） | ⚠ 顶替 |
| `conversation.input.attachments` | single / session-maybe | client-ui-conversation（经 `conversation.composer.bar` 条目） | ⚠ 顶替 |
| `conversation.input.dock` | list / session | client-ui-conversation（组件工厂 `conversation.content`） | — 追加 |
| `conversation.input.left` | list / session | client-ui-conversation（经 `conversation.composer.bar` 条目） | — 追加 |
| `conversation.input.model` | single / session | client-ui-conversation（经 `conversation.composer.bar` 条目） | ⚠ 顶替 |
| `conversation.input.model.label` | single / session | client-ui-model-selection（经 `conversation.input.model` 条目） | — 追加 |
| `conversation.input.model.options` | list / session | client-ui-model-selection（经 `conversation.input.model` 条目） | — 追加 |
| `conversation.input.overlay` | list / session | client-ui-conversation（经 `conversation.composer.bar` 条目） | — 追加 |
| `conversation.input.permission` | single / session | client-ui-conversation（经 `conversation.composer.bar` 条目） | ⚠ 顶替 |
| `conversation.input.plan` | single / session | client-ui-conversation（经 `conversation.composer.bar` 条目） | ⚠ 顶替 |
| `conversation.input.right` | list / session | client-ui-conversation（经 `conversation.composer.bar` 条目） | — 追加 |
| `conversation.plan-review.actions` | list / session | client-ui-user-questions（经 `conversation.composer` 条目） | — 追加 |
| `conversation.session` | single / session | client-ui-conversation（组件工厂 `conversation.content`） | ⚠ 顶替 |
| `conversation.session.header` | single / session | client-ui-conversation（经 `conversation.header` 条目） | ⚠ 顶替 |
| `conversation.session.header.actions` | list / session | client-ui-conversation（经 `conversation.session.header` 条目） | — 追加 |
| `conversation.session.header.actions.subagent.footer` | list / session | client-ui-subagent（经 `conversation.session.header.actions` 条目） | — 追加 |
| `conversation.session.header.corner` | single / session | client-ui-conversation（经 `conversation.session.header` 条目） | ⚠ 顶替 |
| `conversation.session.header.lineage` | single / session | client-ui-conversation（经 `conversation.session.header` 条目） | ⚠ 顶替 |
| `conversation.session.header.utilities` | list / session | client-ui-conversation（经 `conversation.session.header` 条目） | — 追加 |
| `conversation.session.header.views.actions` | list / root | client-ui-conversation（经 `conversation.session.header` 条目） | — 追加 |
| `conversation.trajectory.images` | single / session | client-ui-trajectory（经 `conversation.view` 条目） | ⚠ 顶替 |
| `conversation.user.text.node` | keyed / session | client-ui-conversation（组件工厂 `conversation.user.text`） | ⚠ 顶替 |
| `conversation.view` | list / session | client-ui-conversation（经 `conversation.session` 条目） | — 追加 |

### `settings`（14）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `settings.action` | list / root | client-ui-settings-general（经 `sidebar.settings` 条目） | — 追加 |
| `settings.close` | single / root | client-ui-settings-general（经 `sidebar.settings` 条目） | ⚠ 顶替 |
| `settings.general.item` | list / root | client-ui-settings-general（经 `settings.section` 条目） | — 追加 |
| `settings.header` | single / root | client-ui-settings-general（经 `sidebar.settings` 条目） | ⚠ 顶替 |
| `settings.launcher` | single / root | client-ui-settings-general（经 `sidebar.settings` 条目） | ⚠ 顶替 |
| `settings.launcher.notifications` | single / root | client-ui-settings-account（经 `settings.launcher` 条目） | ⚠ 顶替 |
| `settings.models.footer` | list / root | client-ui-settings-models（经 `settings.section` 条目） | — 追加 |
| `settings.models.provider-card` | keyed / root | client-ui-settings-models（经 `settings.section` 条目） | — 追加 |
| `settings.models.sign-in` | single / root | client-ui-settings-models（经 `settings.onboarding` 条目） | ⚠ 顶替 |
| `settings.onboarding` | list / root | client-ui-settings-general（经 `sidebar.settings` 条目） | — 追加 |
| `settings.plugins.tab` | list / root | client-ui-settings-plugins（经 `settings.section` 条目） | — 追加 |
| `settings.section` | list / root | client-ui-settings-general（经 `sidebar.settings` 条目） | — 追加 |
| `settings.section.icon` | list / root | client-ui-settings-general（经 `sidebar.settings` 条目） | — 追加 |
| `settings.trigger` | single / root | client-ui-settings-general（经 `sidebar.settings` 条目） | ⚠ 顶替 |

### `plugins`（9）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `plugins.add.actions` | list / root | client-ui-plugin-manager（经 `main` 条目） | — 追加 |
| `plugins.bundle.activation` | keyed / root | client-ui-plugin-manager（经 `main` 条目） | ⚠ 顶替 |
| `plugins.bundle.config` | keyed / root | client-ui-plugin-manager（经 `main` 条目） | ⚠ 顶替 |
| `plugins.detail.actions` | list / root | client-ui-plugin-manager（经 `main` 条目） | — 追加 |
| `plugins.detail.badge` | list / root | client-ui-plugin-manager（经 `main` 条目） | — 追加 |
| `plugins.detail.section` | list / root | client-ui-plugin-manager（经 `main` 条目） | — 追加 |
| `plugins.item` | list / root | client-ui-plugin-manager（经 `main` 条目） | — 追加 |
| `plugins.row.config` | keyed / root | client-ui-plugin-manager（经 `main` 条目） | — 追加 |
| `plugins.tab` | list / root | client-ui-plugin-manager（经 `main` 条目） | — 追加 |

### `contextMenu`（2）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `contextMenu.content` | keyed / root | client-ui-context-menu（经 `shell.overlay` 条目） | ⚠ 顶替 |
| `contextMenu.icon` | keyed / root | client-ui-context-menu（经 `shell.overlay` 条目） | ⚠ 顶替 |

### `tool`（3）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `tool.call.images` | single / session | client-ui-tool（经 `tool.call.toolview` 条目） | ⚠ 顶替 |
| `tool.call.toolview` | keyed / session | client-ui-tool（经 `conversation.chat.node` 条目） | ⚠ 顶替 |
| `tool.view.cordis` | keyed / session | client-ui-cordis（经 `tool.call.toolview` 条目） | — 追加 |

### `deliverables`（2）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `deliverables.file.actions` | list / session | client-ui-deliverables（经 `conversation.chat.turnTail` 条目） | — 追加 |
| `deliverables.review.file.actions` | list / session | client-ui-deliverables（经 `sidebar.right.pane.tab` 条目） | — 追加 |

### `workspace`（2）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `workspace.picker.directoryFlow` | single / root | client-ui-workspace（组件工厂 `workspace.picker`） | ⚠ 顶替 |
| `workspace.toast` | keyed / root | client-ui-workspace（经 `shell.overlay` 条目） | ⚠ 顶替 |

### `main`（1）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `main.conversation` | single / session-maybe | client-ui-conversation（经 `main` 条目） | ⚠ 顶替 |

### `rightbar`（1）

| 槽位 | 类型 / scope | 声明者 | 风险 |
|---|---|---|---|
| `rightbar.session` | single / session | client-ui-sidebar-right（经 `rightbar` 条目） | ⚠ 顶替 |

> 采集方式：直接解析安装内 `slot-catalog.ts` 的 `CLIENT_SLOT_API`（不是正则扫 bundle）。升级后重新生成，或直接读目录。
