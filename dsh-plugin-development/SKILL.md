---
name: dsh-plugin-development
description: 开发、修改、安装、调试 DSH（DeepSeek Harness）插件——bundle 清单、宿主半（Node ESM）、客户端 UI 半（浏览器 bundle）、槽位注册、volatile 配置通道、热更新与离线测试。适用于为 Harness 添加页面/面板/按钮/装饰物/工具/MCP，或改动、排查已安装插件。
whenToUse: 需要编写、修改、安装或排查 DSH 插件时；或官方 cordis-plugin-development 所依赖的 plugin_manager / cordis_inspect_* 在会话中不可用时。
---

# DSH 插件开发（实测版）

本 skill 补官方 `cordis-plugin-development` 的缺口：**官方流程假定 creator mode 工具存在**（`plugin_manager`、`cordis_inspect_*`），但 `ptc`/`standard` preset 并不挂载它们；官方文档中另有若干条命令在 Desktop profile 下实测不可用。

> **版本敏感**：本 skill 编写基线为 DSH `0.1.7-rc.2`；复核时安装为 `0.2.0-rc.2`，再复核为 **`0.2.1-rc.2`**（客户端槽位 85 → 86，参考插件 30 条离线测试仍全绿）。**`0.2.1` 起 `engines.dsh` 会被真实校验，不满足会禁用插件**（见 `references/version-compat.md` §5）。下文标「实测」的结论都绑定具体版本，**升级后用 `references/version-compat.md` 重新核对，不要照搬**。
>
> **热重载不是 `0.2.1` 才有的**：`dsh-base` 的 `hmr` 行从 **`0.0.1-rc.1`** 就在（当时是 vendored 的 `@deepseek-ai/cordis-plugin-hmr`，`root: ['.']`，源码监听）；`0.1.5-rc.1` 里一度 `disabled: true`（改为按 profile 自选）；`0.1.6-alpha.2`（2026-09-17）起换成 `@deepseek-ai/dsh-hmr` 并在有 `profileContext` 时默认开启（`root: []`）。但两代能力不同：`0.1.6-alpha.2`–`0.2.1-alpha.2` 只做**配置层**重组，装新包与改宿主半代码仍要重启；**`0.2.1-alpha.3` 起**纳入 `recomposeProfile()`（发布新解析 + 替换变过的已加载模块），**装插件从此完全不需要重启**。版本沿革见 `references/install-and-devloop.md` §开发循环。

## 0. 先分清四条路

| 任务 | 走哪条 | 关键代价 |
|---|---|---|
| 修改已有插件的配置字段值 | 直接改 profile 的 `cordis.patch.yml` | 属于对 `~/.dsh` 的写入：**需先经用户确认**；保存后由 HMR 重组，即时生效 |
| 编写新插件 / 改插件代码（默认 preset） | **本文 §2–§3 的手工路线** | 改 `~/.dsh` 三处：**需先经用户确认**；安装与配置改动即时热重组，仅少数情况需重启（§3） |
| 同上，但会话处于 `cordis` preset（creator mode） | 官方 skill + `plugin_manager` `install_bundle` | 仍需审批，但无需手改 profile |
| 仅接入 MCP server | 纯配置 bundle（无 JS），见官方 `cordis-plugin-development` skill 的 `cordis-plugin-development/references/mcp-bundle.md` | 同上 |

判断当前会话有没有 creator 工具：查看工具表中是否存在 `plugin_manager` / `cordis_inspect_query`。**有**则优先走官方 skill；**没有**（默认 preset）按本文走。切换方式见 §5。

## 1. 事实基线（实测）

