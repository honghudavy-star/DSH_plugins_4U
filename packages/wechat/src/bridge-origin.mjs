import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writePrivateFile } from './bridge-security.mjs'

const ID_PATTERN = /^[A-Za-z0-9_-]{32}$/
const MARKER_PATTERN = /^\[微信消息 bridge-origin:([A-Za-z0-9_-]{32})\] 来自「([^\r\n」]+)」/
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 256

function normalizeOwner(value) {
  const owner = typeof value === 'string' ? value.trim() : ''
  if (!owner || /[\r\n」]/.test(owner)) throw new Error('invalid_bridge_origin_owner')
  return owner
}

function validEntry(value) {
  if (!value || typeof value !== 'object') return false
  if (!ID_PATTERN.test(value.id) || typeof value.owner !== 'string' || !value.owner) return false
  if (!Number.isFinite(value.createdAt)) return false
  if (value.state === 'pending') return true
  return value.state === 'claimed' && typeof value.eventKey === 'string' && value.eventKey
}

function eventKey(event, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return ''
  return Number.isSafeInteger(event?.seq) && event.seq >= 0
    ? JSON.stringify([sessionId, event.seq])
    : ''
}

export function formatBridgeOriginMarker(ownerValue, correlationId) {
  const owner = normalizeOwner(ownerValue)
  if (!ID_PATTERN.test(correlationId)) throw new Error('invalid_bridge_origin_id')
  return `[微信消息 bridge-origin:${correlationId}] 来自「${owner}」`
}

export function parseBridgeOriginMarker(text) {
  if (typeof text !== 'string') return null
  const match = text.match(MARKER_PATTERN)
  if (!match) return null
  return { correlationId: match[1], owner: match[2] }
}

function originFromEvent(event) {
  const content = event?.data?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block?.type !== 'text') continue
    const parsed = parseBridgeOriginMarker(block.text)
    if (parsed) return parsed
  }
  return null
}

export class BridgeOriginStore {
  constructor(file, {
    now = () => Date.now(),
    createId = () => randomBytes(24).toString('base64url'),
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
  } = {}) {
    if (typeof file !== 'string' || !file) throw new Error('bridge_origin_file_required')
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('invalid_bridge_origin_ttl')
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error('invalid_bridge_origin_capacity')
    this.file = file
    this.now = now
    this.createId = createId
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.entries = this.#load()
  }

  #load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(parsed?.entries) ? parsed.entries.filter(validEntry) : []
    } catch {
      return []
    }
  }

  #pruned() {
    const cutoff = this.now() - this.ttlMs
    return this.entries.filter((entry) => validEntry(entry) && entry.createdAt >= cutoff)
  }

  #commit(entries) {
    writePrivateFile(this.file, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`)
    this.entries = entries
  }

  #persistPruneIfNeeded(entries) {
    if (entries.length !== this.entries.length) this.#commit(entries)
  }

  issue(ownerValue) {
    const owner = normalizeOwner(ownerValue)
    const current = this.#pruned()
    if (current.length >= this.maxEntries) {
      this.#persistPruneIfNeeded(current)
      throw new Error('bridge_origin_capacity_exceeded')
    }
    let id = ''
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.createId()
      if (ID_PATTERN.test(candidate) && !current.some((entry) => entry.id === candidate)) {
        id = candidate
        break
      }
    }
    if (!id) throw new Error('bridge_origin_id_generation_failed')
    this.#commit([...current, { id, owner, createdAt: this.now(), state: 'pending' }])
    return id
  }

  claim(id, ownerValue, key) {
    const owner = normalizeOwner(ownerValue)
    if (!ID_PATTERN.test(id) || typeof key !== 'string' || !key) return false
    const current = this.#pruned()
    const index = current.findIndex((entry) => entry.id === id && entry.owner === owner && entry.state === 'pending')
    if (index < 0) {
      this.#persistPruneIfNeeded(current)
      return false
    }
    const next = current.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, state: 'claimed', eventKey: key } : entry
    ))
    this.#commit(next)
    return true
  }

  resume(id, ownerValue, key) {
    const owner = normalizeOwner(ownerValue)
    if (!ID_PATTERN.test(id) || typeof key !== 'string' || !key) return false
    const current = this.#pruned()
    this.#persistPruneIfNeeded(current)
    return current.some((entry) => (
      entry.id === id
      && entry.owner === owner
      && entry.state === 'claimed'
      && entry.eventKey === key
    ))
  }

  revoke(id) {
    const current = this.#pruned()
    const next = current.filter((entry) => entry.id !== id)
    if (next.length !== this.entries.length) this.#commit(next)
  }

  complete(id) {
    this.revoke(id)
  }
}

export function authorizeBridgeOriginEvent(event, expectedOwnerValue, sessionId, store) {
  let expectedOwner
  try {
    expectedOwner = normalizeOwner(expectedOwnerValue)
  } catch {
    return null
  }
  const origin = originFromEvent(event)
  const key = eventKey(event, sessionId)
  if (!origin || origin.owner !== expectedOwner || !key) return null
  if (store.claim(origin.correlationId, expectedOwner, key)) {
    return { ...origin, resumed: false }
  }
  if (store.resume(origin.correlationId, expectedOwner, key)) {
    return { ...origin, resumed: true }
  }
  return null
}

export async function queueBridgeOriginPrompt({ store, owner, submit }) {
  if (typeof submit !== 'function') throw new Error('bridge_origin_submit_required')
  const correlationId = store.issue(owner)
  const marker = formatBridgeOriginMarker(owner, correlationId)
  try {
    return await submit({ correlationId, marker })
  } catch (error) {
    try {
      store.revoke(correlationId)
    } catch (revokeError) {
      throw new AggregateError([error, revokeError], 'prompt failed and bridge-origin correlation could not be revoked')
    }
    throw error
  }
}
