# 路径与运行时发现（不写死绝对路径）

插件、脚本与排查步骤都必须适配任意安装位置。本文所有写法与机器、盘符、安装目录无关。

## 1. DSH 注入的环境变量

harness 会在每次 shell 调用中注入：

| 变量 | 含义 | 未设置时 |
|---|---|---|
| `DSH_HOME` | harness 数据根目录 | 按默认 `~/.dsh` 处理 |
| `DSH_PROFILE` | 当前 profile 名 | 表示 harness 未以 profile 启动 |
| `DSH_PROFILE_DIR` | 当前 profile 的目录（其 `node_modules` 只含 profile 安装的 bundle） | 同上 |

- Bash 用 `$DSH_HOME`，PowerShell 用 `$env:DSH_HOME`。
- 写文档/脚本时用 `$DSH_PROFILE_DIR`，**不要展开成某个具体用户的绝对路径**。
- 若要在自己的插件代码里解析 home，别读环境变量硬拼：用官方 `@deepseek-ai/dsh-home-paths`（见 §5）。
- 官方 `dsh --profile "$DSH_PROFILE" --dump-config` 在 Electron 托管的 profile（如 Desktop）下会被拒绝，见 `pitfalls.md` 第 15 条。

## 2. 定位安装自带包（asar 内）

安装自带包随安装位置变化，**不要在代码或文档里写死**。宿主进程（Electron）内：

```js
import path from 'node:path'

const pkgsRoot = path.join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai')
// 任意包的目录：path.join(pkgsRoot, 'dsh-host-webserver')
```

`process.resourcesPath` 由 Electron 提供，在 Windows / macOS / Linux 上都指向 `<安装目录>/resources`，因此结果与安装位置无关。

**降级方案**（纯 Node 环境没有 `process.resourcesPath`）：

1. 从运行中模块的 URL 反推：DSH 自身的模块路径中一定含 `app.asar/dsh/` 这一段，取它之前的部分即安装根。
2. `createRequire(import.meta.url).resolve('@deepseek-ai/<pkg>/package.json')`——仅在能从当前位置解析到该包时有效；profile 里 link 的插件通常解析不到，此时用方案 1。
3. 都拿不到就不要猜：把依赖该路径的能力降级或跳过，别抛错（见 `host-half.md` 的 `ctx.get` 宽容读取）。

> 只做校验用的话，也可以让用户在 UI 里确认（设置 → 插件页会显示已装条目）。

## 3. 读 asar 内的文件

只有**宿主进程自身的 `fs`** 能读 asar 虚拟路径；`rg`/`glob` 与 shell 的 `ls`/`cat`/`cp` 都会 `ENOENT`。因此：

```js
import fs from 'node:fs'
import path from 'node:path'

const readme = fs.readFileSync(path.join(pkgsRoot, 'dsh-host-webserver', 'README.md'), 'utf8')
```

在 agent 会话里，`run_code` 内的程序运行于宿主进程，可直接这样读；换成 shell 命令则必然失败。

## 4. 区分「安装自带」与「profile 安装」

| 来源 | 位置 | 谁能改 |
|---|---|---|
| 安装自带包 | §2 的 `pkgsRoot`（asar，只读） | 升级 harness |
| profile 安装的 bundle | `$DSH_PROFILE_DIR/node_modules/<pkg>` | 用户 / 插件管理器 |

creator mode 下，`cordis_inspect_query` 的 `Config.listConfigs` 查询条目的 `entry` 会直接返回 `packageDir`——这是"包在哪"最权威的答案，能查到就不要自己推。

## 5. 插件代码里不要写死路径

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
