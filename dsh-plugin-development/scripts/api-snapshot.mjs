#!/usr/bin/env node
/**
 * api-snapshot.mjs — 采集当前 DSH 安装的插件 API 表面，用于升级前后对比。
 *
 * 采集内容：发行版本、每个 @deepseek-ai 包的版本、客户端槽位契约（直接解析安装内的
 * slot-catalog.ts）、宿主 cordis 服务名（扫描 lib/index.js 里的 `super(ctx, "<name>")`）、
 * 随安装发布的 upgrade-guide 版本目录。
 *
 * 定位安装：$DSH_INSTALL_DIR（父目录即 node_modules/@deepseek-ai）→ process.resourcesPath
 * （Electron）→ 从脚本自身路径里含 app.asar 的那段反推。
 *
 * 能读 asar 的运行时才跑得动：run_code 里的 node:fs、宿主文件读取工具，或 shell 里
 * ELECTRON_RUN_AS_NODE=1 $DSH_NODE_EXECUTABLE（沙箱禁管道，输出写文件）。
 *
 * 用法：
 *   node api-snapshot.mjs                    # 输出 JSON 到 stdout
 *   node api-snapshot.mjs --out before.json  # 写入文件
 *   node api-snapshot.mjs --diff before.json # 与旧快照对比
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 定位安装：返回 packagesRoot（node_modules/@deepseek-ai）与 installDir（@deepseek-ai/dsh）。 */
function resolveLayout() {
  const explicit = process.env.DSH_INSTALL_DIR
  if (explicit && fs.existsSync(path.join(explicit, 'package.json'))) {
    return { installDir: explicit, packagesRoot: path.dirname(explicit) }
  }
  if (process.resourcesPath) {
    const dsh = path.join(process.resourcesPath, 'app.asar', 'dsh')
    const pkgs = path.join(dsh, 'node_modules', '@deepseek-ai')
    if (fs.existsSync(pkgs)) return { installDir: path.join(pkgs, 'dsh'), packagesRoot: pkgs }
  }
  for (const seed of [process.argv[1], fileURLToPath(import.meta.url)]) {
    const marker = String(seed ?? '').replace(/\\/g, '/').indexOf('app.asar/')
    if (marker < 0) continue
    const dsh = path.join(seed.slice(0, marker + 'app.asar'.length), 'dsh')
    const pkgs = path.join(dsh, 'node_modules', '@deepseek-ai')
    if (fs.existsSync(pkgs)) return { installDir: path.join(pkgs, 'dsh'), packagesRoot: pkgs }
  }
  throw new Error('找不到 DSH 安装目录：请在能读 asar 的运行时里跑，或设置 DSH_INSTALL_DIR')
}

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const readText = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }

/**
 * 槽位：直接读生成的 slot 目录（0.2.2-rc.2 起随安装发布）。
 * 读不到时回退到旧的 bundle 字符串扫描，保持对老版本的兼容。
 */
