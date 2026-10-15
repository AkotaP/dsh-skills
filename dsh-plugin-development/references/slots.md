# 槽位（Slots）

槽位是宿主页面预留的扩展位；插件**注册进**已声明的槽位，不能自造槽位名。

## 如何找到"对的槽位"

1. **有 creator mode 时**（工具表里有 `cordis_inspect_query`）：查 `Slots` provider，用 `Slots.listSubTree` 看目标槽位子树、注册选项与 props。这是官方推荐路径，也最准。
2. **没有 creator mode 时**：
   - 用下文的清单（程序化扫描生成，见文件末尾说明）。
   - 读声明包的 `README.md` 与 `lib/client.js`（包目录的定位方式见 `paths.md`），搜槽位名即可看到它声明在哪里、传什么 props。
3. **抄同类的官方做法**：要加"管理列表里的东西"就照 Plugin 管理页；要加"会话行按钮"就照官方 archive/pin 的 order 与结构。
4. **判断一个名字存不存在要用 `ctx.slots.spec(name)`，别把下面的清单当全集**：清单收的是"当前 build 里真实出现过的注册目标"；而插件常把某个槽位名当**可选父槽**去 `inject`，那个名字在当前 harness 里可能一个字母都不存在——此时回调只是永不执行（安全，不 throw）。所以：清单里没有 ≠ 名字写错；清单里有 ≠ 一定能注册成功（还要看自己的客户端依赖有没有加载）。

## 选槽位的纪律

- **选本来就分配了空间的槽位**（`conversation.composer.dock`、`settings.section`、`shell.overlay`…），不要用绝对定位压在宿主控件上。
- **不要读其他插件的 DOM/样式表**来猜位置。
- 需要浮层（弹窗/提示）时用 `shell.overlay`（frame 级），**不要**挂在会卸载的容器里。
- `order` 决定同槽位内顺序：官方在侧边栏行操作用 100/200（archive/pin），新条目取 300 即排在其后；「…」菜单官方用到 400，新条目取 450。

## 典型注册示例（槽位与顺序）

| 用途 | 槽位 | id / order |
|---|---|---|
| 设置页一个分区 | `settings.section` | `my-plugin-settings` / 200（配 `label` + `locale`） |
| 会话标题栏按钮 | `conversation.session.header.actions` | `my-plugin-action` / 300 |
| 侧边栏会话行悬停按钮 | `sidebar.workspaces.session.row.action` | 同上 / 300 |
| 「…」菜单项 | `sidebar.workspaces.session.menu.item` | 同上 / 450 |
| 确认弹窗 | `shell.overlay` | `my-plugin-confirm` / 200 |

## 清单

> **版本敏感**：本清单采集自 `0.2.0-rc.2`，共 **86** 个槽位。上一版（`0.1.7-rc.2`）为 85 个：`0.2.0` 新增 `sidebar.right.tab.files.actions`，无移除。**升级 harness 后请重新采集**——用 `scripts/api-snapshot.mjs` 做前后 diff 最省事。
>
> 生成方式：扫描安装自带 `@deepseek-ai/dsh-client-*` 各包的 `lib/**/*.js`，取注册/注入/渲染调用点里的字符串，只保留槽位名与声明包名。它代表"该 build 里真实出现过的槽位名"，不等于类型声明全集。

### `shell.*`（2）

| 槽位 | 声明包 |
|---|---|
| `shell.leading` | `dsh-client-ui-layout`, `dsh-client-ui-sidebar` |
| `shell.overlay` | `dsh-client-ui-chat`, `dsh-client-ui-layout`, `dsh-client-ui-plugin-manager`, `dsh-client-ui-schedule`, `dsh-client-ui-settings-session-log`, `dsh-client-ui-shortcuts`, `dsh-client-ui-workspace` |

### `sidebar.*`（22）

