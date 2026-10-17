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

**三处改 `~/.dsh` + 一次 pnpm + 一次重启。动手前需取得用户明确同意。**

```powershell
$profileDir = $env:DSH_PROFILE_DIR    # 由 harness 注入；通用取值见 references/paths.md
$repo       = "<插件仓库绝对路径>"
```

1. **profile `package.json`**：`dependencies` 加 `"<pkg>": "link:$repo"`（开发期）或版本号（已发 npm）；`dsh.profile.bundles` 数组加 `"<pkg>"`。
2. **装 link**：在 `$profileDir` 跑 `pnpm install`。结果应是 `$profileDir\node_modules\<pkg>` 指向仓库（junction/symlink）。**仓库改了就是运行版改了，不存在第二份副本。**
3. **profile `cordis.patch.yml`** 加条目：
   ```yaml
   - insert:
       - id: my-plugin
         name: '@local/my-plugin'
         config: {}
   ```
   注意 patch 语义：**带 `id` 而无 `insert` 是覆盖**，且 `config` 是**整体替换不是深合并**——覆盖官方行时要把该行需要的字段全部重写。无 `id` 的覆盖会被警告并跳过。
4. **重启 DSH**（宿主半才会加载）。重启会打断正在跑的会话 → **需先经用户确认**。
5. 验证：设置 → 插件页出现条目；宿主路由可直接 curl；涉及 UI 时由用户刷新页面确认。
   若插件页显示**禁用**或 stderr 出现 `disabling profile plugin`，先核对 `engines.dsh`/peer 与当前 DSH 版本（`version-compat.md` §5）；不要用改版本号硬过，优先升级插件或走精确版本豁免。

**回滚**：删 patch 条目 → 从 `dsh.profile.bundles` 移除 → `pnpm remove <pkg>` → 重启。

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
| `lib/index.js`（宿主半） | **必须重启 DSH**（host 模块不参与热更）。想省掉重启可以在 profile 挂 `@deepseek-ai/dsh-hmr`：`- id: hmr / name: "@deepseek-ai/dsh-hmr" / config: { root: ["<插件仓库>/lib"] }` —— 这同样是对 `~/.dsh` 的写入，需先经用户确认。 |
| `cordis.patch.yml` 的 `config` | 改完重启（或让设置页写入）。 |
| 源码检出（`packages/*`） | `pnpm run dev:web` 同时起宿主 + 重建 watcher；`--no-serve` 只挂 watcher 到别处起的宿主。 |

**"改完 host 没重启就说已生效"是最常见的假报告。**

## 发版

1. 改 `package.json` 的 `version`，同步 README 的 changelog（中英各一份，写清**为什么**）。
2. 改过依赖就 `pnpm install`，确认 lock 同步。
3. `files` 白名单要包含实际发布物（`lib`、`cordis.patch.yml`、`README.md`、`docs`、`LICENSE`）——漏了 `cordis.patch.yml` 会让安装方装出一个**没有 patch 的空包**。
4. `npm publish`（`publishConfig.access: public`）。
5. 改过版本后，profile 里如果钉的是版本号而非 link，需要重新 `pnpm install`。

## 安全与护栏

- 改 `~/.dsh`（profile package.json / cordis.patch.yml / node_modules）和**重启 DSH** 都需取得用户明确同意。
- 插件路由默认只对 loopback 开放；不要为了让外部访问而放宽校验。
- 插件代码跑在**宿主进程内**（完整权限），所以安装 bundle 属于高影响操作，要用户明确同意。
