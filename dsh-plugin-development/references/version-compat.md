# 版本与兼容（升级前后怎么快速对齐）

DSH 迭代很快（本 skill 编写时为 `0.1.7-rc.2`，复核时安装已是 `0.2.0-rc.2`）。**任何"实测"结论都会随版本漂移**，所以流程比结论重要。

## 1. 先读出版本（不要凭记忆）

| 想知道 | 从哪读 |
|---|---|
| harness 发行版本 | 安装目录的 `desktop-runtime.json` → `release.version`（另有 `hostProtocolVersion`、`nodeVersion`、`pnpmVersion`） |
| 核心包版本 | 安装目录 `dsh/package.json` 的 `version`，以及 `node_modules/@deepseek-ai/*/package.json` |
| 每个插件的版本 | 插件自己的 `package.json`；profile 里用 `link:` 时即仓库的版本 |

安装目录的定位见 `paths.md` §2（`process.resourcesPath`），**不要写死**。

> 实测：`desktop-runtime.json` 的 `release.version` 与 `@deepseek-ai/dsh` 的 `version` 一致，但各包版本并不统一（cordis `4.0.4`、schemastery `3.18.4`、其余多为发行版本号）。所以"DSH 版本"要区分发行版本与单个包版本。

## 2. 官方没有随包 CHANGELOG

实测：安装内的 `@deepseek-ai/*` 里**没有** DSH 自己的 CHANGELOG 或 docs 目录（只有若干第三方依赖自带 CHANGELOG）。各包 README 引用的 `docs/config-catalog.md`、`.agents/notes/...` 属于**源码检出**，不随安装分发。

因此可用的信息源按优先级：

1. **活体 API 目录（最准，需 creator mode）**：`cordis_inspect_query` 查 `Service`、`Event`、`Tool`、`Slots`、`Theme`、`Config.listConfigs`——它读的是**当前正在运行**的进程，永远与版本一致。
2. **每个包的 README + `lib/index.js`**：README 描述契约，`lib` 是实际实现；两者都在同一个包目录里。
3. **快照对比**：升级前后各采一次 API 表面，用 `scripts/api-snapshot.mjs` 输出变化清单（见 §3）。
4. **上游仓库与发布说明**：包的 `package.json` 有 `repository`（上游为 `deepseek-ai/deepseek-harness`）；需要外部信息时用 web 检索发行说明，但**以安装内的实际契约为准**。

## 3. 升级前后做 API 快照 diff

`scripts/api-snapshot.mjs` 在宿主进程内采集：发行版本 + 每包版本 + 客户端槽位名与声明包 + 宿主 cordis 服务名。

```js
// 升级前：agent 会话里用 run_code 执行（需要宿主进程的 fs 才能读 asar）
//   node api-snapshot.mjs --out before.json
// 升级后：
//   node api-snapshot.mjs --out after.json
//   node api-snapshot.mjs --diff before.json
```

diff 输出四类变化：**版本变化、新增槽位、消失槽位、新增/移除服务**。这三类正好对应插件最容易被打断的三种依赖——注册目标、注入服务、以及"哪个包还在"。

实测样例（`0.1.7-rc.2` → `0.2.0-rc.2`）：槽位 85 → **86**，新增 `sidebar.right.tab.files.actions`，**无移除**；已装的参考插件 30 条离线测试全部通过。这说明小版本升级通常**加多于减**，但仍要跑 diff。

## 4. 兼容写法：让插件"少依赖具体版本"

- **可选能力用 `ctx.get()` 宽容读取**，不要一律塞进 `inject`——`inject` 缺服务会阻塞整个插件启动（见 `host-half.md`）。
- **读不到的导出要能降级**：核心升级会重命名或移除导出（例如图标导出从 `…16/…14` 改成 `…Regular/…Medium`，0.2.0 仍为该命名）。用"新旧名字都试、都缺就退回空组件"的取法，避免一个抛异常的组件打崩整个槽位条目。
- **槽位名当作外部契约**：升级后先跑一次快照 diff，确认自己注册的槽位还在；消失的槽位会让注册在加载期直接 throw。
- **服务名同理**：`ctx.get('sessions')` 这类名字若被改，宽容读取会静默降级——所以关键路径要断言，不能只靠"没报错"。
- **样式只依赖主题 token**：token 改名最多让外观退化，不会让渲染崩掉。
- **不要依赖未公开的 DOM/内部字段**：这类耦合在小版本升级里最容易断。

## 5. 声明与锁定

- `package.json` 的 `engines.dsh`（SemVer 范围）与 `dsh.manifestVersion` 是**纯声明**：当前安装器与加载器**不会**据此拒绝不兼容的宿主，也不会校验语法。写它主要给人和工具看，别当成运行时保险。
- DSH 包按生态惯例放 `peerDependencies`，非必需的用 `peerDependenciesMeta.optional` 标记；宿主半真正 `import` 的第三方库才进 `dependencies`（见 `install-and-devloop.md`）。
- 插件要"锁定"某个 API 时，靠的是**自己的测试**和**快照 diff**，而不是版本号声明。

## 6. 升级后的回归清单

1. `node --test --test-isolation=none`（沙箱环境）——离线契约测试全绿。
2. 跑 `api-snapshot.mjs --diff`——确认注册的槽位、读取的服务都还在。
3. 重启 DSH 后验证宿主路由/接口状态码（`host-half.md` 的错误码约定）。
4. 验证 volatile 配置通道仍能投影与写入（`config-channel.md`）。
5. UI：让用户刷新页面确认；没有浏览器控制工具时**不要**声称界面正常。
6. 把新的实测结论与版本号一起写进插件文档，**不要只写"改了什么"**。
