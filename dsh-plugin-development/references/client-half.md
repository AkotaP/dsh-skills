# 客户端半（`lib/client.js`）

浏览器 bundle，手写产物形如：

```js
window.__ModuleLoader__.load({
  id: '@local/my-plugin',             // 必须等于包名
  factory: (require) => {
    const React = require('react')
    const jsx = require('react/jsx-runtime')
    const module = { exports: {} }

    const inject = ['slots', 'locale', 'sessions', 'workspaces', 'configForms']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register('my-ns', { zh, en }), 'my-plugin: dictionaries')
      const t = ctx.locale.bind('my-ns')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'my-section', order: 200,
        label: () => t('nav'), locale: 'my-ns',
      }, MySection))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
```

- `factory(require)` 里**只能 `require` 模块表里的包**。表分两层：
  - **基线表（恒在，随 Web 外壳静态提供）**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。直接 require，**不用安装、不要写进 `dependencies`**。
  - **其余**：要么在 `package.json` 的 `dsh.client.external` 里列成精确模块请求（含 `<pkg>/client` 子路径），由宿主组合进图；要么别 require。解析不到时浏览器侧直接抛错，整个客户端半不加载。
  **不要**再装一份 React、不要 CDN/UMD。`dsh.client.inject` 只是**包名依赖边**（工厂到达顺序 / 组合），不是服务注入——服务注入写在返回对象的 `inject` 里。
- factory 里不做事（保持无副作用），一切注册放 `apply(ctx)`。
- `inject` 声明是**门禁**：cordis 服务查找只沿父链走 + facade 按 `inject` 过滤，**没声明拿到的就是 `undefined`**——表现为"功能看着有、实际不生效"（`configForms` 是典型）。

## 槽位注册（`ctx.slots`）

```js
ctx.slots.inject(ownerKey, () => ctx.slots.register(options, Component))
```

- `inject` 的回调在**拥有该槽位的声明塌缩/恢复时重跑**，注册随之销毁/重建——所以把注册写在回调里，不要在外面先建组件再塞。
- `register` 选项：`name`（槽位名）、`id`（list 槽位**必填**，同槽位内唯一）、`key`（keyed 槽位必填）、`select`（chain 槽位必填）、`order`（越小越前）、`priority`（比较时先于 `order`）、`locale`（该条目的文案命名空间）、`inject: () => props`（额外业务 props）、`scope`（会话作用域槽位由父级声明，组件自动拿到 session 相关标准 props）、`label`（`settings.section` 用）。槽位分 **single / list / keyed / chain / hoc** 五类（`hoc` 用于包裹宿主内容，组件必须渲染 `children` 至多一次），缺必填项时报错形如 `… requires options.id | key | select`。`priority` 是内部排序位，官方目录明确建议**不要传**（facade 会自动给一个低于所有内置条目的值）。
- 声明即占有：注册进**未声明**的槽位（`slot "…" is not declared`）、声明已声明的子槽位、同 `id`/`key` 重复注册——加载期直接 throw。
- 槽位清单与发现方法见 `slots.md`。

## 右键菜单（`0.2.2-rc.2` 现状）

不要用 Slot 画菜单项了，改用数据贡献（完整契约见 `@deepseek-ai/dsh-client-ui-context-menu/README.zh.md`）：

```js
const inject = ['contextMenus']

function apply(ctx) {
  ctx.effect(() => ctx.contextMenus.register({
    id: 'my-plugin.action',
    target: 'session',                       // 目标类别，扩展 ContextMenuTargetMap
    order: 450,
    resolve: (target, signal) => ({
      id: 'my-plugin.action.run',
      label: t('menuLabel'),
      icon: { key: 'my-plugin.action' },     // 图标是数据，不是 React 节点
      run: async () => { /* ... */ },
    }),
  }), 'my-plugin: context menu')

  // 图标通过 keyed 槽位渲染
  ctx.slots.inject('contextMenu.icon', () => ctx.slots.register(
    { name: 'contextMenu.icon', key: 'my-plugin.action' }, Icon,
  ))
}
```

- 服务名是 `ctx.contextMenus`（旧 `ctx.menus` 已删）；类型 `ContextMenuTarget` / `ContextMenuTargetMap`（旧 `MenuTarget` 已删）。
- 触发元素：`const { getTriggerProps } = useContextMenu()`，把 `getTriggerProps(target, handlers?)` 展开到元素上。
- 内置会话/标签菜单项也是数据贡献；旧 Slot 的 priority 不再能压过内置动作。

## 配置 UI 放哪儿（四条路，先选再写）

插件自带配置**不一定**要放设置页。客户端半有四个可注册的位置，都由官方包声明：

| 槽位 | 出现在 | 类别 | 注册选项 | 适合 |
|---|---|---|---|---|
| `settings.section` | 设置左侧导航的一个分区 | list | `id` + `order` + `label` + `locale` | 功能多、需要一整页 |
| `plugins.item` | 设置 → 插件 → 内置插件列表的一张卡 | list | `id` + `label` + `locale` | 官方内置插件的配置 |
| `plugins.bundle.config` | 设置 → 插件 → **该 bundle 自己的页面**（描述与行列表之间） | keyed | `key` = **包名** + `locale` | bundle 自带配置，观感最像"插件自己的设置页" |
| `plugins.row.config` | 该 bundle 的某一行 → Configure | keyed | `key` = `'<包名>#<行 id>'` + `locale` | 一行一个配置面板 |

