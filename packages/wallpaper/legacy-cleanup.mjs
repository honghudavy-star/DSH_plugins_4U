import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LEGACY_MARKER_START = '/* DSH_WALLPAPER_MARKER_START */'
export const LEGACY_MARKER_END = '/* DSH_WALLPAPER_MARKER_END */'
const LEGACY_PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme'

/** Remove only the complete pre-native wallpaper patch. */
export function stripLegacyWallpaperPatch(source) {
  const start = source.indexOf(LEGACY_MARKER_START)
  if (start === -1) return { source, changed: false }
  const end = source.indexOf(LEGACY_MARKER_END, start + LEGACY_MARKER_START.length)
  if (end === -1) throw new Error('旧版壁纸补丁不完整，已停止以避免误删主题 bundle')
  return {
    source: source.slice(0, start) + source.slice(end + LEGACY_MARKER_END.length),
    changed: true,
  }
}

function legacyBundleCandidates(bundlePath) {
  if (bundlePath) return [bundlePath]
  const explicit = process.env.DSH_WALLPAPER_BUNDLE?.trim()
  if (explicit) return [explicit]
  const npxRoot = join(homedir(), '.npm', '_npx')
  if (!existsSync(npxRoot)) return []
  return readdirSync(npxRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(npxRoot, entry.name, 'node_modules', LEGACY_PLUGIN_ID, 'lib', 'client.js'))
    .filter(existsSync)
    .filter(path => readFileSync(path, 'utf8').includes(LEGACY_MARKER_START))
}

/** Remove the old bundle patch, refusing to guess when multiple patched bundles exist. */
export function removeLegacyWallpaperPatch({ bundlePath } = {}) {
  const candidates = legacyBundleCandidates(bundlePath)
  if (candidates.length === 0) return false
  if (candidates.length > 1 && !bundlePath && !process.env.DSH_WALLPAPER_BUNDLE?.trim()) {
    throw new Error(`发现多个带旧版壁纸补丁的主题 bundle，请设置 DSH_WALLPAPER_BUNDLE 后重试：${candidates.join(', ')}`)
  }
  const target = candidates[0]
  const result = stripLegacyWallpaperPatch(readFileSync(target, 'utf8'))
  if (!result.changed) return false
  const temporary = `${target}.dsh-wallpaper-cleanup-${process.pid}-${Date.now()}.tmp`
  try {
    writeFileSync(temporary, result.source, { mode: 0o600 })
    renameSync(temporary, target)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
  return true
}