function scanSlots(packagesRoot) {
  const catalog = readText(path.join(packagesRoot, 'dsh-cordis-client-runner', 'src', 'client', 'slot-catalog.ts'))
  if (catalog) {
    const slots = {}
    let current = null
    for (const line of catalog.split('\n')) {
      const key = line.match(/^    key: '([^']+)',$/)
      if (key) { current = { }, slots[key[1]] = current; continue }
      if (!current) continue
      const field = line.match(/^    (kind|scope|declaredBy|replaceRisk): '(.*)',$/)
      if (field) current[field[1]] = field[2].replace(/\\'/g, "'")
    }
    return { source: 'slot-catalog', slots }
  }
  const re = /(?:register\(\s*\{\s*name:|inject\(\s*|slots\.register\(\s*\{\s*name:|renderSlot\(\s*|declareSlot\(\s*)[\s\S]{0,40}?["'`]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9-]+){1,4})["'`]/g
  const slots = {}
  let pkgs = []
  try { pkgs = fs.readdirSync(packagesRoot).filter((n) => n.startsWith('dsh-client-')) } catch { return { source: 'scan', slots } }
  for (const pkg of pkgs) {
    const dir = path.join(packagesRoot, pkg)
    const walk = (d, depth) => {
      if (depth > 3) return
      let entries = []
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const p = path.join(d, entry.name)
        if (entry.isDirectory()) { walk(p, depth + 1); continue }
        if (!entry.name.endsWith('.js')) continue
        const text = readText(p)
        if (!text || text.length > 4_000_000) continue
        for (const m of text.matchAll(re)) (slots[m[1]] ??= { declaredBy: pkg })
      }
    }
    walk(dir, 0)
  }
  return { source: 'scan', slots }
}

/** 服务：cordis 服务类构造里 `super(ctx, "name")` 的第一个字符串。 */
function scanServices(packagesRoot) {
  const services = {}
  let pkgs = []
  try { pkgs = fs.readdirSync(packagesRoot) } catch { return services }
  for (const pkg of pkgs) {
    const text = readText(path.join(packagesRoot, pkg, 'lib', 'index.js'))
    if (!text) continue
    for (const m of text.matchAll(/super\(\s*(?:ctx|context)\s*,\s*["'`]([A-Za-z][\w.]*)["'`]/g)) services[m[1]] = pkg
  }
  return services
}

function capture() {
  const { installDir, packagesRoot } = resolveLayout()
  // desktop-runtime.json 在安装根（与 CLI 包目录相隔三层 node_modules/@deepseek-ai/dsh）
  const runtime = [
    path.join(installDir, 'desktop-runtime.json'),
    path.resolve(installDir, '..', '..', '..', 'desktop-runtime.json'),
  ].map(readJson).find(Boolean) ?? null
  const core = readJson(path.join(installDir, 'package.json'))
  const versions = {}
  for (const pkg of fs.readdirSync(packagesRoot)) versions[pkg] = readJson(path.join(packagesRoot, pkg, 'package.json'))?.version ?? 'unknown'
  let guides = []
  try { guides = fs.readdirSync(path.join(installDir, 'docs', 'upgrade-guide')).filter((n) => n.startsWith('v')) } catch { }
  const { source, slots } = scanSlots(packagesRoot)
  return {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    releaseVersion: runtime?.release?.version ?? core?.version ?? 'unknown',
    hostProtocolVersion: runtime?.release?.hostProtocolVersion ?? null,
    installDir,
    platform: process.platform,
    versions,
    slots,
    slotSource: source,
    services: scanServices(packagesRoot),
    upgradeGuideVersions: guides.sort(),
    hasDocs: fs.existsSync(path.join(installDir, 'docs')),
  }
}

function diff(before, after) {
  const lines = []
  if (before.releaseVersion !== after.releaseVersion) lines.push(`发行版本: ${before.releaseVersion} → ${after.releaseVersion}`)
  for (const [pkg, v] of Object.entries(after.versions)) {
    const old = before.versions?.[pkg]
    if (old === undefined) lines.push(`包新增: ${pkg}@${v}`)
    else if (old !== v) lines.push(`包版本变化: ${pkg} ${old} → ${v}`)
  }
  for (const pkg of Object.keys(before.versions ?? {})) if (!(pkg in after.versions)) lines.push(`包移除: ${pkg}`)
  const [bs, as] = [new Set(Object.keys(before.slots ?? {})), new Set(Object.keys(after.slots ?? {}))]
  for (const s of as) if (!bs.has(s)) lines.push(`槽位新增: ${s} ← ${after.slots[s]?.declaredBy ?? '?'}`)
  for (const s of bs) if (!as.has(s)) lines.push(`槽位消失: ${s}`)
  for (const s of as) {
    if (!bs.has(s)) continue
    const [o, n] = [before.slots[s] ?? {}, after.slots[s] ?? {}]
    if (o.kind && n.kind && o.kind !== n.kind) lines.push(`槽位 kind 变化: ${s} ${o.kind} → ${n.kind}`)
    if (o.declaredBy && n.declaredBy && o.declaredBy !== n.declaredBy) lines.push(`槽位声明者变化: ${s} ${o.declaredBy} → ${n.declaredBy}`)
  }
  const svc = (o) => new Set(Object.keys(o ?? {}))
  const [bv, av] = [svc(before.services), svc(after.services)]
  for (const s of av) if (!bv.has(s)) lines.push(`服务新增: ${s} ← ${after.services[s]}`)
  for (const s of bv) if (!av.has(s)) lines.push(`服务消失: ${s}`)
  const bg = new Set(before.upgradeGuideVersions ?? [])
  for (const g of after.upgradeGuideVersions ?? []) if (!bg.has(g)) lines.push(`新增升级指南目录: ${g}`)
  return lines
}

const argv = process.argv.slice(2)
const flag = (key) => { const i = argv.indexOf('--' + key); return i >= 0 ? argv[i + 1] : undefined }

const snap = capture()
const diffPath = flag('diff')
if (diffPath) {
  const before = readJson(diffPath)
  if (!before) { console.error(`读不到旧快照: ${diffPath}`); process.exit(2) }
  const lines = diff(before, snap)
  console.log(lines.length ? lines.join('\n') : `无变化：包版本、槽位、服务与旧快照完全一致（槽位 ${Object.keys(snap.slots).length} 个）`)
} else {
  const outPath = flag('out')
  const json = JSON.stringify(snap, null, 2)
  if (outPath) { fs.writeFileSync(outPath, json + '\n', 'utf8'); console.log(`已写入 ${outPath}（槽位 ${Object.keys(snap.slots).length} 个，来源 ${snap.slotSource}）`) }
  else console.log(json)
}
