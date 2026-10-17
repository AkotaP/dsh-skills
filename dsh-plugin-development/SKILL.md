---
name: dsh-plugin-development
description: 开发、修改、安装、调试 DSH（DeepSeek Harness）插件——bundle 清单、宿主半（Node ESM）、客户端 UI 半（浏览器 bundle）、槽位注册、volatile 配置通道、热更新与离线测试。适用于为 Harness 添加页面/面板/按钮/装饰物/工具/MCP，或改动、排查已安装插件。
whenToUse: 需要编写、修改、安装或排查 DSH 插件时；或官方 cordis-plugin-development 所依赖的 plugin_manager / cordis_inspect_* 在会话中不可用时。
---

# DSH 插件开发（实测版）

本 skill 补官方 `cordis-plugin-development` 的缺口：**官方流程假定 creator mode 工具存在**（`plugin_manager`、`cordis_inspect_*`），但 `ptc`/`standard` preset 并不挂载它们；官方文档中另有若干条命令在 Desktop profile 下实测不可用。

> **版本敏感**：本 skill 编写基线为 DSH `0.1.7-rc.2`；复核时安装为 `0.2.0-rc.2`，再复核为 **`0.2.1-rc.2`**（客户端槽位 85 → 86，参考插件 30 条离线测试仍全绿）。**`0.2.1` 起 `engines.dsh` 会被真实校验，不满足会禁用插件**（见 `references/version-compat.md` §5）。下文标「实测」的结论都绑定具体版本，**升级后用 `references/version-compat.md` 重新核对，不要照搬**。

## 0. 先分清四条路

| 任务 | 走哪条 | 关键代价 |
|---|---|---|
| 修改已有插件的配置字段值 | 直接改 profile 的 `cordis.patch.yml` | 属于对 `~/.dsh` 的写入：**需先经用户确认**；重启或热更后生效 |
| 编写新插件 / 改插件代码（默认 preset） | **本文 §2–§3 的手工路线** | 改 `~/.dsh` 三处 + 重启 DSH：**需先经用户确认** |
| 同上，但会话处于 `cordis` preset（creator mode） | 官方 skill + `plugin_manager` `install_bundle` | 仍需审批，但无需手改 profile |
| 仅接入 MCP server | 纯配置 bundle（无 JS），见官方 `cordis-plugin-development` skill 的 `cordis-plugin-development/references/mcp-bundle.md` | 同上 |

判断当前会话有没有 creator 工具：查看工具表中是否存在 `plugin_manager` / `cordis_inspect_query`。**有**则优先走官方 skill；**没有**（默认 preset）按本文走。切换方式见 §5。

## 1. 事实基线（实测）

- 版本不是常量：按 `references/version-compat.md` §1 读当前安装的 `desktop-runtime.json` 与各包 `package.json`（再复核时为 DSH `0.2.1-rc.2`、cordis `4.0.5`、schemastery `3.18.5`、Node `v24.21.0`）。
- shell 中会注入 `DSH_HOME`（数据根目录，默认 `~/.dsh`）、`DSH_PROFILE`（当前 profile 名）、`DSH_PROFILE_DIR`（该 profile 目录）；未设置表示 harness 未以 profile 启动。通用取值方式见 `references/paths.md`。
- **`dsh --profile desktop --dump-config` 在 Desktop profile 下失败**：`error: profile "desktop" is managed exclusively by the Electron application`。查看合成配置需改用 §5 的方式。
- 官方包与安装同处一个 asar 归档，**位置随安装目录变化**，不要写死。**只有宿主进程自身的 `fs` 能读取**（例如 `run_code` 里的 `node:fs`）；`rg`/`glob`/`pwsh` 的 `ls`/`cat` 均报 `ENOENT`。定位方式与读取示例见 `references/paths.md`。查 API 优先读包目录下的 `README.md`，其次 `lib/index.js`（部分 build 不含 `lib/types`）。
- 一个插件 = 一个 npm 包，两半：
  - **宿主半** `lib/index.js`：普通 Node ESM，运行在 DSH 宿主进程内。
  - **客户端半** `lib/client.js`：浏览器 bundle，形如 `window.__ModuleLoader__.load({ id, factory })`。
  - **清单** `package.json` 的 `dsh.bundle.patch`（→ `cordis.patch.yml`）+ `dsh.client.*`。
- 生效机制：**客户端半改文件即热更**（`dsh-client-hmr` 默认 500ms 轮询入口产物，按 mtime/ctime/size 判定 revision）；**宿主半改动必须重启 DSH**（除非 profile 额外挂载 `@deepseek-ai/dsh-hmr` 并配置 `root`）。

