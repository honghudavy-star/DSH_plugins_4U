import { existsSync, readFileSync, statSync } from 'node:fs'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-plugins-wallpaper'
export const inject = ['webServer']

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_STATE_FILE = join(homedir(), '.dsh-plugins', 'wallpaper', 'config.json')
const UPLOAD_DIR = join(homedir(), '.dsh-plugins', 'wallpaper', 'uploads')
const MIME = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])
const UPLOAD_EXTENSIONS = new Map([
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  source: Schema.string().default(''),
  opacity: Schema.number().min(0).max(1).default(0.3),
  stateFile: Schema.string().default(''),
  maxImageBytes: Schema.number().min(1).default(10 * 1024 * 1024),
})

function readState(path) {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

function sourcePath(source) {
  if (source.startsWith('preset:')) {
    const preset = source.slice('preset:'.length)
    if (!/^[a-z0-9-]+$/i.test(preset)) throw new Error(`invalid wallpaper preset: ${preset}`)
    return join(HERE, 'presets', `${preset}.png`)
  }
  return isAbsolute(source) ? source : join(process.cwd(), source)
}

function escapeCssUrl(value) {
  return value.replaceAll('\\', '\\5c ').replaceAll('"', '\\22 ')
}

function resolveWallpaper(config) {
  if (config.enabled === false) return undefined
  const stateFile = config.stateFile || DEFAULT_STATE_FILE
  const state = readState(stateFile)
  const hasState = state !== undefined && Object.hasOwn(state, 'source')
  const source = config.source || (hasState ? state.source : 'preset:midnight')
  if (source === null || source === '') return undefined
  if (typeof source !== 'string') throw new Error('wallpaper source must be a string or null')
  const opacity = typeof state?.opacity === 'number' && !config.source ? state.opacity : config.opacity
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('wallpaper opacity must be between 0 and 1')
  const path = sourcePath(source)
  if (!existsSync(path)) throw new Error(`wallpaper image does not exist: ${path}`)
  const size = statSync(path).size
  if (size > config.maxImageBytes) throw new Error(`wallpaper image exceeds ${config.maxImageBytes} bytes: ${path}`)
  const mime = MIME.get(extname(path).toLowerCase())
  if (mime === undefined) throw new Error(`unsupported wallpaper format: ${extname(path) || '(none)'}`)
  const data = readFileSync(path).toString('base64')
  return { dataUrl: `data:${mime};base64,${data}`, opacity }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 })) }
    })
    req.on('error', reject)
  })
}

