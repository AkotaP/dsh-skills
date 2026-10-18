# 安装、依赖与开发循环

## 两条安装路线

### A. creator mode（`cordis` preset）——官方路线

当前会话工具表里**有** `plugin_manager` / `cordis_inspect_*` 时用它：

1. 在工作区写好 bundle 目录（`package.json` + `cordis.patch.yml` + 代码）。
2. `plugin_manager` `action: install_bundle`，`target` 给**绝对目录**。它会代为装包、选择 bundle 并写入 profile。
3. 读返回的 `application` / `warnings` 判断是否真的生效，别靠日志猜。`overridden` = 被更高优先级层盖住；`restart-required` = 还没生效；`incompatible-version` = 插件声明的宿主版本与运行时不符（安装被拒，见 `version-compat.md` §5）。
4. 需要构建脚本的包，只有在**用户明确同意**后才传 `approvedBuilds`。

不要手改 profile 的 `package.json`/`cordis.patch.yml`，也不要手跑 pnpm——`install_bundle` 会做，而且手改每一处都要单独审批。

这套工具的来源：`dsh-web-app` 的 `presets/cordis.patch.yml` 里挂了 `@deepseek-ai/dsh-tool-cordis` + `@deepseek-ai/dsh-plugin-manager/tools`；**默认 preset 是 `ptc`，所以默认没有**。要切：改 `agent-preset-registry` 的 `selectedDefault`（或新会话选 `cordis` preset）。

### B. 手工 link 路线——默认 preset（无 creator 工具）下唯一可用

**三处改 `~/.dsh` + 一次 pnpm。动手前需取得用户明确同意**（改的是整个 profile 的插件组成；HMR 默认启用，改完即时重组，通常不用重启）。

```powershell
$profileDir = $env:DSH_PROFILE_DIR    # 由 harness 注入；通用取值见 references/paths.md
$repo       = "<插件仓库绝对路径>"
```

1. **profile `package.json`**：`dependencies` 加 `"<pkg>": "link:$repo"`（开发期）或版本号（已发 npm）；`dsh.profile.bundles` 数组加 `"<pkg>"`。
2. **装 link**：在 `$profileDir` 跑 `pnpm install`。结果应是 `$profileDir\node_modules\<pkg>` 指向仓库（junction/symlink）。**仓库改了就是运行版改了，不存在第二份副本。**
   失败时先看原因：`ERR_PNPM_NO_MATCHING_VERSION` 之类**往往是与你无关的依赖**（实测 `@dsh-ops/bash-win32-x64@0.2.1` 镜像上没有）。这种 install 会整盘失败，**你的 link 也没建出来**——降级为手工建同形链接：
   ```powershell
   New-Item -ItemType Junction -Path "$profileDir\node_modules\@local\my-plugin" -Target $repo
   ```
   代价：lockfile 里没有这条记录，下次 install 成功会按 `package.json` 重建，一直失败则 junction 继续可用。
3. **profile `cordis.patch.yml`** 加条目（**仅当包没有自带 `dsh.bundle.patch`，或要覆盖某行 `config` 时**；包内 patch 已 insert 的话这里再加就是重复 id）：
   ```yaml
   - insert:
       - id: my-plugin
         name: '@local/my-plugin'
         config: {}
   ```
   注意 patch 语义：**带 `id` 而无 `insert` 是覆盖**，且 `config` 是**整体替换不是深合并**——覆盖官方行时要把该行需要的字段全部重写。无 `id` 的覆盖会被警告并跳过。