## 2. 最小可跑插件（四文件）

`scripts/scaffold-plugin.mjs` 可生成下列骨架，也可照抄：

```
my-plugin/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # insert 一行插件条目
├── index.js              # 宿主半：export apply / inject / Config
└── client.js             # 客户端半：__ModuleLoader__.load + slots.register
```

`package.json` 关键字段：

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "engines": { "node": ">=20", "dsh": ">=0.2.1-rc.2" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
}
```

`engines.dsh` 会被 DSH 真实检查（`0.2.1+` 优先，`0.2.0` 只查 `@deepseek-ai/dsh*` peer），不满足会禁用插件、拒绝安装；要兼容 `0.2.0` 旧宿主就在 `peerDependencies` 里再写同范围的 `@deepseek-ai/dsh`。详见 `references/version-compat.md` §5。

`cordis.patch.yml`（行 id 必须与客户端 `configForms.get(id)` 一致）：

```yaml
- insert:
    - id: my-plugin
      name: '@local/my-plugin'
      config: {}
```

宿主半最小形（`export { name, apply, inject }`；**只有**需要设置页可编辑字段时才再导出 schemastery 的 `Config`——写成 `export const Config = {}` 会在加载期校验时抛错、插件不激活。**不要混用** default class 形态）：

```js
export const name = 'my-plugin'
export const inject = ['webServer']            // 必需服务：缺失会阻塞启动
export function apply(ctx) {
  ctx.effect(() => ctx.get('webServer')?.register({
    kind: 'prefix', path: '/my/api',
    handler: (req, res) => { res.writeHead(200); res.end('{}') },
  }), 'my-plugin: routes')                      // 第二参是诊断标签
}
```

`ctx.effect(execute, label)`：立即执行 `execute`，收集其返回的 disposer，fiber 销毁时**逆序**执行（cordis `4.0.4` 源码确认）。所有注册动作（路由、监听、样式、定时器）都应放进 `ctx.effect`。

客户端半最小形：

```js
window.__ModuleLoader__.load({
  id: '@local/my-plugin',              // 必须等于包名
  factory: (require) => {
    const React = require('react')      // React 来自模块表，不要再装一份
    return {
      inject: ['slots', 'locale'],
      apply(ctx) { /* ctx.slots.inject(...) / ctx.locale.register(...) */ },
    }
  },
})
```

细节见 `references/host-half.md` 与 `references/client-half.md`。

## 3. 装入 profile（手工路线）

**每一步都在写 `~/.dsh`：动手前需取得用户明确同意，并说明这需要重启 DSH（重启会打断正在运行的会话）。** 共三处 + 一次安装 + 一次重启：

1. profile 的 `package.json`（即 `$DSH_PROFILE_DIR/package.json`）
   - `dependencies` 加 `"<pkg-name>": "link:<插件仓库绝对路径>"`（开发期）或版本号（已发布 npm）
   - `dsh.profile.bundles` 数组加 `"<pkg-name>"`
2. 在 profile 目录执行 `pnpm install`（建立 link；这是手工路线中唯一必须跑 pnpm 的地方）
3. profile 的 `cordis.patch.yml`（即 `$DSH_PROFILE_DIR/cordis.patch.yml`）加条目（可带 `config` 覆盖默认值；注意 **patch 整体替换 `config`，不是深合并**）：
   ```yaml
   - insert:
       - id: my-plugin
         name: '@local/my-plugin'
         config: {}
   ```
4. 经用户确认后重启 DSH（宿主半才会加载）。
5. 验证：设置 → 插件页应出现条目；涉及 UI 时由用户刷新页面确认。

回滚：删除 patch 条目 + 从 `dsh.profile.bundles` 移除 + `pnpm remove`，然后重启。
完整命令、creator-mode 路线对照、HMR 与发版见 `references/install-and-devloop.md`。

## 4. 验证（不得以「应该能用」结案）

1. **离线单测**（插件自带 `test/`，用桩模块图直接跑构建产物）：
   ```powershell
   cd <plugin-repo>
   node --test --test-isolation=none     # 进程内执行，避免沙箱下的 spawn EPERM
   ```
   **沙箱环境下必须加 `--test-isolation=none`**：默认每个测试文件 spawn 子进程并走管道，会触发 `EPERM spawn`（实测）。
2. **宿主接口**：重启后直接请求 loopback 路由验证响应与状态码。
3. **UI**：没有浏览器控制工具时，请用户刷新页面并提供截图或控制台报错；**在未实际观察前不得声称界面正常**。槽位条目崩溃会在控制台输出 `slot entry crashed in '<slot>'`。
4. 改了宿主半却未重启就宣称「已生效」属于虚假报告，这是最常见的自欺。

## 5. 排查入口

| 目标 | 方式 |
|---|---|
| 当前 profile 装了什么 | 读 `~/.dsh/profiles/desktop/package.json`（`dsh.profile.bundles`）+ `cordis.patch.yml` |
| 合成后的完整插件树 | Electron 托管的 profile 下没有可用的 dump CLI；改为读各 bundle 的 `cordis.patch.yml`（例如 `@deepseek-ai/dsh-web-app`，包目录定位见 `paths.md` §2）叠加 profile patch，或查看 UI 插件页 |
| 官方包的 API | asar 路径下该包的 `README.md`（第一权威），其次 `lib/index.js` |
| 官方 skill 全文 | `.../dsh-agent-preset/skills/cordis-plugin-development/`（用宿主进程的 `fs` 读，不要用 shell） |
| 切换 creator mode | 改 `agent-preset-registry` 的 `selectedDefault`，或在新建会话时选择 `cordis` preset——它会挂载 `@deepseek-ai/dsh-tool-cordis` + `@deepseek-ai/dsh-plugin-manager/tools` |
| 插件被禁用 / 安装被拒（版本不兼容） | stderr 的 `disabling profile plugin`、`dsh plugin version-exemptions`、profile 目录的 `compatibility.json`（见 `version-compat.md` §5） |

## 6. 可直接参照的样例

任何安装里都自带一批可读的官方插件，与当前 harness 同版本，比第三方仓库更可靠：

| 想参考什么 | 读哪个包（目录定位见 `paths.md` §2） |
|---|---|
| 宿主 HTTP 路由、状态码与请求校验 | `@deepseek-ai/dsh-host-webserver`（README）、`@deepseek-ai/dsh-host-open-in-app`（实际路由注册） |
| 设置页分区 | `@deepseek-ai/dsh-client-ui-settings-general`、`@deepseek-ai/dsh-client-ui-settings-models` |
| 侧边栏会话行的按钮与「…」菜单项 | `@deepseek-ai/dsh-client-ui-workspace`、`@deepseek-ai/dsh-client-ui-schedule` |
| volatile 配置通道的服务端实现 | `@deepseek-ai/dsh-settings`（README + `lib/index.js`） |
| 槽位注册与渲染契约 | `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-renderer` |
| 客户端热更行为 | `@deepseek-ai/dsh-client-hmr`（README） |

读法：先读该包目录下的 `README.md`（第一权威），再读 `lib/index.js`。第三方插件仓库同样可作样例，但要注意其适配的 harness 版本可能不同。

## 7. 版本与兼容

harness 迭代很快，任何「实测」结论都会过期。升级前后各做一次 **API 表面快照**并 diff：

```js
// 在宿主进程内执行（agent 会话里用 run_code）
// node scripts/api-snapshot.mjs --out before.json
// …升级…
// node scripts/api-snapshot.mjs --diff before.json
```

输出会列出**包版本变化、槽位新增/消失、服务新增/消失**——正好是插件最容易被打断的三类依赖。完整流程（版本从哪读、官方有无 CHANGELOG、兼容写法、升级后回归清单）见 `references/version-compat.md`。插件声明的宿主版本（`engines.dsh` / peer）从 `0.2.1` 起会被真实检查，升级后先核对 `version-compat.md` §5。

## Read next

| 主题 | 文件 |
|---|---|
| 环境变量、安装目录与包目录的通用定位（不写死路径） | `references/paths.md` |
| 宿主半：导出形态、inject 与 ctx.get、Config/volatile、路由、生命周期、错误约定 | `references/host-half.md` |
| 客户端半：模块格式、slots 注册、locale、CSS、热更、版本容错 | `references/client-half.md` |
| 真实槽位清单（实测 86 个，含声明包）与发现方法 | `references/slots.md` |
| volatile 配置通道：宿主 schema + 客户端 configForms 读写与报错 | `references/config-channel.md` |
| 两条安装路线、依赖解析不对称、HMR、重启、发版、回滚 | `references/install-and-devloop.md` |
| 离线测试 harness 的写法、断言范围、沙箱下的跑法 | `references/testing.md` |
| 坑清单（23 条，全部来自实测或真实故障） | `references/pitfalls.md` |
| 版本怎么读、插件声明的宿主版本如何被检查/豁免、升级前后怎么对齐 | `references/version-compat.md` |
| 生成最小插件骨架 | `scripts/scaffold-plugin.mjs` |
| 采集/对比 API 表面（版本、槽位、服务） | `scripts/api-snapshot.mjs` |
