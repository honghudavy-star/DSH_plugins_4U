import Schema from '@deepseek-ai/schemastery'
import { SiliconFlowClient } from './luma-mcp/build/siliconflow-client.js'
import { sanitizeErrorMessage, withRetry } from './luma-mcp/build/utils/helpers.js'

export const name = 'dsh-plugins-vision'
export const inject = ['webServer']

const ROUTE = '/plugins/dsh-vision/analyze'
const SUPPORTED_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const DEFAULT_PROMPT = '请客观描述图片内容；如果图片包含文字，请准确提取。不要编造不可见的信息。'

export const Config = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref').default('SILICONFLOW_API_KEY'),
  model: Schema.string().default('deepseek-ai/DeepSeek-OCR'),
  maxImages: Schema.number().step(1).min(1).max(6).default(3),
  maxImageBytes: Schema.number().step(1).min(1).default(5 * 1024 * 1024),
  maxRequestBytes: Schema.number().step(1).min(1).default(20 * 1024 * 1024),
  maxTokens: Schema.number().step(1).min(1).max(4096).default(4096),
  temperature: Schema.number().min(0).max(2).default(0.2),
  topP: Schema.number().min(0).max(1).default(0.95),
  retries: Schema.number().step(1).min(0).max(3).default(1),
  basePrompt: Schema.string().default(DEFAULT_PROMPT),
})

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let rejected = false
    req.on('data', chunk => {
      if (rejected) return
      size += chunk.length
      if (size > maxBytes) {
        rejected = true
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (rejected) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 })) }
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
    apiKeyEnv: config.apiKeyEnv,
    model: config.model,
    maxImages: config.maxImages,
    maxImageBytes: config.maxImageBytes,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    retries: config.retries,
  }
}

function validateConfigPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('configuration must be an object'), { statusCode: 400 })
  const patch = {}
  const stringField = (name, max) => {
    if (!Object.hasOwn(body, name)) return
    if (typeof body[name] !== 'string' || !body[name].trim() || body[name].length > max) throw Object.assign(new Error(`${name} must be a non-empty string`), { statusCode: 400 })
    patch[name] = body[name].trim()
  }
  const numberField = (name, min, max, integer = false) => {
    if (!Object.hasOwn(body, name)) return
    const value = body[name]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw Object.assign(new Error(`${name} must be between ${min} and ${max}`), { statusCode: 400 })
    }
    patch[name] = value
  }
  stringField('apiKeyEnv', 128)
  stringField('model', 256)
  numberField('maxImages', 1, 6, true)
  numberField('maxImageBytes', 1, 50 * 1024 * 1024, true)
  numberField('maxTokens', 1, 4096, true)
  numberField('temperature', 0, 2)
  numberField('retries', 0, 3, true)
  return patch
}

export function createVisionConfigController(ctx, entry) {
  let source = () => entry
  let scope
  ctx.inject(['settings'], settingsCtx => {
    scope = settingsCtx.settings.register('dsh-plugins-vision', Config, { base: entry, applies: 'live' })
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

async function credentialStatus(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return { configured: Boolean(process.env[ref]), writable: false, source: process.env[ref] ? 'env' : undefined }
  return credentials.describe(ref)
}

function imageDataUri(image, maxBytes) {
  if (!image || typeof image !== 'object') throw Object.assign(new Error('invalid image entry'), { statusCode: 400 })
  const mediaType = String(image.mediaType || '')
  if (!SUPPORTED_MEDIA.has(mediaType)) throw Object.assign(new Error(`unsupported image type: ${mediaType || '(empty)'}`), { statusCode: 400 })
  const data = String(image.data || '')
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw Object.assign(new Error('invalid base64 image data'), { statusCode: 400 })
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const bytes = data.length * 3 / 4 - padding
  if (bytes === 0 || bytes > maxBytes) throw Object.assign(new Error(`image exceeds ${maxBytes} bytes`), { statusCode: 413 })
  return `data:${mediaType};base64,${data}`
}

async function resolveApiKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit?.value?.trim()) return hit.value.trim()
  }
  const value = process.env[ref]?.trim()
  return value || undefined
}

async function analyze(ctx, config, body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.images)) {
    throw Object.assign(new Error('images must be an array'), { statusCode: 400 })
  }
  if (body.images.length === 0 || body.images.length > config.maxImages) {
    throw Object.assign(new Error(`images must contain 1-${config.maxImages} items`), { statusCode: 400 })
  }
  const key = await resolveApiKey(ctx, config.apiKeyEnv)
  if (key === undefined) throw Object.assign(new Error(`credential ${config.apiKeyEnv} is not configured`), { statusCode: 503 })
  const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : DEFAULT_PROMPT
  const imageData = body.images.map(image => imageDataUri(image, config.maxImageBytes))
  const fullPrompt = [config.basePrompt, prompt].filter(Boolean).join('\n\n')
  const client = new SiliconFlowClient({
    provider: 'siliconflow',
    apiKey: key,
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    topP: config.topP,
    enableThinking: false,
    includeMeta: false,
  })
  const execute = withRetry((images, task) => client.analyzeImage(images, task, false), config.retries, 750)
  return execute(imageData, fullPrompt)
}

export function apply(ctx, config) {
  const settings = createVisionConfigController(ctx, config)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        const current = settings.current()
        const body = await readJson(req, current.maxRequestBytes)
        const result = await analyze(ctx, current, body)
        sendJson(res, 200, { ok: true, result })
      } catch (error) {
        const status = Number(error?.statusCode) || 500
        const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error))
        if (status >= 500) ctx.logger.warn(`dsh-plugins-vision: ${message}`)
        sendJson(res, status, { ok: false, error: message })
      }
    },
  }), 'dsh-plugins-vision: analyze route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-vision/config',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        const current = settings.current()
        const credential = await credentialStatus(ctx, current.apiKeyEnv)
        return sendJson(res, 200, { ok: true, config: configurable(current), credential })
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'GET, POST')
        return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      }
      if (!sameOrigin(req) || !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return sendJson(res, 403, { ok: false, error: 'same-origin JSON request required' })
      }
      try {
        const body = await readJson(req, 64 * 1024)
        const patch = validateConfigPatch(body)
        const current = await settings.update(patch)
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
          const credentials = ctx.get('credentials')
          if (credentials === undefined) throw Object.assign(new Error('DSH credential service is unavailable'), { statusCode: 503 })
          await credentials.set(current.apiKeyEnv, body.apiKey.trim())
        }
        const credential = await credentialStatus(ctx, current.apiKeyEnv)
        return sendJson(res, 200, { ok: true, config: configurable(current), credential })
      } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-plugins-vision: config route')
}
