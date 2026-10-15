#!/usr/bin/env node
/**
 * api-snapshot.mjs — 采集当前 DSH 安装的插件 API 表面，用于升级前后对比。
 *
 * 采集内容：发行版本、每个 @deepseek-ai 包的版本、客户端槽位名（含声明包）、
 * 宿主 cordis 服务名（扫描 `super(ctx, "<name>")`）。
 *
 * 必须在**宿主进程**内运行：只有宿主进程的 fs 能读 asar 虚拟路径。
 * 在 agent 会话里用 run_code 执行；普通 shell 的 node 会 ENOENT。
 *
 * 用法：
 *   node api-snapshot.mjs                    # 输出 JSON 到 stdout
 *   node api-snapshot.mjs --out before.json  # 写入文件
 *   node api-snapshot.mjs --diff before.json # 与旧快照对比
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 定位安装根：Electron 的 process.resourcesPath 优先，其次从运行路径反推。 */
function resolveInstallDshDir() {
  const explicit = process.env.DSH_INSTALL_DSH_DIR
  if (explicit) {
    for (const c of [explicit, path.join(explicit, 'dsh')]) {
      if (fs.existsSync(path.join(c, 'node_modules', '@deepseek-ai'))) return c
    }
    throw new Error(`DSH_INSTALL_DSH_DIR 下找不到 node_modules/@deepseek-ai: ${explicit}`)
  }
  if (process.resourcesPath) {
    const candidates = [
      path.join(process.resourcesPath, 'app.asar', 'dsh'),
      path.join(process.resourcesPath, 'app', 'dsh'),
    ]
    for (const c of candidates) if (fs.existsSync(c)) return c
  }
  const seeds = [process.argv[1], fileURLToPath(import.meta.url)]
  for (const seed of seeds) {
    if (!seed) continue
    const marker = seed.replace(/\\/g, '/').indexOf('app.asar/')
    if (marker >= 0) {
      const root = seed.slice(0, marker + 'app.asar'.length)
      const dsh = path.join(root, 'dsh')
      if (fs.existsSync(dsh)) return dsh
    }
  }
  throw new Error('找不到 DSH 安装目录：请在宿主进程内运行，或设置 DSH_INSTALL_DSH_DIR')
}

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const readText = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }

/** 槽位扫描：客户端包里注册/注入/渲染调用点上的槽位名。 */
function scanSlots(pkgsRoot) {
  const re = /(?:register\(\s*\{\s*name:|inject\(\s*|slots\.register\(\s*\{\s*name:|renderSlot\(\s*|declareSlot\(\s*)[\s\S]{0,40}?["'`]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9-]+){1,4})["'`]/g
  const slots = {}
  let pkgs = []
  try { pkgs = fs.readdirSync(pkgsRoot).filter((n) => n.startsWith('dsh-client-')) } catch { return slots }
  for (const pkg of pkgs) {
    const walk = (dir, depth) => {
      if (depth > 3) return
      let entries = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(p, depth + 1); continue }
        if (!entry.name.endsWith('.js')) continue
        const text = readText(p)
        if (!text || text.length > 4_000_000) continue
        for (const m of text.matchAll(re)) (slots[m[1]] ??= []).includes(pkg) || slots[m[1]].push(pkg)
      }
    }
    walk(path.join(pkgsRoot, pkg), 0)
  }
  for (const key of Object.keys(slots)) slots[key].sort()
  return slots
}

/** 服务扫描：cordis 服务类构造里 `super(ctx, "name")` 的第一个字符串。 */
function scanServices(pkgsRoot) {
  const services = {}
  let pkgs = []
  try { pkgs = fs.readdirSync(pkgsRoot) } catch { return services }
  for (const pkg of pkgs) {
    const text = readText(path.join(pkgsRoot, pkg, 'lib', 'index.js'))
    if (!text) continue
    for (const m of text.matchAll(/super\(\s*(?:ctx|context)\s*,\s*["'`]([A-Za-z][\w.]*)["'`]/g)) services[m[1]] = pkg
  }
  return services
}

function capture() {
  const dshDir = resolveInstallDshDir()
  const pkgsRoot = path.join(dshDir, 'node_modules', '@deepseek-ai')
  const runtime = readJson(path.join(dshDir, 'desktop-runtime.json'))
  const core = readJson(path.join(dshDir, 'package.json'))
  const versions = {}
  for (const pkg of fs.readdirSync(pkgsRoot)) versions[pkg] = readJson(path.join(pkgsRoot, pkg, 'package.json'))?.version ?? 'unknown'
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    releaseVersion: runtime?.release?.version ?? core?.version ?? 'unknown',
    hostProtocolVersion: runtime?.release?.hostProtocolVersion ?? null,
    platform: process.platform,
    versions,
    slots: scanSlots(pkgsRoot),
    services: scanServices(pkgsRoot),
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
  const slotKeys = (o) => new Set(Object.keys(o ?? {}))
  const [bs, as] = [slotKeys(before.slots), slotKeys(after.slots)]
  for (const s of as) if (!bs.has(s)) lines.push(`槽位新增: ${s} ← ${after.slots[s].join(', ')}`)
  for (const s of bs) if (!as.has(s)) lines.push(`槽位消失: ${s}`)
  const svc = (o) => new Set(Object.keys(o ?? {}))
  const [bv, av] = [svc(before.services), svc(after.services)]
  for (const s of av) if (!bv.has(s)) lines.push(`服务新增: ${s} ← ${after.services[s]}`)
  for (const s of bv) if (!av.has(s)) lines.push(`服务消失: ${s}`)
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
  console.log(lines.length ? lines.join('\n') : '无变化：包版本、槽位、服务与旧快照完全一致')
} else {
  const outPath = flag('out')
  const json = JSON.stringify(snap, null, 2)
  if (outPath) { fs.writeFileSync(outPath, json + '\n', 'utf8'); console.log(`已写入 ${outPath}`) }
  else console.log(json)
}