| 槽位 | 声明包 |
|---|---|
| `sidebar.brand.mark` | `dsh-client-ui-brand-official`, `dsh-client-ui-sidebar` |
| `sidebar.brand.name` | `dsh-client-ui-brand-official`, `dsh-client-ui-sidebar` |
| `sidebar.chat.conversation` | `dsh-client-ui-subagent` |
| `sidebar.footer.action` | `dsh-client-ui-cordis`, `dsh-client-ui-sidebar` |
| `sidebar.panellist` | `dsh-client-ui-plugin-manager`, `dsh-client-ui-schedule`, `dsh-client-ui-sidebar` |
| `sidebar.right.pane.tab` | `dsh-client-ui-deliverables`, `dsh-client-ui-plan`, `dsh-client-ui-schedule`, `dsh-client-ui-sidebar-browser`, `dsh-client-ui-sidebar-documentpreview`, `dsh-client-ui-sidebar-files`, `dsh-client-ui-sidebar-right`, `dsh-client-ui-sidebar-terminal`, `dsh-client-ui-subagent` |
| `sidebar.right.pane.tab.title` | `dsh-client-ui-plan`, `dsh-client-ui-schedule`, `dsh-client-ui-sidebar-browser`, `dsh-client-ui-sidebar-documentpreview`, `dsh-client-ui-sidebar-files`, `dsh-client-ui-sidebar-right`, `dsh-client-ui-sidebar-terminal` |
| `sidebar.right.tab.document` | `dsh-client-ui-sidebar-documentpreview` |
| `sidebar.right.tab.document.action` | `dsh-client-ui-sidebar-documentpreview` |
| `sidebar.right.tab.document.actions` | `dsh-client-ui-open-in-app`, `dsh-client-ui-sidebar-documentpreview` |
| `sidebar.right.tab.document.unpreviewable` | `dsh-client-ui-open-in-app`, `dsh-client-ui-sidebar-documentpreview` |
| `sidebar.right.tab.files.actions` | `dsh-client-ui-open-in-app`, `dsh-client-ui-sidebar-files` |
| `sidebar.right.tab.guide.entry` | `dsh-client-ui-sidebar-right`, `dsh-client-ui-sidebar-terminal` |
| `sidebar.right.tab.menu.item` | `dsh-client-ui-sidebar-right` |
| `sidebar.session.row.hover` | `dsh-client-ui-schedule`, `dsh-client-ui-workspace` |
| `sidebar.session.row.leading` | `dsh-client-ui-schedule`, `dsh-client-ui-workspace` |
| `sidebar.settings` | `dsh-client-ui-settings-general`, `dsh-client-ui-sidebar` |
| `sidebar.toggle.badge` | `dsh-client-ui-settings-general`, `dsh-client-ui-sidebar` |
| `sidebar.workspaces` | `dsh-client-ui-sidebar`, `dsh-client-ui-workspace` |
| `sidebar.workspaces.directoryFlow` | `dsh-client-ui-directory-picker-browse`, `dsh-client-ui-directory-picker-native`, `dsh-client-ui-workspace` |
| `sidebar.workspaces.session.menu.item` | `dsh-client-ui-workspace` |
| `sidebar.workspaces.session.row.action` | `dsh-client-ui-workspace` |

### `conversation.*`（33）

| 槽位 | 声明包 |
|---|---|
| `conversation.approval.detail` | `dsh-client-ui-approval`, `dsh-client-ui-chat` |
| `conversation.chat.assistant-actions` | `dsh-client-ui-chat`, `dsh-client-ui-message-feedback` |
| `conversation.chat.commandview` | `dsh-client-ui-chat` |
| `conversation.chat.node` | `dsh-client-ui-chat`, `dsh-client-ui-goal`, `dsh-client-ui-tool`, `dsh-client-ui-user-questions`, `dsh-client-ui-workflow-run` |
| `conversation.chat.turnTail` | `dsh-client-ui-chat`, `dsh-client-ui-deliverables`, `dsh-client-ui-plan`, `dsh-client-ui-schedule` |
| `conversation.composer` | `dsh-client-ui-approval`, `dsh-client-ui-subagent`, `dsh-client-ui-user-questions` |
| `conversation.composer.bar` | `dsh-client-ui-conversation` |
| `conversation.composer.dock` | `dsh-client-ui-chat`, `dsh-client-ui-conversation` |
| `conversation.header` | `dsh-client-ui-conversation` |
| `conversation.header.leading` | `dsh-client-ui-conversation` |
| `conversation.hero.agentPreset` | `dsh-client-ui-agent-preset`, `dsh-client-ui-conversation` |
| `conversation.hero.brand.mark` | `dsh-client-ui-conversation` |
| `conversation.hero.workspace` | `dsh-client-ui-conversation`, `dsh-client-ui-workspace` |
| `conversation.hero.workspace.directoryFlow` | `dsh-client-ui-directory-picker-browse`, `dsh-client-ui-directory-picker-native`, `dsh-client-ui-workspace` |
| `conversation.input.activity` | `dsh-client-ui-conversation` |
| `conversation.input.attachments` | `dsh-client-ui-attachment`, `dsh-client-ui-conversation` |
| `conversation.input.dock` | `dsh-client-ui-conversation`, `dsh-client-ui-goal` |
| `conversation.input.left` | `dsh-client-ui-conversation` |
| `conversation.input.model` | `dsh-client-ui-conversation`, `dsh-client-ui-model-selection` |
| `conversation.input.overlay` | `dsh-client-ui-commands`, `dsh-client-ui-conversation`, `dsh-client-ui-input-trigger`, `dsh-client-ui-message-feedback` |
| `conversation.input.permission` | `dsh-client-ui-conversation`, `dsh-client-ui-permission-presets` |
| `conversation.input.plan` | `dsh-client-ui-conversation`, `dsh-client-ui-plan` |
| `conversation.input.right` | `dsh-client-ui-conversation` |
| `conversation.message.images` | `dsh-client-ui-attachment`, `dsh-client-ui-chat` |
| `conversation.plan-review.actions` | `dsh-client-ui-plan`, `dsh-client-ui-user-questions` |
| `conversation.session` | `dsh-client-ui-conversation`, `dsh-client-ui-subagent` |
| `conversation.session.header` | `dsh-client-ui-conversation` |
| `conversation.session.header.actions` | `dsh-client-ui-agent-preset`, `dsh-client-ui-conversation`, `dsh-client-ui-jobs`, `dsh-client-ui-subagent` |
| `conversation.session.header.corner` | `dsh-client-ui-conversation`, `dsh-client-ui-sidebar-right` |
| `conversation.session.header.lineage` | `dsh-client-ui-conversation`, `dsh-client-ui-subagent` |
| `conversation.session.header.utilities` | `dsh-client-ui-conversation`, `dsh-client-ui-open-in-app`, `dsh-client-ui-schedule` |
| `conversation.trajectory.images` | `dsh-client-ui-attachment`, `dsh-client-ui-trajectory` |
| `conversation.view` | `dsh-client-ui-chat`, `dsh-client-ui-conversation`, `dsh-client-ui-trajectory` |