4. **等热重组**：patch 文件与 profile `package.json` 都在 HMR 的监视列表里（`dsh-hmr` `lib/index.js` 的 `watchConfig(profile.patchPath)`、`watchConfig(join(profile.home, PROFILE_PATCH_FILENAME))`、`watchConfig('<profile>/package.json')`），写入后宿主半当场 import 并 apply。**比对的是内容**（`refresh()` 里 `inputs === lastInputs` 直接 return），`touch`/改 mtime 不触发。**先 `pnpm install` 再写 bundles/patch**；包缺失导致的 import 失败会记为 `failed`，下一次重组时自动重试（改动 patch 内容或再写一次 bundles 列表即可触发）。
5. 验证：设置 → 插件页出现条目；宿主路由可直接 curl；涉及 UI 时按页面实际表现确认，必要时由用户刷新。
   若插件页显示**禁用**或 stderr 出现 `disabling profile plugin`，先核对 `engines.dsh`/peer 与当前 DSH 版本（`version-compat.md` §5）；不要用改版本号硬过，优先升级插件或走精确版本豁免。

**回滚**：从 `dsh.profile.bundles` 移除 → 删 patch 条目 → `pnpm remove <pkg>`。被丢弃映射下的模块会被驱逐，同样即时生效。

## 依赖解析（最容易踩的一节）

| 半边 | 解析方式 | 结论 |
|---|---|---|
| 宿主半 | Node 原生 ESM，裸包名只沿**模块自己所在目录**往上找 | `import` 的包必须进 `dependencies` 且装在**插件自己的 node_modules**；`@deepseek-ai/*` 不会从 app.asar 里解析到 |
| 客户端半 | DSH 浏览器模块表 `__ModuleLoader__` | 包名写进 `dsh.client.inject` 即可，**不需要安装** |

- `dsh-app-boot` 的 `bareModuleBaseUrl` 只特判 **cordis 条目名**从哪加载，**不管条目内部的 import**。
- 链接安装下，仓库里的 `node_modules` 就是宿主解析用的那份；所以 `pnpm install` 要在**插件仓库**里也跑一次。
- **`engines.dsh` / `@deepseek-ai/dsh*` peer 不是纯声明**：DSH `0.2.x` 会真实检查（`0.2.1+` 以 `engines.dsh` 优先，`0.2.0` 只查 peer），不满足时**安装被拒、启动时插件被禁用**。写法、版本差异与豁免见 `version-compat.md` §5。

生态惯例：`dependencies` = 宿主真 import 的（如 `@deepseek-ai/schemastery`）；`peerDependencies` = `@deepseek-ai/cordis`；其余 DSH 包进 `peerDependencies` + `peerDependenciesMeta.optional`；**宿主版本声明用 `engines.dsh`（`0.2.1+` 优先）并在 `peerDependencies["@deepseek-ai/dsh"]` 留同范围作 `0.2.0` 旧宿主回退**。

## 开发循环：改哪半、怎么生效

| 改了 | 生效方式 |
|---|---|
| `lib/client.js`（客户端半） | `dsh-client-hmr` 轮询入口产物（默认 `pollIntervalMs: 500`）发现 mtime/ctime/size 变化 → 重载该插件 bundle，**页面不用手动刷新**。React 状态会丢，数据层（会话/连接）保留。失败**不回滚**，会出现在插件列表里可重试。 |
| `lib/index.js`（宿主半，`0.2.1-alpha.3+`） | 下次**重组**时替换：比较 profile 目录与其 link 目标下已加载模块的 inode/size/mtime，驱逐变了的模块、停掉受影响的 Loader 条目、按磁盘当前内容重新 import。触发方式是任一监视输入**内容**变化——改 profile patch 的内容（不是 touch）、改 bundles 列表、插件页开关/安装。**不需要重启，也不需要额外挂 `dsh-hmr`**。 |
| `lib/index.js`（宿主半，`0.1.6-alpha.2` – `0.2.1-alpha.2`） | 只做**配置层**重组（`reconcileProfilePatches`），不发布新的运行时解析、已加载模块不比较不替换 → 改 `config`、开关已有插件行即时生效；**装新包、改已加载插件的代码**要重启。 |
| `cordis.patch.yml` 的 `config` | 保存即热重组（HMR 默认开）；设置页写入同样即时。 |
| 源码检出（`packages/*`） | `pnpm run dev:web` 同时起宿主 + 重建 watcher；`--no-serve` 只挂 watcher 到别处起的宿主。 |

