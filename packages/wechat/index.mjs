import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-plugins-wechat'
export const inject = ['webServer']

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dshBase: Schema.string().default(''),
  stateDir: Schema.string().default(''),
  owner: Schema.string().default(''),
  sessionId: Schema.string().default(''),
  cwd: Schema.string().default(''),
  bridgePort: Schema.number().step(1).min(1).max(65535).default(8790),
  bridgeToken: Schema.string().role('secret').default(''),
  restartDelayMs: Schema.number().step(1).min(250).default(3000),
  analyzeInboundImages: Schema.boolean().default(true),
})

const BRIDGE = fileURLToPath(new URL('./src/dsh-wechat-bridge.mjs', import.meta.url))

export function isBridgePortAvailable(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const probe = createServer()
    probe.unref()
    probe.once('error', error => resolve({ available: false, code: error?.code }))
    probe.listen(port, host, () => probe.close(() => resolve({ available: true })))
  })
}

function bridgeEnvironment(ctx, config) {
  const base = config.dshBase || `http://127.0.0.1:${ctx.webServer.port}`
  return {
    ...process.env,
    DSH_BASE: base,
    WECHAT_CRED_DIR: config.stateDir || join(homedir(), '.dsh-wechat'),
    WECHAT_BRIDGE_PORT: String(config.bridgePort),
    WECHAT_ANALYZE_IMAGES: config.analyzeInboundImages ? '1' : '0',
    ...(config.bridgeToken ? { WECHAT_BRIDGE_TOKEN: config.bridgeToken } : {}),
    ...(config.owner ? { WECHAT_OWNER: config.owner } : {}),
    ...(config.sessionId ? { WECHAT_SESSION_ID: config.sessionId } : {}),
    ...(config.cwd ? { DSH_CWD: config.cwd } : {}),
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readJson(req, maxBytes = 64 * 1024) {
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
    enabled: config.enabled,
    owner: config.owner,
    sessionId: config.sessionId,
    bridgePort: config.bridgePort,
    analyzeInboundImages: config.analyzeInboundImages,
  }
}

function validatePatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('configuration must be an object'), { statusCode: 400 })
  }
  const patch = {}
  for (const name of ['enabled', 'analyzeInboundImages']) {
    if (!Object.hasOwn(body, name)) continue
    if (typeof body[name] !== 'boolean') throw Object.assign(new Error(`${name} must be boolean`), { statusCode: 400 })
    patch[name] = body[name]
  }
  for (const name of ['owner', 'sessionId']) {
    if (!Object.hasOwn(body, name)) continue
    if (typeof body[name] !== 'string' || body[name].length > 512) throw Object.assign(new Error(`${name} must be a string`), { statusCode: 400 })
    patch[name] = body[name].trim()
  }
  if (Object.hasOwn(body, 'bridgePort')) {
    if (!Number.isInteger(body.bridgePort) || body.bridgePort < 1 || body.bridgePort > 65535) {
      throw Object.assign(new Error('bridgePort must be an integer between 1 and 65535'), { statusCode: 400 })
    }
    patch.bridgePort = body.bridgePort
  }
  return patch
}

export function createWechatConfigController(ctx, entry, onChange = () => {}) {
  let source = () => entry
  let scope
  ctx.inject(['settings'], settingsCtx => {
    scope = settingsCtx.settings.register('dsh-plugins-wechat', Config, { base: entry, applies: 'live' })
    source = () => scope.get()
    scope.watch((next, previous) => onChange(next, previous))
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

export function apply(ctx, config) {
  let requestRestart = () => {}
  const settings = createWechatConfigController(ctx, config, () => requestRestart())
  ctx.effect(() => {
    let stopped = false
    let child
    let timer
    let waitingForPort = false
    let launching = false
    let restartRequested = false

    const schedule = () => {
      if (stopped) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void launch()
      }, settings.current().restartDelayMs)
    }

    const launch = async () => {
      if (stopped || launching || child !== undefined) return
      const current = settings.current()
      if (!current.enabled) return
      launching = true
      const port = await isBridgePortAvailable(current.bridgePort)
      launching = false
      if (stopped) return
      if (restartRequested) {
        restartRequested = false
        void launch()
        return
      }
      if (!port.available) {
        if (!waitingForPort) {
          ctx.logger.warn(`dsh-plugins-wechat: bridge port ${current.bridgePort} is already in use; waiting for it instead of spawning a duplicate bridge`)
        }
        waitingForPort = true
        schedule()
        return
      }
      if (waitingForPort) ctx.logger.info(`dsh-plugins-wechat: bridge port ${current.bridgePort} is available; starting bridge`)
      waitingForPort = false
      child = spawn(process.execPath, [BRIDGE], {
        cwd: current.cwd || process.cwd(),
        env: bridgeEnvironment(ctx, current),
        stdio: 'inherit',
      })
      child.once('error', error => ctx.logger.error(error))
      child.once('exit', (code, signal) => {
        child = undefined
        if (stopped) return
        if (restartRequested) {
          restartRequested = false
          void launch()
          return
        }
        ctx.logger.warn(`dsh-plugins-wechat: bridge exited (code=${String(code)}, signal=${String(signal)}); restarting`)
        schedule()
      })
    }

    requestRestart = () => {
      if (stopped) return
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (child !== undefined) {
        restartRequested = true
        child.kill('SIGTERM')
      } else if (launching) {
        restartRequested = true
      } else {
        void launch()
      }
    }

    void launch()
    return () => {
      stopped = true
      requestRestart = () => {}
      if (timer !== undefined) clearTimeout(timer)
      child?.kill('SIGTERM')
    }
  }, 'dsh-plugins-wechat: bridge supervisor')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-wechat/config',
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
  }), 'dsh-plugins-wechat: config route')
}