### `settings.*`（12）

| 槽位 | 声明包 |
|---|---|
| `settings.action` | `dsh-client-ui-settings-general` |
| `settings.close` | `dsh-client-ui-settings-general` |
| `settings.general.item` | `dsh-client-locale`, `dsh-client-ui-chat`, `dsh-client-ui-conversation`, `dsh-client-ui-permission-presets`, `dsh-client-ui-settings-general`, `dsh-client-ui-settings-session-log`, `dsh-client-ui-shortcuts`, `dsh-client-ui-theme` |
| `settings.header` | `dsh-client-ui-settings-general` |
| `settings.launcher` | `dsh-client-ui-settings-general` |
| `settings.models.footer` | `dsh-client-ui-settings-models` |
| `settings.models.provider-card` | `dsh-client-ui-settings-models` |
| `settings.models.sign-in` | `dsh-client-ui-settings-models` |
| `settings.onboarding` | `dsh-client-ui-settings-general`, `dsh-client-ui-settings-models` |
| `settings.plugins.tab` | `dsh-client-ui-settings-plugin-inventory`, `dsh-client-ui-settings-plugins` |
| `settings.section` | `dsh-client-ui-agent-preset`, `dsh-client-ui-settings-general`, `dsh-client-ui-settings-models`, `dsh-client-ui-settings-plugins` |
| `settings.trigger` | `dsh-client-ui-settings-general` |

### `plugins.*`（7）

| 槽位 | 声明包 |
|---|---|
| `plugins.bundle.activation` | `dsh-client-ui-plugin-manager` |
| `plugins.bundle.config` | `dsh-client-ui-plugin-manager` |
| `plugins.detail.actions` | `dsh-client-ui-plugin-manager` |
| `plugins.detail.badge` | `dsh-client-ui-plugin-manager` |
| `plugins.detail.section` | `dsh-client-ui-plugin-manager` |
| `plugins.item` | `dsh-client-ui-plugin-manager`, `dsh-client-ui-settings-agent-loop`, `dsh-client-ui-settings-shell`, `dsh-client-ui-settings-subagent`, `dsh-client-ui-settings-web-search` |
| `plugins.row.config` | `dsh-client-ui-plugin-manager` |

### `tool.*`（3）

| 槽位 | 声明包 |
|---|---|
| `tool.call.images` | `dsh-client-ui-attachment`, `dsh-client-ui-tool` |
| `tool.call.toolview` | `dsh-client-ui-cordis`, `dsh-client-ui-deliverables`, `dsh-client-ui-skill`, `dsh-client-ui-tool` |
| `tool.view.cordis` | `dsh-client-ui-cordis` |

### `deliverables.*`（2）

| 槽位 | 声明包 |
|---|---|
| `deliverables.file.actions` | `dsh-client-ui-deliverables`, `dsh-client-ui-open-in-app` |
| `deliverables.review.file.actions` | `dsh-client-ui-deliverables`, `dsh-client-ui-open-in-app` |

### `input.*`（1）

| 槽位 | 声明包 |
|---|---|
| `input.file` | `dsh-client-ui-conversation` |

### `main.*`（1）

| 槽位 | 声明包 |
|---|---|
| `main.conversation` | `dsh-client-ui-conversation` |

### `rightbar.*`（1）

| 槽位 | 声明包 |
|---|---|
| `rightbar.session` | `dsh-client-ui-sidebar-right` |

### `command.*`（1）

| 槽位 | 声明包 |
|---|---|
| `command.label` | `dsh-client-ui-model-selection` |

### `remote.*`（1）

| 槽位 | 声明包 |
|---|---|
| `remote.officeToPdf` | `dsh-client-ui-sidebar-documentpreview` |

