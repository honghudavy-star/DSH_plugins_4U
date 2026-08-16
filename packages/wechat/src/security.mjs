import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'

const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,}$/
const ORIGIN_PATTERN = /^\[微信消息 bridge-origin=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]/i

export function secureStateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

export function writePrivateFile(path, data) {
  writeFileSync(path, data, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export function loadOrCreateBridgeToken(stateDir, configured = '') {
  secureStateDirectory(stateDir)
  const file = join(stateDir, 'bridge-token')
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error(`bridge token must not be a symlink: ${file}`)
  const stored = existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
  const token = configured || stored || randomBytes(32).toString('hex')
  if (!TOKEN_PATTERN.test(token)) throw new Error('bridge token must contain at least 32 safe characters')
  writePrivateFile(file, `${token}\n`)
  return { token, file }
}

export function resolveOutboundFile(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('outbound file must be an absolute path')
  const link = lstatSync(value)
  if (link.isSymbolicLink()) throw new Error('outbound file must not be a symlink')
  const canonical = realpathSync(value)
  if (!statSync(canonical).isFile()) throw new Error('outbound file must be a regular file')
  return canonical
}

export class OriginRegistry {
  constructor(file, maxAgeMs = 24 * 60 * 60 * 1000) {
    this.file = file
    this.maxAgeMs = maxAgeMs
    this.entries = new Map()
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      const now = Date.now()
      for (const [origin, entry] of Object.entries(raw)) {
        if (typeof entry?.userId === 'string' && typeof entry?.createdAt === 'number' && now - entry.createdAt <= maxAgeMs) {
          this.entries.set(origin, entry)
        }
      }
    } catch {}
    this.persist()
  }

  create(userId) {
    const origin = randomUUID()
    this.entries.set(origin, { userId, createdAt: Date.now() })
    this.persist()
    return origin
  }

  resolve(text) {
    const origin = typeof text === 'string' ? text.match(ORIGIN_PATTERN)?.[1] : undefined
    const entry = origin === undefined ? undefined : this.entries.get(origin)
    return entry === undefined ? undefined : { origin, userId: entry.userId }
  }

  consume(origin) {
    if (this.entries.delete(origin)) this.persist()
  }

  persist() {
    secureStateDirectory(dirname(this.file))
    writePrivateFile(this.file, `${JSON.stringify(Object.fromEntries(this.entries), null, 2)}\n`)
  }
}
