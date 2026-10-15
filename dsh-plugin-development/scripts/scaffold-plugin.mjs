#!/usr/bin/env node
/**
 * scaffold-plugin.mjs — 生成一个最小可跑的 DSH 插件 skeleton。
 *
 * 只写目标目录，**绝不碰 ~/.dsh**（安装需用户确认，见 skill 的 install-and-devloop.md）。
 *
 * 用法：
 *   node scaffold-plugin.mjs <target-dir> [--name @local/x] [--row x]
 *                            [--slot conversation.composer.dock] [--label "My Widget"] [--force]
 */
import { mkdirSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const argv = process.argv.slice(2)
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(`用法: node scaffold-plugin.mjs <target-dir> [--name @local/x] [--row x] [--slot <slot>] [--label "文本"] [--force]`)
  process.exit(argv.length === 0 ? 1 : 0)
}

const target = resolve(argv[0])
const flag = (key, fallback) => {
  const i = argv.indexOf('--' + key)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const force = argv.includes('--force')
const base = basename(target)
const pkgName = flag('name', '@local/' + base)
const rowId = flag('row', base)
const slot = flag('slot', 'conversation.composer.dock')
const label = flag('label', base)

const problems = []
if (!/^[a-z0-9][a-z0-9-]*$/.test(rowId)) problems.push(`--row "${rowId}" 必须是 lower-kebab-case（cordis 行 id）`)
if (!/^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9-]*$/.test(pkgName)) problems.push(`--name "${pkgName}" 不像合法包名`)
if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/.test(slot)) problems.push(`--slot "${slot}" 不像槽位名`)
if (problems.length) { console.error(problems.map((p) => '✖ ' + p).join('\n')); process.exit(2) }

if (existsSync(target)) {
  if (!statSync(target).isDirectory()) { console.error('✖ 目标已存在且不是目录: ' + target); process.exit(2) }
  const entries = readdirSync(target).filter((n) => n !== '.git')
  if (entries.length && !force) {
    console.error('✖ 目录非空（' + entries.slice(0, 5).join(', ') + '）；确认要覆盖就加 --force')
    process.exit(2)
  }
}
mkdirSync(target, { recursive: true })

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const files = {
  'package.json': JSON.stringify({
    name: pkgName,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: label + ' — DSH plugin',
    exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
    engines: { node: '>=20', dsh: '>=0.1.7-rc.2' },
    scripts: { test: 'node --test --test-isolation=none' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-conversation'] },
    },
    peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
  }, null, 2) + '\n',

  'cordis.patch.yml':
    '# 行 id 必须与客户端 configForms.get(id) / 本文件保持一致。\n' +
    '- insert:\n' +
    '    - id: ' + rowId + '\n' +
    "      name: '" + pkgName + "'\n" +
    '      config: {}\n',

  'index.js': `/**
 * 宿主半：跑在 DSH 宿主进程里的普通 Node ESM。
 * 一切注册都放进 ctx.effect，返回的 disposer 由 cordis 在卸载/热更时逆序执行。
 */
export const name = '${esc(rowId)}'
export const inject = ['webServer']

// 只有需要「设置页可编辑」的字段时才导出 Config，而且必须是 schemastery schema：
//   import z from '@deepseek-ai/schemastery'
//   export const Config = z.object({ enabled: z.boolean().default(true).volatile() })
// 并把 @deepseek-ai/schemastery 钉进 dependencies、装进插件自己的 node_modules。
// 不要写 export const Config = {}：不是 schema 会让加载期校验抛错，插件直接不激活。

export function apply(ctx) {
  ctx.effect(() => ctx.get('webServer')?.register({
    kind: 'prefix',
    path: '/${esc(rowId)}/api',
    handler: (req, res) => {
      // 只允许 loopback：放宽前先想清楚后果。
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, value: { row: '${esc(rowId)}' } }))
    },
  }), '${esc(rowId)}: routes')
}
`,

  'client.js': `/**
 * 客户端半：浏览器 bundle。id 必须等于包名；factory 里的 require 只能取模块表里的包。
 */
window.__ModuleLoader__.load({
  id: '${esc(pkgName)}',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const module = { exports: {} }

    const inject = ['slots', 'locale']

    function Widget() {
      return h('div', {
        style: { fontSize: 12, padding: '4px 8px', color: 'var(--dsw-alias-label-secondary)' },
      }, '${esc(label)}')
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register('${esc(rowId)}', {
        zh: { widget: '${esc(label)}' },
        en: { widget: '${esc(label)}' },
      }), '${esc(rowId)}: dictionaries')

      ctx.slots.inject('${esc(slot)}', () => ctx.slots.register({
        name: '${esc(slot)}',
        id: '${esc(rowId)}',
        order: 500,
        locale: '${esc(rowId)}',
      }, Widget))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
`,

  'README.md': `# ${label}

DSH 插件（${pkgName}）。

- 宿主半 \`index.js\`：\`/${rowId}/api\` 路由。
- 客户端半 \`client.js\`：注册进 \`${slot}\`。
- 清单：\`package.json\` 的 \`dsh.bundle.patch\` + \`dsh.client.inject\`。

安装/开发循环见 \`dsh-plugin-development\` skill 的 \`references/install-and-devloop.md\`。
`,
}

for (const [rel, content] of Object.entries(files)) writeFileSync(join(target, rel), content, 'utf8')

console.log('✔ 已生成 ' + target)
for (const rel of Object.keys(files)) console.log('  · ' + rel)
console.log(`
下一步（安装会改 ~/.dsh 并需要重启 DSH —— 需先取得用户同意）：
  1. 在插件目录跑 pnpm install（宿主半的依赖要装进这里）
  2. node scaffold-plugin.mjs 生成的骨架可先做语法检查： node --check index.js && node --check client.js
  3. profile 安装见 skill references/install-and-devloop.md §B
验证：node --test --test-isolation=none（沙箱下必须带这个参数）
`)
