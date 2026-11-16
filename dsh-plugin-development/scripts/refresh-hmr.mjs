#!/usr/bin/env node
/**
 * refresh-hmr.mjs — 制造一次 profile 输入变化，让 dsh-hmr 重组并重载改过的宿主半代码。
 *
 * 原理：dsh-hmr 只在「profile patch 内容 / profile package.json 的 bundles 列表」变化时重组；
 * 重组会把已加载模块与磁盘比对（inode:size:mtime），驱逐变过的模块并按新内容重新 import。
 * 默认配置（dsh-base 的 hmr 行 root: []）不监听插件源码，所以改完宿主半必须主动捅一下。
 *
 * 做法：在 profile 的 cordis.patch.yml 里维护一行固定格式注释，只改时间戳：
 *   # dsh-hmr-refresh: 2026-11-16T23:20:01.234+08:00
 * 文件内容变了 → 触发重组；注释不改变 patch 语义，也不影响用户自己写的条目。
 *
 * 写入位置（按优先级）：--file <path> > --profile-dir <dir>/cordis.patch.yml >
 *   $DSH_PROFILE_DIR/cordis.patch.yml > $DSH_HOME/profiles/$DSH_PROFILE/cordis.patch.yml
 *
 * 这是对 ~/.dsh 的写入：DSH 文件沙箱可能直接拒绝。**被拒后应当带一次提权重试**
 * （danger-full-access，审批里说明只写这一行标记），而不是把这件事丢给用户；
 * 提权也被拒绝、或会话没有可用的审批通道时，才请用户代跑。
 * 脚本只改那一行注释，不会重排 YAML、不会动其他条目。
 *
 * 用法：
 *   node refresh-hmr.mjs                 # 改写时间戳，触发一次重组
 *   node refresh-hmr.mjs --dry-run       # 只显示将要写入的那一行
 *   node refresh-hmr.mjs --print         # 打印当前标记行
 *   node refresh-hmr.mjs --file <patch>  # 指定 patch 文件
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const MARKER_PREFIX = '# dsh-hmr-refresh:'
const MARKER_RE = /^#\s*dsh-hmr-refresh:[^\r\n]*/m
const MINIMAL = '[]\n'

const argv = process.argv.slice(2)
const flag = (key) => {
  const i = argv.indexOf('--' + key)
  return i >= 0 ? argv[i + 1] : undefined
}
const dryRun = argv.includes('--dry-run')
const printOnly = argv.includes('--print')

/** 本地时间 + 偏移的 ISO 串，毫秒精度保证每次都变。 */
function stamp(date = new Date()) {
  const pad = (n, width = 2) => String(n).padStart(width, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  ].join('')
}

function patchPath() {
  const file = flag('file')
  if (file) return resolve(file)
  const profileDir = flag('profile-dir')
  if (profileDir) return join(resolve(profileDir), 'cordis.patch.yml')
  const envDir = process.env.DSH_PROFILE_DIR
  if (envDir) return join(envDir, 'cordis.patch.yml')
  const home = process.env.DSH_HOME
  const profile = process.env.DSH_PROFILE
  if (home && profile) return join(home, 'profiles', profile, 'cordis.patch.yml')
  throw new Error('定位不到 profile：传 --profile-dir / --file，或让 $DSH_PROFILE_DIR 存在')
}

function nextMarker(previous) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${MARKER_PREFIX} ${stamp(new Date(Date.now() + attempt))}`
    if (candidate !== previous) return candidate
  }
  return `${MARKER_PREFIX} ${stamp()} # forced`
}

const file = patchPath()
const exists = existsSync(file)
const original = exists ? readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : MINIMAL
const previous = original.match(MARKER_RE)?.[0]

if (printOnly) {
  console.log(previous ?? '(none)')
  process.exit(0)
}

const marker = nextMarker(previous)
const eol = original.includes('\r\n') ? '\r\n' : '\n'
let next
if (previous !== undefined) {
  // 只替换标记本身，行尾的 \r 原样保留
  next = original.replace(MARKER_RE, marker)
} else {
  const trimmed = original.replace(/\s+$/, '')
  const body = trimmed.length === 0 ? '[]' : trimmed
  next = `${body}${eol}${marker}${eol}`
}
if (!next.endsWith('\n')) next += eol

if (dryRun) {
  console.log(`file: ${file}${exists ? '' : ' (will be created)'}`)
  console.log(`marker: ${marker}`)
  process.exit(0)
}

mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, next, 'utf8')
console.log(`✔ 已写入 ${file}`)
console.log(`  ${previous ?? '(new marker)'} -> ${marker}`)
console.log('下一步：等约 100ms（HMR debounce）后验证——插件页该行状态 / 健康路由回 200；')
console.log('        若日志出现 failed 或 restart required，按 SKILL.md §3 末尾清单排查。')