- 版本不是常量：按 `references/version-compat.md` §1 读当前安装的 `desktop-runtime.json` 与各包 `package.json`（再复核时为 DSH `0.2.1-rc.2`、cordis `4.0.5`、schemastery `3.18.5`、Node `v24.21.0`；版本号会漂，以现场 `node_modules` 里的 `package.json` 为准）。
- shell 中会注入 `DSH_HOME`（数据根目录，默认 `~/.dsh`）、`DSH_PROFILE`（当前 profile 名）、`DSH_PROFILE_DIR`（该 profile 目录）；未设置表示 harness 未以 profile 启动。通用取值方式见 `references/paths.md`。
- **`dsh --profile desktop --dump-config` 在 Desktop profile 下失败**：`error: profile "desktop" is managed exclusively by the Electron application`。查看合成配置需改用 §5 的方式。
- 官方包与安装同处一个 asar 归档，**位置随安装目录变化**，不要写死。**只有宿主进程自身的 `fs` 能读取**（例如 `run_code` 里的 `node:fs`）；`rg`/`glob`/`pwsh` 的 `ls`/`cat` 均报 `ENOENT`。定位方式与读取示例见 `references/paths.md`。查 API 优先读包目录下的 `README.md`，其次 `lib/index.js`（部分 build 不含 `lib/types`）。
- 一个插件 = 一个 npm 包，两半：
  - **宿主半** `lib/index.js`：普通 Node ESM，运行在 DSH 宿主进程内。
  - **客户端半** `lib/client.js`：浏览器 bundle，形如 `window.__ModuleLoader__.load({ id, factory })`。
  - **清单** `package.json` 的 `dsh.bundle.patch`（→ `cordis.patch.yml`）+ `dsh.client.*`。
- 生效机制（`0.2.1` 实测）：
  - **客户端半**：`dsh-client-hmr` 默认 500ms 轮询入口产物，按 mtime/ctime/size 判定 revision；同时经 `/plugins/events` SSE 推送插件图，**开着的页面不用手动刷新**。
  - **宿主半（`0.2.1+` 实测）**：HMR 默认随 base bundle 启用（不需要额外挂载，`root: []` 只表示不监听源码文件）。profile 的 `package.json`（仅 `dsh.profile.bundles` 有序列表变化时）、profile `cordis.patch.yml`、home patch 都在监视列表里；任一变化触发一次**重组**，重组会停下受影响的 Loader 条目、驱逐已加载模块、按磁盘当前内容重新 import——所以**装插件、开关插件、改已加载插件（含 link 插件）的宿主半代码都不用重启**。`root: []` 下改源码文件本身不触发重组，保存一次 patch 或做一次插件页操作即可。

## 2. 最小可跑插件（四文件）

`scripts/scaffold-plugin.mjs` 可生成下列骨架，也可照抄：

```
my-plugin/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # insert 一行插件条目
├── index.js              # 宿主半：export apply / inject / Config
└── client.js             # 客户端半：__ModuleLoader__.load + slots.register
```