想让「改文件」本身就能触发宿主半重载（不依赖下一次重组），在 profile patch 里给 base bundle 那行 `hmr` 打开源码监听（写入 `~/.dsh`，需先经用户确认）：

```yaml
- id: hmr
  disabled: false
  config:
    root: ["."]
```

**"改完 host 没观测到重组就说已生效"是最常见的假报告**——看插件页状态、宿主日志的 `restart required: <reason>` 与 `changed modules keep running their previous code` 警告，或直接打路由。

### HMR 版本沿革（`hmr` 行一直在，能力在变）

| 版本 | `hmr` 行 | 重组能力 |
|---|---|---|
| `dsh-base` 0.0.1-rc.1 | `@deepseek-ai/cordis-plugin-hmr`，启用，`root: ['.']` | 模块源码监听（最早的 hot reload） |
| `dsh-base` 0.1.5-rc.1 | 同上，`disabled: true`（注释：module reload is opt-in per profile；配置热重载由 launcher 的 watch-only fallback 承担，不依赖此行） | 需 profile 自选开启 |
| `dsh-base` 0.1.6-alpha.2 – 0.2.1-alpha.2 | `@deepseek-ai/dsh-hmr`，`disabled: !!js "!ctx.get('profileContext')"`，`root: []` | 配置层重组（`reconcileProfilePatches`） |
| `dsh-base` 0.2.1-alpha.3 起（含 rc.1/rc.2） | 同上 | 配置层 + `recomposeProfile()`：发布新运行时解析、替换磁盘上变过的已加载模块 |

### HMR 与重启边界

`dsh-hmr` 的 README 与 Plugin Manager 的 `restartReason` 是同一份清单（`lib/types/tools.js` 的 `RESTART_STEPS`）：

| 场景 | 结果 |
|---|---|
| 装插件、开关插件行、改 `config`、改已加载插件的宿主半代码 | 热重组，`application: 'applied'` |
| 仅启动型 profile（headless / sdk / acp 的 `- id: hmr, disabled: true`） | `no-hmr`，必须重启 |
| 已安装包换目录/link 目标，或替换 DSH 安装自带的同名包 | `package-moved`，先卸载再装 |
| 改动落在 DSH 自身进程加载的模块 | `host-module` |
| 改动落在 Loader 树外的插件（preset 行、`ctx.loader.create()`） | `unmanaged-plugin` |
| 拿不到 ESM 缓存（packed worker loader）或模块比较失败 | `module-comparison` |
| 手工 `pnpm add` 但没改 `dsh.profile.bundles` | 不触发重组（纯依赖变更），等下一次重组或重启 |

替换失败**不回滚**：旧代码不再运行，条目记为 `failed`，下一次重组会再 import 一次，修好文件/依赖后自动起来。

## 发版

1. 改 `package.json` 的 `version`，同步 README 的 changelog（中英各一份，写清**为什么**）。
2. 改过依赖就 `pnpm install`，确认 lock 同步。
3. `files` 白名单要包含实际发布物（`lib`、`cordis.patch.yml`、`README.md`、`docs`、`LICENSE`）——漏了 `cordis.patch.yml` 会让安装方装出一个**没有 patch 的空包**。
4. `npm publish`（`publishConfig.access: public`）。
5. 改过版本后，profile 里如果钉的是版本号而非 link，需要重新 `pnpm install`。

## 安全与护栏

- 改 `~/.dsh`（profile package.json / cordis.patch.yml / node_modules）需取得用户明确同意；它会影响该 profile 下的所有会话。**重启 DSH** 仍属高影响操作（会打断正在跑的会话），同样需要明确同意——但装插件本身通常不需要重启。
- 插件路由默认只对 loopback 开放；不要为了让外部访问而放宽校验。
- 插件代码跑在**宿主进程内**（完整权限），所以安装 bundle 属于高影响操作，要用户明确同意。