function readBytes(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let rejected = false
    req.on('data', chunk => {
      if (rejected) return
      size += chunk.length
      if (size > maxBytes) {
        rejected = true
        reject(Object.assign(new Error(`image exceeds ${maxBytes} bytes`), { statusCode: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function sameOrigin(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

function configurable(config) {
  return {
    enabled: config.enabled,
    source: config.source || 'preset:midnight',
    opacity: config.opacity,
  }
}

export function validateUploadedImage(data, mediaType) {
  if (!Buffer.isBuffer(data) || data.length === 0) throw Object.assign(new Error('image body is empty'), { statusCode: 400 })
  const valid = mediaType === 'image/png'
    ? data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mediaType === 'image/jpeg'
      ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
      : mediaType === 'image/gif'
        ? data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))
        : mediaType === 'image/webp'
          ? data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'
          : false
  if (!valid) throw Object.assign(new Error(`file content does not match ${mediaType}`), { statusCode: 400 })
  return UPLOAD_EXTENSIONS.get(mediaType)
}

async function saveUploadedImage(data, mediaType) {
  const extension = validateUploadedImage(data, mediaType)
  await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 })
  await chmod(UPLOAD_DIR, 0o700)
  const target = join(UPLOAD_DIR, `current${extension}`)
  const temporary = join(UPLOAD_DIR, `.upload-${process.pid}-${Date.now()}${extension}`)
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
    await chmod(target, 0o600)
    return target
  } finally {
    await rm(temporary, { force: true })
  }
}

function validatePatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('configuration must be an object'), { statusCode: 400 })
  const patch = {}
  if (Object.hasOwn(body, 'enabled')) {
    if (typeof body.enabled !== 'boolean') throw Object.assign(new Error('enabled must be boolean'), { statusCode: 400 })
    patch.enabled = body.enabled
  }
  if (Object.hasOwn(body, 'source')) {
    if (typeof body.source !== 'string' || body.source.length > 4096) throw Object.assign(new Error('source must be a string'), { statusCode: 400 })
    if (body.source.startsWith('preset:') && !['preset:midnight', 'preset:aurora', 'preset:forest', 'preset:sunset'].includes(body.source)) {
      throw Object.assign(new Error('unknown wallpaper preset'), { statusCode: 400 })
    }
    if (body.source && !body.source.startsWith('preset:') && !isAbsolute(body.source)) {
      throw Object.assign(new Error('custom wallpaper path must be absolute'), { statusCode: 400 })
    }
    patch.source = body.source
  }
  if (Object.hasOwn(body, 'opacity')) {
    if (typeof body.opacity !== 'number' || !Number.isFinite(body.opacity) || body.opacity < 0 || body.opacity > 1) {
      throw Object.assign(new Error('opacity must be between 0 and 1'), { statusCode: 400 })
    }
    patch.opacity = body.opacity
  }
  return patch
}

export function createWallpaperConfigController(ctx, entry) {
  let source = () => entry
  let scope
  ctx.inject(['settings'], settingsCtx => {
    scope = settingsCtx.settings.register('dsh-plugins-wallpaper', Config, { base: entry, applies: 'live' })
    source = () => scope.get()
  })
  return {
    current: () => source(),
    update: async patch => {
      if (scope === undefined) throw Object.assign(new Error('DSH settings service is unavailable'), { statusCode: 503 })
      await scope.update(patch)
      return source()
    },
  }
}

export function injectWallpaper(html, config) {
  const wallpaper = resolveWallpaper(config)
  if (wallpaper === undefined) return html
  const css = `body::before{content:"";position:fixed;inset:0;z-index:1;pointer-events:none;background:url("${escapeCssUrl(wallpaper.dataUrl)}") center/cover no-repeat;opacity:${wallpaper.opacity}}`
  const style = `<style id="dsh-plugins-wallpaper" data-dsh-plugin="@dsh-plugins/wallpaper">${css}</style>`
  return html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : `${style}${html}`
}

export function apply(ctx, config) {
  const settings = createWallpaperConfigController(ctx, config)
  ctx.effect(
    () => ctx.webServer.tapIndex(html => injectWallpaper(html, settings.current())),
    'dsh-plugins-wallpaper: index style',
  )
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-wallpaper/config',
    handler: async (req, res) => {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, config: configurable(settings.current()) })
      if (req.method !== 'POST') {
        res.setHeader('allow', 'GET, POST')
        return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      }
      if (!sameOrigin(req) || !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return sendJson(res, 403, { ok: false, error: 'same-origin JSON request required' })
      }
      try {
        const updated = await settings.update(validatePatch(await readJson(req)))
        return sendJson(res, 200, { ok: true, config: configurable(updated) })
      } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-plugins-wallpaper: config route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-wallpaper/upload',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      }
      if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'same-origin request required' })
      const mediaType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
      if (!UPLOAD_EXTENSIONS.has(mediaType)) return sendJson(res, 415, { ok: false, error: 'supported image types: PNG, JPEG, WebP, GIF' })
      try {
        const current = settings.current()
        const declaredSize = Number(req.headers['content-length'])
        if (Number.isFinite(declaredSize) && declaredSize > current.maxImageBytes) {
          throw Object.assign(new Error(`image exceeds ${current.maxImageBytes} bytes`), { statusCode: 413 })
        }
        const source = await saveUploadedImage(await readBytes(req, current.maxImageBytes), mediaType)
        const updated = await settings.update({ enabled: true, source })
        return sendJson(res, 200, { ok: true, config: configurable(updated) })
      } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-plugins-wallpaper: upload route')
}
