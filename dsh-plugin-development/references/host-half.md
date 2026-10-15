# 宿主半（`lib/index.js`）

跑在 DSH 宿主进程里的普通 Node ESM。**没有构建步骤、没有 JSX、没有浏览器 API。**

## 导出形态（二选一，不要混用）

```js
// 形态 A：函数式（推荐）
export const name = 'my-plugin'
export const inject = ['webServer']
export const Config = z.object({ /* ... */ })
export function apply(ctx) { /* 在这里注册一切 */ }

// 形态 B：默认导出 service class
export default class MyService extends Service { /* ... */ }
```

`apply(ctx, config)` 的 `config` 是 `cordis.patch.yml` 该条目的 `config`（声明了 `Config` 时按 schema 校验并填默认值）。

- `name` 只是包内标识；**Loader 行 id 只由 `cordis.patch.yml` 的 `id` 决定**，客户端 `configForms.get(id)` 用的是**行 id**。
- `inject` 是**必需依赖**：服务缺失会**阻塞插件启动**。
- `ctx.get(name)` 是**宽容读取**：有则用、无则降级。可选能力（例如 `agentLoop`）故意不进 `inject`，缺失时走降级路径，而不是让整个插件不激活。

## 生命周期：一切注册都进 `ctx.effect`

```js
ctx.effect(execute, label)
```

cordis 4.0.4 语义（读 `cordis/lib/index.js` 确认）：**立即执行** `execute`，收集它返回的 disposer；fiber（插件卸载/重载）销毁时**逆序**执行。也接受 generator / async generator。

- 标签（第二参）会出现在 fiber 诊断里，写上 `'<插件>: <用途>'`。
- 路由、事件监听、定时器、文件监听、样式标签——**凡"注册"必包**。裸注册会导致热更/卸载后泄漏。
- 事件监听用 `ctx.on(event, listener)`；两者都返回 disposer。

## 服务：读什么、怎么读

```js
const sessions = ctx.get('sessions')            // 宽容
const web = ctx.get('webServer')                // 路由宿主
const persistence = ctx.get('sessionPersistence')
const workspaces = ctx.get('workspaceRegistry')
const agents = ctx.get('agents')
```

- 宿主半边**没有** `ctx.get('sessions')` 之外的黑魔法；服务的权威清单见官方 `cordis-composition-reference/references/packages.md`（按 group 列出每个可挂载包及是否吃 `config`）。
- 可选服务走 `ctx.inject([...], (ctx) => {...})` 子作用域，避免在缺服务的 profile 里整体不激活。
- **不要**往 session 里塞新 `type` 的事件：读取端只接受带 `ignorable: true` 的未知事件，而 `Session.append()` 没法写这个标记，会话将无法重新打开。要存自己的状态就用 storage 服务或从已有事件派生。

## HTTP 路由（宿主半对外暴露能力的事实标准）

```js
ctx.effect(() => ctx.get('webServer')?.register({
  kind: 'prefix',                 // 'exact' | 'prefix'；同 kind+path 重复注册会 throw
  path: '/archived/api',
  handler: async (req, res) => { /* 自己读写 body/header */ },
}), 'my-plugin: /my/api routes')
```

`register` 返回 disposer；匹配顺序：**exact 全表 → 最长 prefix → fallback**。handler 抛异常会被 webserver 记 warning 并以 400 收尾（不崩进程）。

路由纪律建议照抄下列做法：

- **只允许 loopback**：自己校验请求的 Host / Origin，非 loopback 一律 403（宿主内部有同类围栏，但不在包的导出面里，不要指望能 import）。放宽前先想清楚后果：`--host 0.0.0.0` 时本插件的接口即对外可达。
- **POST only**，其余 405。
- **方法白名单**：未知 method 先判 404，别掉进参数校验的 400。
- 入参 `sessionId` 限长（例如限 200 字符），防超长串参与全量比对。
- 统一响应体：`{ ok: true, value } | { ok: false, error: { code, message } }`，配 `writeJson(res, status, body)` 小工具。
- **不要**把 `req.signal` 透传给持久化读取：node 的 `IncomingMessage` signal 在 body 读完后会立刻 abort，导致每次读都 "This operation was aborted"（实践中的已知陷阱）。
- 运行中会话要能拒绝：`409 session-busy`。

## Config：能被设置页编辑的字段必须 `.volatile()`

```js
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  deleteInSidebar: z.boolean().default(true).volatile(),
})
```

- `.volatile()` 是 **DSH 对 schemastery 的补丁**，只在 `@deepseek-ai/schemastery >= 3.18.3`（当前 3.18.4）里有；**npm 上游裸 `schemastery` 和 3.18.2 都没有**。所以包里要钉 `"@deepseek-ai/schemastery": "^3.18.4"` 到 `dependencies`，并确保它真被装进**插件自己的 `node_modules`**。
- 不标 `.volatile()` → 该字段**连 settings 文档都进不去**，写入直接被拒（`Plugin entry "…" has no volatile fields`）。
- 非开关类状态（比如"上次勾选了啥"）**别塞 Config**：那属于会话/浏览器状态，应放浏览器 `localStorage`。详见 `config-channel.md`。

## 依赖解析：宿主半和客户端半边规则完全不同

| 半边 | 解析方式 | 结论 |
|---|---|---|
| 宿主半 | Node 原生 ESM：裸包名**只沿模块自己所在目录往上找** | 要 `import` 的包必须写进 `dependencies` 并装进**插件自己的 node_modules**；`@deepseek-ai/*` **不会**从 app.asar 里"顺便"解析到 |
| 客户端半 | DSH 自己的浏览器模块表（`__ModuleLoader__`） | 只要包名写进 `package.json` 的 `dsh.client.inject`，**不需要安装** |

生态惯例：`dependencies` 只放宿主真 `import` 的包；`peerDependencies` 留 `@deepseek-ai/cordis`，其余 DSH 包进 `peerDependencies` + `peerDependenciesMeta.optional`（只为类型/文档）；`engines.dsh` 写成 `">=0.1.7-rc.2"` 这种生态同款。

**最常见的整体故障**：宿主半 import 了一个没装进自己 node_modules 的 `@deepseek-ai/*` → `ERR_MODULE_NOT_FOUND` → **整个插件不加载**（UI 什么都不出现，且没有明显报错）。
