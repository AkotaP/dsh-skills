# 路径与运行时发现（不写死绝对路径）

插件、脚本与排查步骤都必须适配任意安装位置。本文所有写法与机器、盘符、安装目录无关。基线：**DSH `0.2.2-rc.3`**（Desktop / Windows 实测，取值随版本漂）。

## 1. DSH 注入的环境变量

harness 会在每次 shell 调用中注入（`0.2.2-rc.2` 实测值）：

| 变量 | 含义 | Desktop 实测 |
|---|---|---|
| `DSH_HOME` | harness 数据根目录 | `~/.dsh` |
| `DSH_PROFILE` | 当前 profile 名；未设置表示 harness 未以 profile 启动 | `desktop` |
| `DSH_PROFILE_DIR` | 当前 profile 目录（其 `node_modules` 只含 profile 安装的 bundle） | `~/.dsh/profiles/desktop` |
| `DSH_INSTALL_DIR` | **运行中的 CLI 包目录**（`@deepseek-ai/dsh`：含 `package.json`、`docs/`、`node_modules/@deepseek-ai/`）；Desktop 下在 `app.asar` 内 | `...\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh` |
| `DSH_NODE_EXECUTABLE` | 运行 harness 的可执行文件（Desktop 下是 **Electron 程序本身**，不是 CLI node） | `...\DeepSeek Harness.exe` |

- Bash 用 `$DSH_HOME`，PowerShell 用 `$env:DSH_HOME`。
- 写文档/脚本时用这些符号，**不要展开成某个具体用户的绝对路径**。
- `DSH_INSTALL_DIR` 指向 **CLI 包**（`@deepseek-ai/dsh`，含 `docs/`）。它上三级才是**安装根**（包名 `@deepseek-ai/dsh-desktop-runtime`，带 `desktop-runtime.json`）；上一级是 `node_modules/@deepseek-ai`（各官方包的父目录，即本文的 `packagesRoot()`）。三者别混。
- 若要在自己的插件代码里解析 home，别读环境变量硬拼：用官方 `@deepseek-ai/dsh-home-paths`（见 §7）。
- 官方 `dsh --profile "$DSH_PROFILE" --dump-config` 在 Electron 托管的 profile（如 Desktop）下会被拒绝，见 `pitfalls.md` 第 16 条。

## 2. 定位安装自带包（asar 内）

**首选**：`DSH_INSTALL_DIR` 的父目录。

```js
import fs from 'node:fs'
import path from 'node:path'

function packagesRoot() {
  // 宿主进程内 / shell 里都成立：DSH_INSTALL_DIR = <pkgsRoot>/dsh
  const install = process.env.DSH_INSTALL_DIR
  if (install && fs.existsSync(path.join(install, 'package.json'))) return path.dirname(install)
  // 宿主进程内（Electron）：resources/app.asar/dsh/node_modules/@deepseek-ai
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai')
  }
  throw new Error('找不到 DSH 安装的包目录：设置 DSH_INSTALL_DIR')
}
```

**降级方案**（两个都取不到时）：

1. 从运行中模块的 URL 反推：DSH 自身模块路径中一定含 `app.asar/dsh/` 这一段。
2. `createRequire(import.meta.url).resolve('@deepseek-ai/<pkg>/package.json')`——仅在能从当前位置解析到该包时有效；profile 里 link 的插件通常解析不到。
3. 都拿不到就不要猜：把依赖该路径的能力降级或跳过，别抛错（见 `host-half.md` 的 `ctx.get` 宽容读取）。
## 3. 读 asar 里的文件（三条路，按省事程度排）

asar 是 Electron 的虚拟归档，**普通 shell 工具看不见它**：`rg`、`glob`、`Find-ChildItem`、`cat`、`Copy-Item`、PATH 上的 `node` 全部 `ENOENT`。可行的是：

1. **`run_code` 里的 `node:fs`**（本会话即宿主进程）：`fs.readFileSync(path.join(pkgsRoot, 'pkg', 'src', 'index.ts'), 'utf8')`。排查、比对、扫目录首选这条。
2. **宿主文件读取工具**（read / read_image）：可以直接读 `app.asar` 内的文件路径，适合在会话里逐篇读文档/源码。
3. **shell 里借 harness 自己的运行时**：`ELECTRON_RUN_AS_NODE=1` + `$DSH_NODE_EXECUTABLE`。Desktop 下这是 Electron 程序，加上该环境变量后按 Node 运行，**并且能读 asar**。

   ```powershell
   # 沙箱禁止子进程管道（EPERM），所以把结果写进文件再读，别用管道抓 stdout
   $script = 'E:\work\probe.cjs'
   $out    = Join-Path $env:TEMP 'probe.out'
   $env:ELECTRON_RUN_AS_NODE = '1'
   Start-Process -FilePath $env:DSH_NODE_EXECUTABLE -Wait -NoNewWindow -ArgumentList @($script, $out)
   Get-Content $out -Raw
   ```

   脚本里照常用 `require('node:fs')` 读 `process.env.DSH_INSTALL_DIR` 下的路径。**不要**用 `&` 直接调用 Desktop 的 GUI 可执行文件（不保证等待），也不要用管道抓输出（沙箱下 `EPERM`，见 `pitfalls.md` 第 18 条）。

