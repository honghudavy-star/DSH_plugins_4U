import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'

export const WECHAT_STATE_MARKER = '.dsh-wechat-state'
export const WECHAT_STATE_MARKER_CONTENT = 'dsh-wechat-state-v1\n'

const KNOWN_STATE_FILES = new Set([
  WECHAT_STATE_MARKER,
  'credentials.json',
  'sync-buf.json',
  'session.json',
  'owner.json',
  'tokens.json',
  'forward-state.json',
  'bridge-origins.json',
  'bridge-token',
  'bridge.out.log',
  'bridge.err.log',
])

function lstatIfExists(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

// Resolve every existing path component, including an intermediate symlink,
// while retaining a not-yet-created suffix. This makes preflight comparisons
// semantic instead of merely lexical.
export function canonicalizeWithExistingAncestor(value) {
  let cursor = resolve(value)
  const suffix = []
  for (;;) {
    const stat = lstatIfExists(cursor)
    if (stat) {
      let existing
      try {
        existing = realpathSync(cursor)
      } catch (error) {
        throw new Error(`cannot canonicalize path: ${value}`, { cause: error })
      }
      return resolve(existing, ...suffix)
    }
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error(`cannot find an existing ancestor for path: ${value}`)
    suffix.unshift(basename(cursor))
    cursor = parent
  }
}

export function pathContains(parentValue, childValue) {
  const parent = canonicalizeWithExistingAncestor(parentValue)
  const child = canonicalizeWithExistingAncestor(childValue)
  const rest = relative(parent, child)
  return rest === '' || (rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest))
}

export function pathsOverlap(left, right) {
  return pathContains(left, right) || pathContains(right, left)
}

function isKnownStateEntry(name) {
  return KNOWN_STATE_FILES.has(name)
    || name === 'media'
    || /^instructed-v4-[^/]+$/.test(name)
}

function hasLegacyStateIdentity(root, entries) {
  if (entries.every((name) => isKnownStateEntry(name))) return true
  if (!entries.includes('credentials.json')) return false
  try {
    const credentials = JSON.parse(readFileSync(join(root, 'credentials.json'), 'utf8'))
    return Boolean(credentials && typeof credentials === 'object'
      && (credentials.accountId || credentials.token || credentials.baseUrl || credentials.userId))
  } catch {
    return false
  }
}

export function validateWechatCredentialDirectory(rootValue, {
  home = homedir(),
  protectedPaths = [],
  allowLegacy = false,
} = {}) {
  const root = canonicalizeWithExistingAncestor(rootValue)
  const homePath = canonicalizeWithExistingAncestor(home)
  const filesystemRoot = dirname(root)
  if (filesystemRoot === root || root === homePath || pathContains(root, homePath)) {
    throw new Error(`unsafe WeChat credential directory: ${rootValue}`)
  }
  for (const protectedPath of protectedPaths) {
    if (protectedPath && pathsOverlap(root, protectedPath)) {
      throw new Error(`WeChat credential directory overlaps a protected path: ${rootValue}`)
    }
  }

  const directStat = lstatIfExists(resolve(rootValue))
  if (directStat?.isSymbolicLink()) {
    throw new Error(`private directory must not be a symbolic link: ${rootValue}`)
  }
  const stat = lstatIfExists(root)
  if (!stat) return root
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`private directory is not a real directory: ${rootValue}`)
  }
  const entries = readdirSync(root)
  if (!entries.length) return root
  const unknown = entries.filter((name) => !isKnownStateEntry(name))
  if (unknown.length) {
    throw new Error(`credential directory contains unknown entries: ${unknown.join(', ')}`)
  }

  const marker = join(root, WECHAT_STATE_MARKER)
  let marked = false
  try {
    const markerStat = lstatSync(marker)
    marked = markerStat.isFile()
      && !markerStat.isSymbolicLink()
      && readFileSync(marker, 'utf8') === WECHAT_STATE_MARKER_CONTENT
  } catch {}
  if (!marked && !(allowLegacy && hasLegacyStateIdentity(root, entries))) {
    throw new Error(`existing credential directory is not recognizable dsh-wechat state: ${rootValue}`)
  }
  return root
}

export function requireSupportedNode(version = process.versions.node) {
  const match = typeof version === 'string' ? version.match(/^(\d+)\./) : null
  const major = match ? Number(match[1]) : Number.NaN
  if (!Number.isSafeInteger(major) || major < 22) {
    throw new Error(`Node.js 22 or newer is required (current: ${version || 'unknown'})`)
  }
  return major
}

export function ensurePrivateDirectory(dir) {
  if (existsSync(dir)) {
    const stat = lstatSync(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`private directory is not a real directory: ${dir}`)
    }
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  chmodSync(dir, 0o700)
}

