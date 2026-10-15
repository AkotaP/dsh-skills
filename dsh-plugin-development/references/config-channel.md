# volatile 配置通道（宿主 schema ↔ 设置页）

目标：插件有开关，用户在 UI 里改，改完立即生效且**持久化**。DSH 的官方通道是 `Config` 的 `volatile()` 字段 + `dsh-settings` 的表单投影 + 客户端 `configForms` 服务。

## 宿主半边

```js
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  deleteInHeader: z.boolean().default(false).volatile(),
  deleteInSidebar: z.boolean().default(true).volatile(),
})
```

硬性事实（都踩过）：

1. `.volatile()` 来自 **DSH 补丁版 `@deepseek-ai/schemastery` ≥ 3.18.3**；上游裸包没有。必须 `"dependencies": { "@deepseek-ai/schemastery": "^3.18.4" }` 且装进插件自己的 `node_modules`（宿主半按 Node 规则解析，见 `host-half.md`）。
2. **不标 `.volatile()` = 静默失效**：`dsh-settings` 的 `volatileForm()`/`isVolatilePath()` 只投影 volatile 字段，条目进不了 settings 文档，写入被拒（错误文案 `Plugin entry "…" has no volatile fields`）。
3. 只有**开关/配置**进 Config。像"上次勾选了哪些选项"这种记忆值**不要**放进来（会污染配置文档）——应放浏览器 `localStorage`（键名带插件命名空间，例如 `my-plugin/delete-options`），无存储环境时只在本次运行内有效。
4. 写入落到 **profile 的 Cordis patch 层**（`~/.dsh/profiles/<profile>/cordis.patch.yml` 对应 id 的 `config`），所以升级插件不会被覆盖掉用户设置。

## 客户端半边

```js
// 1) factory 的 inject 里必须声明 configForms（兄弟插件 dsh-client-ui-settings 提供）
const inject = ['slots', 'locale', 'configForms']

// 2) 取表单：参数是 cordis.patch.yml 的【行 id】，不是包名以外的东西
const forms = ctx.get('configForms')          // 没声明/服务缺失 → undefined
const form = forms?.get('my-plugin')

// 3) 读：快照 + 订阅
form.getSnapshot()   // { status, value, revision, writable, mode }
ctx.effect(() => form.subscribe(sync), 'my-plugin: toggles')

// 4) 写：一次操作一次 set，等结果
const accepted = await form.set('deleteInSidebar', true)   // resolve(true/false)
```

- **服务没声明就是 `undefined`**：`inject` 漏写 `configForms` → `ctx.get` 返回 undefined，开关"看着有、实际不生效"。应做包装 + try/catch 兜底。
- **缺服务也不能崩**：在没有 settings 服务的部署里仍要能加载，只是用默认值并提示不可用。
- **写失败必须让用户看见**：在设置页底部显示状态行——成功闪绿字（约 2.5s 自动收起），失败红字带宿主原文。否则用户会遇到"改了、重启又复原"且毫无线索。
- 乐观更新要能被订阅纠正（先改内存再写宿主，最终以 `form.getSnapshot()` 为准）。

## 离线可测

离线测试可把 `dsh-settings` 的 `volatileForm`/`isVolatilePath`/`projectForm` 实现**抄进 harness**，然后断言：

- 宿主 `Config` 的每个字段都 `volatile`；
- 投影文档能写入、能读回；
- 客户端"挂载即读文档、一次勾选 = 一次 `form.set`、成功闪绿字、被拒绝/抛错/命名空间缺失都出红字"；
- 缺服务仍能加载并用默认值；
- `package.json` 里依赖与 `dsh.client.inject` 的声明没被改坏。

细节见 `testing.md`。
