# 离线测试（不需要装 DSH、不需要浏览器）

插件发布的是**构建产物**（宿主半 `lib/index.js`、客户端半 `lib/client.js`）。既然它们能独立加载，就能在纯 `node --test` 下测。

## harness 的职责（`test/support/harness.mjs`）

一块**桩模块图 + 迷你 React**：

- `globalThis.window = { __ModuleLoader__: { load({ id, factory }) { ... } } }`：捕获客户端 bundle，提供一个 `require`，把 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` 换成自己的桩。
- **迷你 React**：`useState/useEffect/useRef/useMemo/useSyncExternalStore` 的槽位实现 + 一个"渲染一次组件树"的小 renderer，用来断言注册进槽位的组件结构与文案。
- **假 ctx**：`slots`（记录 `inject`/`register` 调用）、`locale`（记录字典、`bind` 返回查表函数）、`configForms`（抄一份 `dsh-settings` 的投影/写入逻辑）、`get()`。
- **定时器策略（关键）**：`setInterval`/`clearInterval` 变 no-op——组件里那个 60s 刷新计时器在测试中永不停，否则 `node --test` **永不退出**；`setTimeout` 保持真实，因为要断言"保存成功的绿字会淡出"。
- `globalThis.fetch` / 路由桩：宿主半的路由测试直接调注册进来的 handler，造 `req/res` 假对象。

## 断言什么（改功能前先补断言）

| 类别 | 断言 |
|---|---|
| 槽位契约 | 槽位名、`id`、`order` 精确值；菜单项结构（危险色 + 分隔线 + 图标，且**弹窗不在菜单树里**） |
| 交互流 | 点选 → 弹窗 → 调 `POST /api/...` → 刷新；失败路径 |
| 宿主 API | 运行中会话 409；非 loopback 403；缺参 400；未知 method 404；**已下线的旧接口保持 404**（防止有人把旧通道偷偷加回来） |
| 配置通道 | 字段都是 `volatile`；投影/写入；客户端一次 `set` 一次；失败出红字；缺服务不崩 |
| 清单 | `package.json` 的 `dsh.client.inject`、依赖钉版本没被改坏；客户端 `configForms.get(id)` 的 id **等于** `cordis.patch.yml` 的行 id |
| 纯逻辑 | 路径绝对化、工具调用统计去重、树形折叠层级、时间格式化…这些不需要渲染就能测，优先写成纯函数 |

**新 slot / 新接口 / 新配置字段 = 先加断言再改实现。** 否则"改完看着没问题"只能靠肉眼。

## 跑法

```powershell
cd <插件仓库>
pnpm install
node --test                        # 正常环境
node --test --test-isolation=none  # 沙箱环境下必须加这个
```

- **沙箱下默认会失败**：`node --test` 每个文件 spawn 子进程并用管道读写，DSH 沙箱禁止命名管道 → `Error: spawn EPERM`（实测，errno -4048）。`--test-isolation=none` 改为进程内执行即通过（实测）。
- **这里跑的是 shell 里的 `node`**，未必等于 harness 内置 runtime 的 Node（后者从 runtime 清单的 `nodeVersion` 读）。`--test-isolation` 需要较新的 Node，若报 unknown option，先对一下 `node --version`。
- Windows 上 `pnpm test` 若只是 `node --test`，在沙箱里同样要加参数——可以直接写进 `scripts.test`。
- 别在测试里起真 HTTP server、真浏览器、真 DSH；harness 的意义就是**离线**。