`index.js`/`client.js` 放包根（exports 指向 `./index.js`）还是放 `lib/`（exports 指向 `./lib/index.js`）都行；官方包与 Plugin Manager 的样例统一用 `lib/`，跟它对齐少一次解释。

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
export function apply(ctx, config) {        // 第二个参数才是配置，不是 ctx.config
  ctx.effect(() => ctx.get('webServer')?.register({
    kind: 'prefix', path: '/my/api',
    handler: (req, res) => { res.writeHead(200); res.end('{}') },
  }), 'my-plugin: routes')                      // 第二参是诊断标签
}
```

`ctx.effect(execute, label)`：立即执行 `execute`，收集其返回的 disposer，fiber 销毁时**逆序**执行（cordis `4.0.4` 源码确认）。所有注册动作（路由、监听、样式、定时器）都应放进 `ctx.effect`。

**读配置只有一条正确路径：`apply(ctx, config)` 的第二个参数。** `ctx.config` 在 handler、事件回调、定时器里读会直接抛 `cannot get property "config" without inject`（cordis 代理要求当前 fiber 上下文）。请求期需要配置时，在 `apply` 里把 `config.<volatileKey>` 这个**引用**缓存下来——它的值本身是 live 的（`ref.get()`）。

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

细节见 `references/host-half.md` 与 `references/client-half.md`——**动手前先过一遍这两篇**。本 skill 的实测记录里，最费时间的两个错误（`apply(ctx, config)` 用错、路由返回裸 400）都写在那里面，撞上再回头查很亏。

## 2.5 配置 UI 放哪儿（先决定，再写）

客户端半有四个可能的位置，选错一次要返工。**默认问一句"用户希望它出现在设置里还是插件页里"**——插件自带配置的习惯位置是插件页，不是设置分区。

| 槽位 | 出现在 | 注册选项 | 适合 |
|---|---|---|---|
| `settings.section` | 设置左侧导航里的一个分区 | `id` + `order` + `label` + `locale` | 功能多、需要独立整页 |
| `plugins.item` | 设置 → 插件 → 内置插件列表的一张卡 | `id` + `label` + `locale` | 官方内置插件的配置 |
| `plugins.bundle.config` | 设置 → 插件 → **这个 bundle 自己的页面**（描述与行列表之间） | `key` = **包名** + `locale` | bundle 自带配置，最像"插件自己的设置页" |
| `plugins.row.config` | 该 bundle 的某一行 → Configure | `key` = `'<包名>#<行 id>'` | 一行一个配置面板 |

- `plugins.*` 由 `dsh-client-ui-plugin-manager` 声明；`plugins.bundle.config` / `plugins.row.config` 是 **keyed 槽位**（用 `key`，不是 `id`）。`settings.section` 是 list 槽位（用 `id` + `order`）。
- 组件收到 `{ t, view }`：`view === 'page'` 是完整表单，`'summary'` 是标题下的一行摘要（`plugins.item` 默认渲染 summary；`plugins.row.config` 只在包描述缺失时才用 summary）。
- **页面画标题/图标/面包屑，条目只画内容**；只有 save 会写，离开页面时暂存编辑被丢弃。所以"改一下立刻写"的面板放这里也成立，但要自己给保存/重置按钮，别指望页面帮你暂存。
- `settings.section` 的组件收到 `{ t, close }`，**标题也要自己画**（外壳只用 `label` 做导航）。
- 同一条配置可以同时挂两处（插件页放摘要、设置分区放完整管理），互不冲突。

参照实现：`dsh-chime` 的 `lib/client.js` 用 `plugins.bundle.config` + `key: PACKAGE_NAME`，`renderSeat(props)` 里按 `props.view === 'summary'` 分摘要/面板。
## 3. 装入 profile（手工路线）

**每一步都在写 `~/.dsh`：动手前需取得用户明确同意**——这会改变当前 profile 的插件组成，所有使用该 profile 的会话都受影响；但 HMR 默认启用，装完即时重组，**一般不需要重启**（例外见本节末尾）。共三处 + 一次安装：

1. profile 的 `package.json`（即 `$DSH_PROFILE_DIR/package.json`）
   - `dependencies` 加 `"<pkg-name>": "link:<插件仓库绝对路径>"`（开发期）或版本号（已发布 npm）
   - `dsh.profile.bundles` 数组加 `"<pkg-name>"`（**建议等步骤 2 装完包再写这一行**：写早了会先重组出一次 `failed`，再靠下一次重组重试）
   - 包自带 `dsh.bundle.patch`（§2 的骨架就是）时，**这一行就够了**：loader 会把包内 `cordis.patch.yml` 当成一层 patch 应用，步骤 3 不要重复 insert 同一个 id。
2. 在 profile 目录执行 `pnpm install`（建立 link；这是手工路线中唯一必须跑 pnpm 的地方）
   - **它可能被与你无关的依赖卡死**：实测 `dsh-ops` 的 `@dsh-ops/bash-win32-x64@0.2.1` 在镜像上不存在 → 整个 install 失败，**你的 link 也不会被创建**。降级做法是建立等价链接（与 pnpm 生成的同形）：
   ```powershell
   New-Item -ItemType Junction -Path "$env:DSH_PROFILE_DIR\node_modules\@local\my-plugin" -Target $repo
   ```
   - 代价：`pnpm-lock.yaml` 里没有这条 link 记录。以后 install 成功时会按 `package.json` 重建；一直失败则现有 junction 继续可用。
3. **只有当包没有自带 patch、或需要覆盖某行的 `config` 时**，才动 profile 的 `cordis.patch.yml`（注意 **patch 整体替换 `config`，不是深合并**）。新增插件写 insert：
   ```yaml
   - insert:
       - id: my-plugin
         name: '@local/my-plugin'
         config: {}
   ```
4. **触发热重组**：patch 文件或 bundles 列表的写入会被 HMR 的 profile 监视捕获，宿主半当场 import 并 apply，浏览器侧由 `/plugins/events` 同步。顺序上先 `pnpm install` 再写 bundles/patch；若包还没装好就重组的，会记为 `failed` 并在下一次重组时重试——修改 patch 内容（哪怕只是注释）或再写一次 bundles 列表即可触发。**注意它比对的是内容**（`refresh()` 里 `if (inputs === lastInputs) return`）：只改 mtime / `touch` 文件**不会**触发，必须真的改内容。
5. 验证：设置 → 插件页的条目与状态（安装类操作看 `application`：`applied` 才是生效，`restart-required` 才算例外）；涉及 UI 时按页面实际表现确认，必要时让用户刷新。
   - **没有日志可看时，让插件自己证明**：塞一条只读健康路由（`ctx.get('webServer').register({ kind: 'prefix', path: '/<plugin>/health' })`），返回 `{ loaded: true, configKind, presets… }`。`curl 127.0.0.1:<port>/<plugin>/health` 拿到 200 就是"宿主半真的加载了、配置引用可读"的硬证据。注意 host 半的插件路由默认只对 loopback 开放，未认证也可以打。

回滚：从 `dsh.profile.bundles` 移除 + 删 patch 条目 → `pnpm remove <pkg>`。被丢弃映射下的模块会被驱逐，同样即时生效。

**只有这些情况才需要重启**（Plugin Manager 的 `application: 'restart-required'` 对应同一份清单）：
- profile 是仅启动型（headless / sdk / acp 的 bundle 里 `- id: hmr, disabled: true`）→ `no-hmr`；
- 已安装包换了目录或 link 目标、或要替换 DSH 安装自带的同名包（`package-moved`，必须先卸载再装）；
- 改动落在 DSH 自己进程加载的模块（`host-module`）、或 Loader 树外的插件（`unmanaged-plugin`）；
- 拿不到 ESM 缓存（packed worker loader）或模块比较失败（`module-comparison`）；
- 手工只跑了 `pnpm add` 而没改 `dsh.profile.bundles`：纯依赖变更不触发重组，要等下一次重组或重启。

完整命令、creator-mode 路线对照、HMR 与重启边界、发版见 `references/install-and-devloop.md`。

## 4. 验证（不得以「应该能用」结案）

1. **离线单测**（插件自带 `test/`，用桩模块图直接跑构建产物）：
   ```powershell
   cd <plugin-repo>
   node --test --test-isolation=none     # 进程内执行，避免沙箱下的 spawn EPERM
   ```
   **沙箱环境下必须加 `--test-isolation=none`**：默认每个测试文件 spawn 子进程并走管道，会触发 `EPERM spawn`（实测）。
2. **宿主接口**：宿主挂载后（新装/改代码由 HMR 重组完成，或按 §3 末尾清单重启后）直接请求 loopback 路由验证响应与状态码。
3. **UI**：没有浏览器控制工具时，请用户刷新页面并提供截图或控制台报错；**在未实际观察前不得声称界面正常**。槽位条目崩溃会在控制台输出 `slot entry crashed in '<slot>'`。
4. 改了宿主半后**没观测到重组结果**就宣称「已生效」属于虚假报告——最省事的三条证据：插件页该行状态、宿主日志里的 `restart required: <reason>` / `changed modules keep running their previous code` 警告、以及路由/工具的真实响应。**Desktop 安装下宿主日志不落盘**（`~/.dsh`、`AppData` 都没有 log 文件）——那就靠插件自带健康路由回 200（见 §3 步骤 5），别拿"看不到警告"当通过。

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
| 客户端半：模块格式、slots 注册、**配置 UI 放哪儿（设置分区 / 插件页四槽位）**、locale、CSS、热更、版本容错 | `references/client-half.md` |
| 真实槽位清单（实测 86 个，含声明包）与发现方法 | `references/slots.md` |
| volatile 配置通道：宿主 schema + 客户端 configForms 读写与报错 | `references/config-channel.md` |
| 两条安装路线、依赖解析不对称、HMR 与何时需要重启、发版、回滚 | `references/install-and-devloop.md` |
| 离线测试 harness 的写法、断言范围、沙箱下的跑法 | `references/testing.md` |
| 坑清单（24 条，全部来自实测或真实故障） | `references/pitfalls.md` |
| 版本怎么读、插件声明的宿主版本如何被检查/豁免、升级前后怎么对齐 | `references/version-compat.md` |
| 生成最小插件骨架 | `scripts/scaffold-plugin.mjs` |
| 采集/对比 API 表面（版本、槽位、服务） | `scripts/api-snapshot.mjs` |
