# 多组件打包与展示名称

核验日期：2026-10-22。以下行为以 DSH **0.2.1-rc.2** 为基线；升级后需重新核对宿主的包解析、客户端发现和元信息读取规则。

## 1. 三个独立问题

添加组件前需分别验证：宿主入口能否解析、浏览器半是否拥有独立生命周期、插件页能否读取展示名称。通过其中一项不代表另外两项成立。

| 入口或做法 | 本次核验结果 |
|---|---|
| 文件路径或文件 URL，附近有独立子包清单 | 可发现子包的客户端，但展示元信息读取会跳过非包名入口，标题可能回退为完整文件 URL |
| 包的子路径，例如 `@scope/plugin/extra` | 展示元信息支持从该子路径的导出资源读取；客户端发现不将其当作独立包根，不能直接替代具名子组件 |
| 可解析的独立包名，例如 `@scope/plugin-extra` | 可分别提供宿主入口、客户端入口和展示资源；推荐用于独立启停的组件 |
| 同一客户端入口中增加一个 React 面板或一个 patch 行 | 不会自动形成独立浏览器生命周期；关闭拥有该入口的行，相关面板与逻辑也会卸载 |

客户端调用 `ctx.locale.register()`、设置槽位的 `locale` 或修改面板标题，不等于提供插件页的展示元信息。页面标题由宿主读取导出的 locale JSON 中的 `meta.title`。

## 2. 推荐结构：具名子包随主包携带

主包将可选组件声明为真实依赖，并通过 `bundledDependencies` 随包分发。组件不必单独发布，也不必另加为 profile 的直接依赖。

```text
plugin/
├── package.json
├── pnpm-workspace.yaml
├── cordis.patch.yml
└── components/extra/
    ├── package.json
    ├── lib/index.js
    ├── lib/client.js
    └── locale/
        ├── en.json
        └── zh.json
```

主包相关字段应合并到现有清单，保留原主组件的入口、client 声明与既有发布文件；不是整份清单的替换模板。其余字段沿用[主文](../SKILL.md#2-最小可跑插件四文件)：

```json
{
  "name": "@scope/plugin",
  "version": "1.0.0",
  "engines": { "dsh": ">=0.2.1-rc.2" },
  "dependencies": {
    "@scope/plugin-extra": "workspace:*"
  },
  "bundledDependencies": ["@scope/plugin-extra"],
  "files": ["lib", "components/extra", "cordis.patch.yml"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

使用 pnpm workspace 时，工作区声明包含子包：

```yaml
packages:
  - components/*
```

子包清单：

```json
{
  "name": "@scope/plugin-extra",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "files": ["lib", "locale", "package.json"],
  "engines": { "dsh": ">=0.2.1-rc.2" },
  "dsh": {
    "client": { "platform": "web", "inject": [], "external": [] }
  }
}
```

子包的客户端 bundle id 必须等于子包名；示例中的空依赖列表只是占位，所需服务、客户端依赖和生命周期释放仍按[客户端半规范](client-half.md)声明。

主包 patch 挂载包名，保持稳定的行 id：

```yaml
- insert:
    - id: extra-feature
      name: '@scope/plugin-extra'
      disabled: true
```

子包的英文展示资源至少提供英文回退，中文资源使用相同字段：

```json
{
  "meta": {
    "title": "Optional feature",
    "description": "An independently configurable optional component."
  }
}
```

独立配置 UI 注册在 `plugins.row.config`，key 是 **组合包名与行 id**，例如 `@scope/plugin#extra-feature`；不是自动改成子包名。默认关闭的组件，其客户端面板可能要开启该行后才会出现。

### 依赖必须实际存在

在本次核验版本中，宿主沿已选 bundle 的普通依赖和 peer 依赖遍历可解析包，将其中的子包纳入 profile 解析映射。因此：

- 仅把子包放进 `components/` 不够；主包自身必须能从 `node_modules` 解析该子包。
- 仅填写 `bundledDependencies` 不够；还需普通依赖声明、实际安装的目录或链接，以及归档中的子包内容。
- 不要用仅有的 `optionalDependencies` 声明代替本方案；本次核验的宿主依赖遍历不读取该字段。
- `workspace:*` 需要先建立工作区依赖链接。构建所有组件后再执行 `pnpm pack`，并检查发布清单中的工作区版本已转换为可发布版本。
- 其他包管理器、本地 `file:` 依赖或链接方案应单独验证；不能从开发目录能加载推断发布包能加载。

## 3. 验收清单

1. **开发目录解析**：从主包作用域验证子包的根入口、`/client`、`/package.json` 和 `/locale/en.json`、`/locale/zh.json` 均可解析。
2. **宿主名称解析**：确认宿主能读到中英文标题与描述，而不只是 JSON 文件存在。只测客户端字典注册不覆盖此项。
3. **实际归档**：检查 `pnpm pack` 产物实际包含 `node_modules/@scope/plugin-extra/` 下的清单、两半产物及展示资源；仅包含 `components/extra/` 不等价。
4. **干净环境**：在无仓库工作区链接的目录中验证发布包的解析与安装；不得依赖机器上已有的同名包或额外 profile 依赖。
5. **独立开关**：主组件关闭时，可选组件仍能按其依赖运行；关闭可选组件后，其监听、计时器、路由和客户端槽位均释放。不应依赖已关闭主组件持有的音源路由或其他资源。
6. **页面观察**：在实际使用的 GUI 地址检查组件列表、组件详情标题和中英文切换。没有浏览器观察时，只报告离线验证范围，不宣称页面已正常。

只读归档检查可验证内容和清单，但不能代替干净环境部署或实际 GUI 验证。无法完成某一层验证时应明确记录。

## 4. 从路径入口升级

- 保留行 id、客户端模块 id、配置槽位 key 和持久化存储键，避免仅修名称却丢失已有设置。
- 检查 profile 中是否存在旧 `name: file:///...` 限定的覆盖；入口名改变后，这类覆盖可能不再匹配。只有行 id 的开关覆盖与限定旧名称的覆盖应分别验证。
- 先确保具名子包已可解析，再更新入口并触发宿主重组；不能仅改入口名而留下未安装依赖。
- 依赖清单变化不保证立即重组。按[安装与开发循环](install-and-devloop.md)确认应用状态；必要时由插件页操作触发重组并重新进入配置页，不把重启 DSH 当作默认步骤。
- 修改 profile 或重新安装仍须取得对应授权；没有授权时只改仓库并说明剩余操作。

## 5. 核验依据与升级复查

本次依据当前安装中的 `@deepseek-ai/dsh-app-boot`、`@deepseek-ai/dsh-client-modules` 与插件管理器实现，分别核对了包依赖映射、独立客户端发现和展示资源读取；并验证了具名子包的解析、宿主元信息结果、发布归档内容与原功能回归。

依赖缓存、安装中断、沙箱验证与 Node CLI 识别的注意事项见[相关陷阱](pitfalls.md)。

上述结论不表示所有 DSH 版本采用相同规则，也不表示离线验证已经覆盖实际 GUI。升级后按[版本兼容流程](version-compat.md)重新确认这三条解析链路。