```js
// bundle 自带配置（最常用的一条：用户说"放插件页里"通常指这个）
ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
  name: 'plugins.bundle.config',
  key: PACKAGE_NAME,          // 包名，不是行 id
  locale: NS,
}, ({ t, view }) => view === 'summary' ? t('summary') : <MyForm t={t} />))
```

契约要点（来自 `dsh-client-ui-plugin-manager` 的 README 与声明）：

- `view` 只有两种语义：`'page'` 是带自己保存控件的完整表单，`'summary'` 是标题下的一行摘要。`plugins.item` 默认渲染 summary；`plugins.row.config` 只在包描述缺失时才用 summary。
- **页面画标题、图标、面包屑**，条目只画内容。
- **只有 save 会写**，离开页面时暂存编辑被丢弃——所以"改一下立刻写"的面板在这里也成立，但要自己放保存/重置控件，别指望页面帮暂存。
- `settings.section` 的组件收到 `{ t, close }`，**标题同样要自己画**（外壳只用 `label` 做导航项）。
- 同一条配置可以同时挂两处：插件页放摘要/常用项，设置分区放完整管理，互不冲突。

推荐写法：`key` 用包名常量、组件按 `props.view === 'summary'` 分流摘要与设置面板（注册代码见上面的片段）；keyed 槽位的完整契约以 `@deepseek-ai/dsh-client-ui-plugin-manager` 的 README 与槽位声明为准。

## 文案：走 `ctx.locale`，不要硬编码

```js
ctx.effect(() => ctx.locale.register(NS, { zh, en }), '...')   // 注册字典
const t = ctx.locale.bind(NS)                                   // 绑定命名空间
// 槽位注册时挂 locale: NS，框架侧文案也走同一命名空间
```

多语言页面必须两套都补齐，文档也应保持一致。

## 配置通道：`ctx.configForms`

```js
const forms = ctx.get('configForms')                 // inject 里必须声明
const form = forms?.get('my-plugin')                 // 参数 = cordis.patch.yml 的行 id
form.getSnapshot()                                   // { status, value, revision, writable, mode }
ctx.effect(() => form.subscribe(sync), '...')
await form.set(field, value)                         // resolve(true/false)
```

- **写失败一定要让用户看见**（例如：设置页底部成功闪绿字、失败红字带宿主原文）。否则用户会遇到"改了、重启又复原"且毫无反馈。
- 完整契约与断言方式见 `config-channel.md`。

## 样式：每次加载重新注入

```js
const style = document.createElement('style')
style.dataset.pluginCss = 'my-plugin'
document.head.querySelectorAll('style[data-plugin-css="my-plugin"]').forEach((n) => n.remove())
document.head.appendChild(style)
```

- **必须"先删同名旧标签再插"**：不然热更后旧标签还在，新 CSS 永远不生效（改颜色这类改动看着像没做）。
- 与官方规则同权重抢属性时用**双类名提权**（`.aRchv_rowDelete.aRchv_rowDelete:hover`）——官方 `.iconButton:hover` 与本插件规则同为单类权重。
- 只继承宿主主题 token（`--dsw-alias-*`）；字面颜色只用于插画。token 改名最多让外观退化，不会崩渲染。
- HMR 重载时会清掉旧 fiber 拥有的样式（`dsh-client-hmr` 的行为），所以"每次加载重注入"不是可选项。

## 版本容错：核心升级时别整槽崩掉

推荐做法：核心升级会重命名导出（实测过：图标导出从带尺寸后缀改成带字重后缀；`MenuTarget` → `ContextMenuTarget`），因此按"新旧名字都试、都缺就退回空组件"来取：

```js
const primitive = (legacy, current) =>
  primitives[legacy] ?? primitives[current] ?? (() => null)
```

一个抛异常的组件会把**整个槽位条目**打崩（控制台 `slot entry crashed in '<slot>'`），所以宁可降级成不渲染。

**当前版本的两处硬改动**（旧名没有兼容别名，容错包装也救不了）：右键菜单的类型/hook/**服务名/图标形式**见 `version-compat.md` §4.2；`useAnchoredPosition` 与 `Menu.getAnchorRect` 在 `0.2.2-rc.2` **已经移除**（改 CSS 锚点 / `anchorRef` / `anchorPoint`），见 §4.5。

**关于 `@deepseek-ai/dsh-client-ui-primitives`**：它**不是安装内的独立 npm 包**，只是浏览器基线模块表里的一个模块（`dsh-client-ui-slots`、`dsh-client-ui-dockkit` 同理）。因此：require 它不需要安装、也不该写进 `dependencies`；但它**没有 `package.json` / 类型文件可读**，契约只能从模块导出面与官方 README 反推，且跨版本会改名（实测：图标导出换过后缀、`useAnchoredPosition` 在 `0.2.2-rc.2` 被移除）。折中做法：**只读导出**、全部走上面的容错包装、升级时把它当"可能改名/可能消失"的东西；不愿承担耦合就照官方建议，把目标控件的结构/样式抄进自己插件（类名改成自己的前缀）。

## 不要做的事

- 不要替换 app root、不要往 `document.body` 追加第二个应用。
- 不要在组件外写 DOM。
- 不要把弹窗挂在会卸载的容器里（真实故障：确认弹窗若长在「…」菜单里，`setMenuOpen(false)` 与 `setOpen(true)` 同批处理后会一起消失，表现为"点了没反应"——**弹窗放 `shell.overlay`**）。
- 不要读别的插件的 DOM/样式表来估算位置；选一个**本来就分配了空间**的槽位。
