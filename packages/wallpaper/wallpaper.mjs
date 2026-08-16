#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRESETS_DIR = join(HERE, 'presets')
const STATE_DIR = join(homedir(), '.dsh-plugins', 'wallpaper')
const STATE_FILE = join(STATE_DIR, 'config.json')
const MANAGED_IMAGE = join(STATE_DIR, 'current.jpg')
const PREFIX = '[dsh-plugins/wallpaper]'

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return undefined }
}

function saveState(value) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, `${JSON.stringify(value, null, 2)}\n`)
}

function numberOption(args, name, fallback) {
  const at = args.indexOf(name)
  if (at === -1) return fallback
  const value = Number(args[at + 1])
  if (!Number.isFinite(value)) throw new Error(`${name} requires a number`)
  return value
}

function installImage(source) {
  mkdirSync(STATE_DIR, { recursive: true })
  if (platform() === 'darwin') {
    const result = spawnSync('sips', ['-Z', '1920', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', source, '--out', MANAGED_IMAGE], { stdio: 'ignore' })
    if (result.status === 0 && existsSync(MANAGED_IMAGE)) return MANAGED_IMAGE
  }
  const extension = source.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/)?.[0] ?? '.jpg'
  const target = join(STATE_DIR, `current${extension}`)
  copyFileSync(source, target)
  return target
}

function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'status'
  if (command === 'list') {
    for (const file of readdirSync(PRESETS_DIR).filter(file => file.endsWith('.png')).sort()) console.log(file.slice(0, -4))
    return
  }
  if (command === 'status') {
    const state = loadState()
    console.log(`${PREFIX} ${state === undefined ? 'preset:midnight (default)' : JSON.stringify(state)}`)
    return
  }
  if (command === 'off') {
    saveState({ source: null, opacity: 0.3 })
    console.log(`${PREFIX} 已关闭；刷新 DSH 页面后生效`)
    return
  }
  if (command === 'apply') {
    console.log(`${PREFIX} 原生插件按页面请求读取配置；刷新 DSH 页面即可重新应用`)
    return
  }
  if (command !== 'set' || !args[1]) throw new Error('usage: dsh-plugins-wallpaper set <preset|image> [--opacity 0.3]')
  const opacity = numberOption(args, '--opacity', 0.3)
  if (opacity < 0 || opacity > 1) throw new Error('--opacity must be between 0 and 1')
  const preset = join(PRESETS_DIR, `${args[1]}.png`)
  if (existsSync(preset)) {
    saveState({ source: `preset:${args[1]}`, opacity })
  } else {
    const source = resolve(args[1])
    if (!existsSync(source)) throw new Error(`image not found: ${source}`)
    saveState({ source: installImage(source), opacity })
  }
  console.log(`${PREFIX} 已保存；刷新 DSH 页面后生效`)
}

try { main() } catch (error) {
  console.error(`${PREFIX} ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