export function writePrivateFile(file, data) {
  const parent = dirname(file)
  if (existsSync(parent)) {
    const stat = lstatSync(parent)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`private file parent is not a real directory: ${parent}`)
    }
  } else {
    mkdirSync(parent, { recursive: true, mode: 0o700 })
  }
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, data, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, file)
    chmodSync(file, 0o600)
  } catch (error) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch {}
    throw error
  }
}

export function hardenPrivateTree(root) {
  ensurePrivateDirectory(root)
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        chmodSync(path, 0o700)
        visit(path)
      } else if (stat.isFile()) {
        chmodSync(path, 0o600)
      }
    }
  }
  visit(root)
}

function hardenKnownMediaTree(root) {
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`media directory is not a real directory: ${root}`)
  }
  chmodSync(root, 0o700)
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const item = lstatSync(path)
    if (item.isSymbolicLink()) continue
    if (item.isDirectory()) hardenKnownMediaTree(path)
    else if (item.isFile()) chmodSync(path, 0o600)
  }
}

// Only migrate permissions for files owned by this bridge. An unrelated file
// accidentally placed in the configured directory is deliberately untouched.
export function hardenWechatCredentialDirectory(root) {
  ensurePrivateDirectory(root)
  for (const name of readdirSync(root)) {
    if (!isKnownStateEntry(name)) continue
    const path = join(root, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) continue
    if (name === 'media') {
      hardenKnownMediaTree(path)
    } else if (stat.isFile()) {
      chmodSync(path, 0o600)
    }
  }
}

export function ensureWechatStateMarker(root, write = writePrivateFile) {
  const marker = join(root, WECHAT_STATE_MARKER)
  write(marker, WECHAT_STATE_MARKER_CONTENT)
  return marker
}

export function prepareWechatCredentialState(root, {
  home = homedir(),
  protectedPaths = [],
  allowLegacy = false,
  harden = hardenWechatCredentialDirectory,
  write = writePrivateFile,
} = {}) {
  const validated = validateWechatCredentialDirectory(root, { home, protectedPaths, allowLegacy })
  harden(validated)
  ensureWechatStateMarker(validated, write)
  return validated
}

export function loadOrCreateSecret(file, configuredValue, bytes = 32) {
  const configured = typeof configuredValue === 'string' ? configuredValue.trim() : ''
  if (configured) {
    writePrivateFile(file, `${configured}\n`)
    return configured
  }
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error(`secret file must not be a symbolic link: ${file}`)
    const saved = readFileSync(file, 'utf8').trim()
    if (saved) {
      chmodSync(file, 0o600)
      return saved
    }
  } catch {}
  const generated = randomBytes(bytes).toString('base64url')
  writePrivateFile(file, `${generated}\n`)
  return generated
}

function normalizedUserId(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function credentialsFromLogin(result) {
  const userId = normalizedUserId(result?.userId)
  return {
    accountId: result?.accountId,
    token: result?.botToken,
    baseUrl: result?.baseUrl,
    ...(userId ? { userId } : {}),
  }
}

export function resolveOwner(savedCredentials, configuredOwner) {
  return normalizedUserId(savedCredentials?.userId)
    || normalizedUserId(configuredOwner)
}

export function requireOwner(savedCredentials, configuredOwner) {
  const owner = resolveOwner(savedCredentials, configuredOwner)
  if (!owner) throw new Error('owner_required')
  return owner
}

export function isOwnerUser(userId, owner) {
  const normalizedOwner = normalizedUserId(owner)
  return Boolean(normalizedOwner) && typeof userId === 'string' && userId === normalizedOwner
}

export function constantTimeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function isBearerAuthorized(header, token) {
  if (typeof header !== 'string' || typeof token !== 'string' || !token) return false
  return constantTimeEqual(header, `Bearer ${token}`)
}

export function selectOwnerRecipient(requested, owner) {
  const normalizedOwner = normalizedUserId(owner)
  if (!normalizedOwner) throw new Error('no_owner_configured')
  if (requested != null && (typeof requested !== 'string' || !requested.trim())) {
    throw new Error('invalid_recipient')
  }
  const recipient = typeof requested === 'string' ? requested.trim() : normalizedOwner
  if (recipient !== normalizedOwner) throw new Error('recipient_not_allowed')
  return normalizedOwner
}

export function resolveLocalFile(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim() || !isAbsolute(candidate.trim())) {
    throw new Error('file_must_be_an_absolute_path')
  }
  let file
  try {
    file = realpathSync(candidate.trim())
  } catch {
    throw new Error('file_not_found')
  }
  if (!statSync(file).isFile()) throw new Error('file_not_regular')
  return file
}