> 只做校验用的话，也可以让用户在 UI 里确认（设置 → 插件页会显示已装条目）。
## 4. 读一个包的顺序（`0.2.2-rc.2` 起：源码随安装发布）

**`README.md`（同目录的 `README.zh.md` 是中文版）→ `src/*.ts` → `lib/index.js` → `docs/`。**

- **`src/` 现在基本都有**：`0.2.2-rc.3` 的 338 个包里 335 个带原始 TS 源码（只有 `dsh-desktop-host`、`libreoffice-kit*` 没有），并在 `exports` 里暴露 `"./src/*"`。`lib/` 只剩压缩后的 `index.js` / `client.js`。
- `src` 是**原始 TS**（类型、JSDoc、模块头注释都在），读契约比啃打包产物省事；import 里写的是 `./foo.ts` 这种带扩展名的形式，找依赖按 `.ts` 找。
- **类型声明不全**：约 1/4 的包带 `lib/types/**/*.d.ts`（client 系较多），其余没有；`package.json` 的 `types` 字段指向的是仓库构建产物，别拿"文件不存在"当包坏了。
- 安装内**没有 sourcemap**（`lib/*.js.map` 没随安装发布）。
- 个别包（cordis 家族）还带 `bin.js` / `locale/`。

## 5. 随安装发布的文档（`0.2.2-rc.2` 起，写插件前先看这里）

`$DSH_INSTALL_DIR/docs/` 现在是一整套官方文档，与当前版本严格一致：

| 想要 | 读 |
|---|---|
| 插件作者教程（最小插件 / 工具 / 配置 / 发布安装） | `docs/user/develop/basic/{index,tool,config,publish}.zh.md` |
| Cordis 框架、服务、事件 | `docs/user/develop/framework/`、`docs/cordis-tutorial/`（7 章）、`docs/cordis-primer.zh.md`、`docs/cordis-api/` |
| 子系统契约（槽位、Web 客户端、client 模块、设置、沙箱、会话…） | `docs/subsystems/`（`slots.zh.md`、`web-client.zh.md`、`client-modules.zh.md`、`settings.zh.md` …） |
| 扩展做法（工具 / 钩子 / UI / 外部协议） | `docs/cookbook/extension-cookbook.zh.md`、`adding-a-package.zh.md`、`adding-a-settings-card.zh.md` |
| 破坏性改动与迁移 | `docs/upgrade-guide/<版本>/<主题>/guide.zh.md`（**随安装发布**，从 `v0.1.7-rc.2` 到当前版本的前一档） |
| 架构、能力接缝、配置目录、工具目录 | `docs/architecture.zh.md`、`docs/capability-seams.zh.md`、`docs/config-catalog.md`、`docs/tool-catalog.md` |
| 用户/运维指南（插件市场、provider、MCP 记忆…） | `docs/user/guide/` |

**官方 skill 也换了**：旧的四件套（`cordis-plugin-development`、`editing-cordis-compositions`、`cordis-composition-reference`、`agent-experience`）在 `0.2.2-rc.2` 合并为一个 `dsh-doc`，内容在 `$DSH_INSTALL_DIR/../dsh-agent-preset/skills/dsh-doc/references/`（`plugin-development.md`、`host-plugin.md`、`ui-plugin.md`、`practices.md`、`verification.md`、`packages.md`、`locate-docs.md`…）与 `templates/`（decoration / mcp 两套模板）。**按旧名字加载 skill 会失败**。
## 6. 区分「安装自带」与「profile 安装」

| 来源 | 位置 | 谁能改 |
|---|---|---|
| 安装自带包 | §2 的 `packagesRoot()`（asar，只读） | 升级 harness |
| profile 安装的 bundle | `$DSH_PROFILE_DIR/node_modules/<pkg>` | 用户 / 插件管理器 |

creator mode 下，`cordis_inspect_query` 的 `Config.listConfigs` 查询条目的 `entry` 会直接返回 `packageDir`——这是"包在哪"最权威的答案，能查到就不要自己推。

## 7. 插件代码里不要写死路径

- **要 home 下的路径**：用 `@deepseek-ai/dsh-home-paths`：
  ```js
  import { resolveDshHome, dshHomePath, dshCachePath } from '@deepseek-ai/dsh-home-paths'
  const home = resolveDshHome()          // 显式配置 > $DSH_HOME > ~/.dsh（空值按未设置）
  const sessions = dshHomePath('sessions')
  const cache = dshCachePath('models')
  ```
- **要可配置的路径**：写进 `Config`，让用户在 `cordis.patch.yml` 覆盖；配置层还可用 Loader 表达式（`!!js dshHomePath('sessions')`）而不要在代码里拼。
- **工作目录**来自会话/工作区上下文，插件不得假设固定盘符或固定工作区。
- 需要向用户展示路径时，优先展示 `~/.dsh`、`$DSH_HOME` 这类符号形式，避免泄露机器绝对路径。
