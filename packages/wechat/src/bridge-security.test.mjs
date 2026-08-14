import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  canonicalizeWithExistingAncestor,
  credentialsFromLogin,
  hardenPrivateTree,
  isBearerAuthorized,
  isOwnerUser,
  loadOrCreateSecret,
  prepareWechatCredentialState,
  requireOwner,
  requireSupportedNode,
  resolveLocalFile,
  selectOwnerRecipient,
  validateWechatCredentialDirectory,
  WECHAT_STATE_MARKER,
  WECHAT_STATE_MARKER_CONTENT,
  writePrivateFile,
} from './bridge-security.mjs'
import { createBridgeRequestHandler } from './bridge-http.mjs'
import {
  BridgeOriginStore,
  authorizeBridgeOriginEvent,
  formatBridgeOriginMarker,
  queueBridgeOriginPrompt,
} from './bridge-origin.mjs'
import { fetchHistoryThroughWaterline, finishForwardingTurn, sendPendingReply } from './bridge-forwarding.mjs'
import {
  activatePreparedInstallation,
  buildPlist,
  deployRuntimeAtomically,
  installWechatService,
  isMainModule,
  prepareWechatInstallation,
  validateInstallationLayout,
  validateNodeBinary,
} from '../install.mjs'

function mode(path) {
  return statSync(path).mode & 0o777
}

function markCredentialDirectory(directory) {
  writeFileSync(join(directory, WECHAT_STATE_MARKER), WECHAT_STATE_MARKER_CONTENT, { mode: 0o600 })
}

function writeRuntime(directory, bridge = 'old bridge') {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), '{"name":"dsh-wechat"}\n')
  writeFileSync(join(directory, 'dsh-wechat-bridge.mjs'), bridge)
}

test('Node runtime guard rejects unsupported versions before installation work', () => {
  assert.throws(() => requireSupportedNode('21.7.3'), /Node\.js 22 or newer/)
  assert.throws(() => requireSupportedNode('invalid'), /current: invalid/)
  assert.equal(requireSupportedNode('22.0.0'), 22)
  assert.equal(requireSupportedNode('24.1.0'), 24)
})

test('selected launchd Node is executable and version 22+ before writes or launchctl', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-selected-node-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const runtime = join(root, 'runtime')
  const credentials = join(root, 'credentials')
  const plist = join(root, 'agent.plist')
  const selectedNode = join(root, 'selected-node')
  mkdirSync(source)
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeRuntime(runtime)
  mkdirSync(join(runtime, 'node_modules'))
  writeFileSync(join(runtime, 'node_modules', 'old-dependency'), 'old dependency')
  mkdirSync(credentials)
  markCredentialDirectory(credentials)
  const token = join(credentials, 'bridge-token')
  const owner = join(credentials, 'owner.json')
  writeFileSync(token, 'old-token\n')
  writeFileSync(owner, '{"userId":"old-owner"}\n')
  writeFileSync(plist, 'old plist')
  writeFileSync(selectedNode, '#!/bin/sh\n')
  chmodSync(selectedNode, 0o755)
  let dependencyCalls = 0
  let privateWrites = 0
  let launchCalls = 0
  const install = (nodeBin, runNodeVersion) => installWechatService({
    selectedNodeBin: nodeBin,
    runNodeVersion,
    uid: 501,
    plistDst: plist,
    runLaunchctl: () => { launchCalls += 1 },
    prepareOptions: {
      source,
      destination: runtime,
      credDir: credentials,
      tokenFile: token,
      environment: {},
      configuredToken: 'new-token',
      configuredOwner: 'new-owner',
      installDependencies: () => { dependencyCalls += 1 },
      writePrivate: () => { privateWrites += 1 },
    },
  })

  assert.throws(() => install(selectedNode, () => 'v20.19.4'), /selected Node executable is unsupported/)
  assert.throws(() => install(join(root, 'missing-node'), () => 'v22.0.0'), /unavailable/)
  assert.equal(validateNodeBinary(selectedNode, { runVersion: () => 'v22.0.0' }), realpathSync(selectedNode))
  assert.equal(dependencyCalls, 0)
  assert.equal(privateWrites, 0)
  assert.equal(launchCalls, 0)
  assert.equal(readFileSync(join(runtime, 'dsh-wechat-bridge.mjs'), 'utf8'), 'old bridge')
  assert.equal(readFileSync(join(runtime, 'node_modules', 'old-dependency'), 'utf8'), 'old dependency')
  assert.equal(readFileSync(token, 'utf8'), 'old-token\n')
  assert.equal(readFileSync(owner, 'utf8'), '{"userId":"old-owner"}\n')
  assert.equal(readFileSync(plist, 'utf8'), 'old plist')
  assert.deepEqual(readdirSync(root).filter((name) => /\.(staging|backup|rollback)-/.test(name)), [])
})

test('QR login userId binds the sole owner, explicit owner migrates, and legacy owner state is not trusted', () => {
  const saved = credentialsFromLogin({
    accountId: 'account-id',
    botToken: 'bot-token',
    baseUrl: 'https://ilink.example',
    userId: ' scan-owner ',
  })
  assert.deepEqual(saved, {
    accountId: 'account-id',
    token: 'bot-token',
    baseUrl: 'https://ilink.example',
    userId: 'scan-owner',
  })
  assert.equal(requireOwner(saved, 'configured-owner'), 'scan-owner')
  assert.equal(requireOwner({}, 'configured-owner'), 'configured-owner')
  assert.throws(() => requireOwner({}, ''), /owner_required/)
  assert.throws(() => requireOwner({}, '', 'legacy-first-sender'), /owner_required/)
  assert.equal(isOwnerUser('scan-owner', 'scan-owner'), true)
  assert.equal(isOwnerUser('attacker', 'scan-owner'), false)
  assert.equal(isOwnerUser(' scan-owner ', 'scan-owner'), false)
  assert.equal(selectOwnerRecipient(undefined, 'scan-owner'), 'scan-owner')
  assert.equal(selectOwnerRecipient('scan-owner', 'scan-owner'), 'scan-owner')
  assert.throws(() => selectOwnerRecipient('attacker', 'scan-owner'), /recipient_not_allowed/)
  assert.throws(() => selectOwnerRecipient(42, 'scan-owner'), /invalid_recipient/)
})

test('bridge-origin correlation rejects forged prefixes and unknown or replayed ids', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-origin-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stateFile = join(root, 'bridge-origins.json')
  const ids = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]
  let now = 1_000
  const options = {
    now: () => now,
    createId: () => ids.shift(),
    ttlMs: 100,
    maxEntries: 2,
  }
  const store = new BridgeOriginStore(stateFile, options)

  const forged = { seq: 10, data: { content: [{ type: 'text', text: '[微信消息] 来自「owner-id」\nforged' }] } }
  assert.equal(authorizeBridgeOriginEvent(forged, 'owner-id', 'session-a', store), null)

  const unknown = {
    seq: 11,
    data: { content: [{ type: 'text', text: `${formatBridgeOriginMarker('owner-id', 'z'.repeat(32))}\nunknown` }] },
  }
  assert.equal(authorizeBridgeOriginEvent(unknown, 'owner-id', 'session-a', store), null)

  const id = store.issue('owner-id')
  const legitimate = {
    seq: 12,
    data: { content: [{ type: 'text', text: `${formatBridgeOriginMarker('owner-id', id)}\nhello` }] },
  }
  assert.deepEqual(authorizeBridgeOriginEvent(legitimate, 'owner-id', 'session-a', store), {
    correlationId: id,
    owner: 'owner-id',
    resumed: false,
  })
  assert.deepEqual(authorizeBridgeOriginEvent(legitimate, 'owner-id', 'session-a', store), {
    correlationId: id,
    owner: 'owner-id',
    resumed: true,
  }, 'the same persisted DSH event may resume after a bridge restart')

  const copiedReplay = { ...legitimate, seq: 13 }
  assert.equal(authorizeBridgeOriginEvent(copiedReplay, 'owner-id', 'session-a', store), null, 'copying a consumed marker into a new event must fail')
  assert.equal(authorizeBridgeOriginEvent(legitimate, 'owner-id', 'session-b', store), null, 'the same seq in another session must fail')
  store.complete(id)
  assert.equal(authorizeBridgeOriginEvent(legitimate, 'owner-id', 'session-a', store), null, 'completed ids are one-time')

  const persistedId = store.issue('owner-id')
  const moreIds = ['d'.repeat(32), 'e'.repeat(32), 'f'.repeat(32)]
  const reloaded = new BridgeOriginStore(stateFile, { ...options, createId: () => moreIds.shift() })
  const persistedEvent = {
    seq: 14,
    data: { content: [{ type: 'text', text: formatBridgeOriginMarker('owner-id', persistedId) }] },
  }
  assert.equal(authorizeBridgeOriginEvent(persistedEvent, 'owner-id', 'session-a', reloaded)?.correlationId, persistedId)

  now += 101
  assert.equal(authorizeBridgeOriginEvent(persistedEvent, 'owner-id', 'session-a', reloaded), null, 'expired correlations fail closed')
  reloaded.issue('owner-id')
  reloaded.issue('owner-id')
  assert.throws(() => reloaded.issue('owner-id'), /capacity_exceeded/, 'the persistent set is bounded')
})

test('a failed DSH prompt revokes its bridge-origin correlation', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-origin-revoke-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const id = 'r'.repeat(32)
  const store = new BridgeOriginStore(join(root, 'origins.json'), { createId: () => id })
  let marker

  await assert.rejects(
    queueBridgeOriginPrompt({
      store,
      owner: 'owner-id',
      submit: async (issued) => {
        marker = issued.marker
        throw new Error('prompt failed')
      },
    }),
    /prompt failed/,
  )

  const event = { seq: 20, data: { content: [{ type: 'text', text: marker }] } }
  assert.equal(authorizeBridgeOriginEvent(event, 'owner-id', 'session-a', store), null)
})

test('media send failure rejects the forwarding turn and does not commit its waterline', async () => {
  const state = {
    pending: {
      correlationId: 'origin-id',
      from: 'owner-id',
      text: 'reply',
      files: [{ kind: 'file', path: '/already-validated/report.pdf' }],
      rejectedFiles: 0,
    },
    lastFlushedSeq: 42,
  }
  let completed = false
  let persistedWater = null

  await assert.rejects(
    finishForwardingTurn({
      state,
      shouldSend: true,
      seq: 99,
      sendPending: (value) => sendPendingReply(value, {
        client: {
          sendText: async () => {},
          sendMedia: async () => { throw new Error('media transport failed') },
        },
        resolveToken: () => 'context-token',
        resolveFile: (path) => path,
        log: () => {},
      }),
      completeOrigin: () => { completed = true },
      persistWater: (value) => { persistedWater = value },
    }),
    /media transport failed/,
  )

  assert.equal(completed, false)
  assert.equal(persistedWater, null)
  assert.equal(state.lastFlushedSeq, 42)
  assert.equal(state.pending.correlationId, 'origin-id')
  assert.equal(state.pending.blockedSeq, 99)

  await assert.rejects(
    finishForwardingTurn({
      state,
      shouldSend: true,
      seq: 120,
      sendPending: (value) => sendPendingReply(value, {
        client: {
          sendText: async () => {},
          sendMedia: async () => { throw new Error('still failing') },
        },
        resolveToken: () => 'context-token',
        resolveFile: (path) => path,
        log: () => {},
      }),
      completeOrigin: () => { completed = true },
      persistWater: (value) => { persistedWater = value },
    }),
    /still failing/,
  )
  assert.equal(state.lastFlushedSeq, 42, 'a later ordinary turn cannot skip the failed turn')
  assert.equal(state.pending.correlationId, 'origin-id')
  assert.equal(state.pending.blockedSeq, 99, 'the original failed turn remains the blocker')
})

test('waterline persistence failure keeps the correlation and pending turn retryable', async () => {
  const state = {
    pending: {
      correlationId: 'origin-id',
      from: 'owner-id',
      text: 'reply',
      files: [],
      rejectedFiles: 0,
    },
    lastFlushedSeq: 7,
  }
  let completed = false
  let sends = 0

  await assert.rejects(
    finishForwardingTurn({
      state,
      shouldSend: true,
      seq: 8,
      sendPending: async () => { sends += 1 },
      completeOrigin: () => { completed = true },
      persistWater: () => { throw new Error('disk full') },
    }),
    /disk full/,
  )

  assert.equal(sends, 1)
  assert.equal(completed, false)
  assert.equal(state.lastFlushedSeq, 7)
  assert.equal(state.pending.correlationId, 'origin-id')
  assert.equal(state.pending.blockedSeq, 8)
})

test('a successful owner reply persists water before consuming its origin', async () => {
  const state = {
    pending: { correlationId: 'origin-id', from: 'owner-id', text: 'ok', files: [], rejectedFiles: 0 },
    lastFlushedSeq: 7,
  }
  const order = []
  await finishForwardingTurn({
    state,
    shouldSend: true,
    seq: 8,
    sendPending: async () => { order.push('send') },
    persistWater: () => { order.push('persist') },
    completeOrigin: () => { order.push('complete') },
  })
  assert.deepEqual(order, ['send', 'persist', 'complete'])
  assert.equal(state.lastFlushedSeq, 8)
  assert.equal(state.pending, null)
})

test('history recovery reads beyond 300 events before processing or advancing its waterline', async () => {
  const history = Array.from({ length: 450 }, (_, index) => ({ seq: index + 1, type: 'turn/end' }))
  let pageCalls = 0
  const fetchPage = async ({ maxMessages, beforeSeq }) => {
    pageCalls += 1
    const eligible = beforeSeq == null ? history : history.filter((event) => event.seq < beforeSeq)
    const events = eligible.slice(-maxMessages)
    return {
      events: events.map((event) => ({ event })),
      hasMore: eligible.length > events.length,
    }
  }

  const recovered = await fetchHistoryThroughWaterline({ fetchPage, lastFlushedSeq: 50 })
  assert.equal(pageCalls, 5)
  assert.equal(recovered[0].seq, 1)
  assert.equal(recovered.at(-1).seq, 450)
  assert.equal(recovered.filter((event) => event.seq > 50).length, 400)

  let processed = 0
  let waterline = 50
  await assert.rejects(
    async () => {
      const batch = await fetchHistoryThroughWaterline({ fetchPage, lastFlushedSeq: waterline, maxPages: 3 })
      for (const event of batch) {
        processed += 1
        waterline = event.seq
      }
    },
    /pagination limit reached/,
  )
  assert.equal(processed, 0, 'an incomplete history batch must not be partially processed')
  assert.equal(waterline, 50)
})

test('local HTTP authentication fails closed and accepts only the exact bearer token', () => {
  assert.equal(isBearerAuthorized(undefined, 'secret'), false)
  assert.equal(isBearerAuthorized('Bearer wrong', 'secret'), false)
  assert.equal(isBearerAuthorized('secret', 'secret'), false)
  assert.equal(isBearerAuthorized('Bearer secret', ''), false)
  assert.equal(isBearerAuthorized('Bearer secret', 'secret'), true)
})

test('real HTTP routes require token, restrict recipient to owner, and send a valid file from any directory', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-http-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'report.txt')
  writeFileSync(file, 'report')
  const calls = []
  const client = {
    getAccountId: () => 'account-id',
    sendText: async (...args) => calls.push(['text', ...args]),
    sendMedia: async (...args) => calls.push(['media', ...args]),
  }
  const server = createServer(createBridgeRequestHandler({
    token: 'bridge-secret',
    client,
    getOwner: () => 'owner-id',
    resolveToken: () => 'context-token',
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}`
  const auth = { Authorization: 'Bearer bridge-secret', 'Content-Type': 'application/json' }

  assert.equal((await fetch(`${url}/health`)).status, 401)
  assert.equal((await fetch(`${url}/health`, { headers: { Authorization: 'Bearer bridge-secret' } })).status, 200)

  const unauthorized = await fetch(`${url}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'must not send' }),
  })
  assert.equal(unauthorized.status, 401)
  assert.equal(calls.length, 0)

  const wrongRecipient = await fetch(`${url}/send`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ to: 'attacker', text: 'must not send' }),
  })
  assert.equal(wrongRecipient.status, 403)
  assert.equal(calls.length, 0)

  const validText = await fetch(`${url}/send`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ text: 'hello owner' }),
  })
  assert.equal(validText.status, 200)
  assert.deepEqual(calls.shift(), ['text', 'owner-id', 'hello owner', 'context-token'])

  const validFile = await fetch(`${url}/send`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ to: 'owner-id', file }),
  })
  assert.equal(validFile.status, 200)
  assert.deepEqual(calls.shift(), ['media', 'owner-id', realpathSync(file), undefined, 'context-token'])

  const relativeFile = await fetch(`${url}/send`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ file: 'relative.txt' }),
  })
  assert.equal(relativeFile.status, 400)
  assert.equal(calls.length, 0)
})

test('any existing absolute regular file is valid, while relative, missing, and directory paths are rejected', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-files-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const first = join(root, 'first')
  const second = join(root, 'second')
  mkdirSync(first)
  mkdirSync(second)
  const fileA = join(first, 'a.txt')
  const fileB = join(second, 'b.txt')
  writeFileSync(fileA, 'a')
  writeFileSync(fileB, 'b')
  const link = join(first, 'link-to-b')
  symlinkSync(fileB, link)

  assert.equal(resolveLocalFile(fileA), realpathSync(fileA))
  assert.equal(resolveLocalFile(fileB), realpathSync(fileB))
  assert.equal(resolveLocalFile(link), realpathSync(fileB))
  assert.throws(() => resolveLocalFile('relative.txt'), /file_must_be_an_absolute_path/)
  assert.throws(() => resolveLocalFile(join(root, 'missing')), /file_not_found/)
  assert.throws(() => resolveLocalFile(first), /file_not_regular/)
})

test('credential migration and new secret files enforce 0700 directories and 0600 files', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'dsh-wechat-perms-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const root = join(parent, 'credentials')
  const nested = join(root, 'media')
  const state = join(nested, 'state.json')
  const outside = join(parent, 'outside.txt')
  mkdirSync(nested, { recursive: true, mode: 0o777 })
  writeFileSync(state, '{}', { mode: 0o666 })
  writeFileSync(outside, 'outside', { mode: 0o644 })
  chmodSync(root, 0o777)
  chmodSync(nested, 0o777)
  chmodSync(state, 0o666)
  chmodSync(outside, 0o644)
  symlinkSync(outside, join(root, 'outside-link'))

  hardenPrivateTree(root)
  assert.equal(mode(root), 0o700)
  assert.equal(mode(nested), 0o700)
  assert.equal(mode(state), 0o600)
  assert.equal(mode(outside), 0o644, 'credential migration must not follow symlinks')

  const tokenFile = join(root, 'bridge-token')
  const first = loadOrCreateSecret(tokenFile, undefined, 16)
  assert.equal(first.length > 16, true)
  assert.equal(mode(tokenFile), 0o600)
  assert.equal(loadOrCreateSecret(tokenFile), first)
  assert.equal(readFileSync(tokenFile, 'utf8').trim(), first)

  const linkedToken = join(root, 'linked-token')
  writeFileSync(outside, 'must-not-be-used-as-token')
  symlinkSync(outside, linkedToken)
  const replacement = loadOrCreateSecret(linkedToken, undefined, 16)
  assert.notEqual(replacement, 'must-not-be-used-as-token')
  assert.equal(readFileSync(outside, 'utf8'), 'must-not-be-used-as-token')
  assert.equal(mode(linkedToken), 0o600)
})

test('credential startup rejects HOME, protected paths, and unrelated custom directories before mutation', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-credential-targets-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fakeHome = join(root, 'home')
  const runtime = join(root, 'runtime')
  const valuable = join(root, 'valuable-documents')
  mkdirSync(fakeHome)
  mkdirSync(runtime)
  mkdirSync(valuable)
  writeFileSync(join(fakeHome, 'home.txt'), 'home')
  writeFileSync(join(valuable, 'report.txt'), 'valuable')
  chmodSync(fakeHome, 0o755)
  chmodSync(valuable, 0o755)
  let hardenCalls = 0
  let writeCalls = 0
  const options = {
    home: fakeHome,
    harden: () => { hardenCalls += 1 },
    write: () => { writeCalls += 1 },
  }

  assert.throws(() => prepareWechatCredentialState(fakeHome, options), /unsafe WeChat credential directory/)
  assert.throws(
    () => prepareWechatCredentialState(runtime, { ...options, protectedPaths: [runtime] }),
    /overlaps a protected path/,
  )
  assert.throws(() => prepareWechatCredentialState(valuable, options), /unknown entries|not recognizable dsh-wechat state/)
  assert.equal(hardenCalls, 0)
  assert.equal(writeCalls, 0)
  assert.equal(mode(fakeHome), 0o755)
  assert.equal(mode(valuable), 0o755)
  assert.equal(readFileSync(join(valuable, 'report.txt'), 'utf8'), 'valuable')
})

test('custom credential directories require a valid marker and reject unknown top-level entries', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-credential-marker-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const legacy = join(root, 'legacy')
  mkdirSync(legacy)
  writeFileSync(join(legacy, 'credentials.json'), '{"accountId":"account","token":"secret"}')
  assert.throws(() => validateWechatCredentialDirectory(legacy, { home: root }), /not recognizable/)
  assert.equal(validateWechatCredentialDirectory(legacy, { home: root, allowLegacy: true }), realpathSync(legacy))

  markCredentialDirectory(legacy)
  writeFileSync(join(legacy, 'unrelated-document.txt'), 'do not touch')
  assert.throws(
    () => validateWechatCredentialDirectory(legacy, { home: root }),
    /unknown entries: unrelated-document\.txt/,
  )
})

test('private atomic write removes its temporary file when rename fails', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-atomic-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const targetDirectory = join(root, 'target')
  mkdirSync(targetDirectory)

  assert.throws(() => writePrivateFile(targetDirectory, 'cannot replace a directory'))
  assert.deepEqual(readdirSync(root), ['target'])
})

test('generated launchd plist persists private config, escapes values, and uses umask 077', () => {
  const plist = buildPlist({
    nodeBin: '/node&bin',
    dest: '/runtime<dir>',
    logDir: '/private/logs',
    environment: {
      WECHAT_CRED_DIR: '/private/credentials',
      WECHAT_BRIDGE_TOKEN_FILE: '/private/credentials/bridge-token',
      WECHAT_OWNER: 'owner&id',
    },
  })
  assert.match(plist, /<key>Umask<\/key>\s*<integer>63<\/integer>/)
  assert.match(plist, /WECHAT_BRIDGE_TOKEN_FILE/)
  assert.match(plist, /owner&amp;id/)
  assert.match(plist, /\/node&amp;bin/)
})

test('installer rejects HOME, source overlap, and an unrelated non-empty runtime with zero deployment work', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-destructive-targets-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fakeHome = join(root, 'home')
  const source = join(root, 'source')
  const credentials = join(root, 'credentials')
  const valuable = join(root, 'valuable-documents')
  mkdirSync(fakeHome)
  mkdirSync(source)
  mkdirSync(credentials)
  mkdirSync(valuable)
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeFileSync(join(valuable, 'tax-records.txt'), 'must survive')
  writeFileSync(join(fakeHome, 'home-records.txt'), 'must survive')
  chmodSync(valuable, 0o755)
  chmodSync(fakeHome, 0o755)
  let installs = 0
  const attempt = (destination) => prepareWechatInstallation({
    source,
    destination,
    credDir: credentials,
    tokenFile: join(credentials, 'bridge-token'),
    plistDst: join(root, 'agent.plist'),
    nodeBin: '/fake/node',
    environment: {},
    home: fakeHome,
    installDependencies: () => { installs += 1 },
  })

  assert.throws(() => attempt(valuable), /runtime package manifest|not a dsh-wechat runtime/)
  assert.throws(() => attempt(join(source, 'nested-runtime')), /overlaps the package source/)
  assert.throws(() => attempt(fakeHome), /unsafe runtime destination/)
  assert.throws(
    () => validateInstallationLayout({
      source,
      destination: '/',
      credDir: credentials,
      tokenFile: join(credentials, 'bridge-token'),
      plistDst: join(root, 'agent.plist'),
      home: fakeHome,
    }),
    /unsafe runtime destination/,
  )
  assert.equal(installs, 0)
  assert.equal(mode(valuable), 0o755)
  assert.equal(mode(fakeHome), 0o755)
  assert.equal(readFileSync(join(valuable, 'tax-records.txt'), 'utf8'), 'must survive')
  assert.equal(readFileSync(join(fakeHome, 'home-records.txt'), 'utf8'), 'must survive')
  assert.deepEqual(readdirSync(root).filter((name) => /\.(staging|backup|rollback)-/.test(name)), [])
})

test('installer canonical path gate rejects runtime/state overlap, external tokens, and intermediate aliases before writes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-layout-alias-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const runtime = join(root, 'runtime')
  const credentials = join(root, 'credentials')
  const outside = join(root, 'outside')
  mkdirSync(source)
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeRuntime(runtime)
  mkdirSync(credentials)
  markCredentialDirectory(credentials)
  mkdirSync(outside)
  const outsideToken = join(outside, 'shared-token')
  writeFileSync(outsideToken, 'outside token')
  let installs = 0
  let privateWrites = 0
  const options = {
    source,
    destination: runtime,
    credDir: credentials,
    tokenFile: join(credentials, 'bridge-token'),
    plistDst: join(root, 'agent.plist'),
    nodeBin: '/fake/node',
    environment: {},
    installDependencies: () => { installs += 1 },
    writePrivate: () => { privateWrites += 1 },
  }

  assert.throws(
    () => prepareWechatInstallation({ ...options, tokenFile: outsideToken }),
    /token file must be exactly/,
  )

  const nestedCredentials = join(runtime, 'credentials')
  mkdirSync(nestedCredentials)
  markCredentialDirectory(nestedCredentials)
  writeFileSync(join(nestedCredentials, 'bridge-token'), 'old token')
  assert.throws(
    () => prepareWechatInstallation({
      ...options,
      credDir: nestedCredentials,
      tokenFile: join(nestedCredentials, 'bridge-token'),
    }),
    /runtime destination overlaps credential directory|overlaps a protected path/,
  )

  const media = join(credentials, 'media')
  const real = join(media, 'real', 'sub')
  mkdirSync(real, { recursive: true })
  symlinkSync(join(media, 'real'), join(media, 'alias'))
  const aliasedToken = join(media, 'alias', 'sub', 'shared')
  const canonicalPlist = join(real, 'shared')
  assert.equal(canonicalizeWithExistingAncestor(aliasedToken), canonicalizeWithExistingAncestor(canonicalPlist))
  assert.throws(
    () => prepareWechatInstallation({ ...options, tokenFile: aliasedToken, plistDst: canonicalPlist }),
    /token file must be exactly|overlap/,
  )

  assert.equal(installs, 0)
  assert.equal(privateWrites, 0)
  assert.equal(readFileSync(outsideToken, 'utf8'), 'outside token')
  assert.equal(readFileSync(join(nestedCredentials, 'bridge-token'), 'utf8'), 'old token')
  assert.equal(existsSync(canonicalPlist), false)
  assert.deepEqual(readdirSync(root).filter((name) => /\.(staging|backup|rollback)-/.test(name)), [])
})

test('credentials.json cannot be selected as the bridge token file and remains untouched', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-token-state-collision-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const runtime = join(root, 'runtime')
  const credentials = join(root, 'credentials')
  const credentialFile = join(credentials, 'credentials.json')
  const plist = join(root, 'agent.plist')
  mkdirSync(source)
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeRuntime(runtime)
  mkdirSync(credentials)
  markCredentialDirectory(credentials)
  const savedCredentials = '{"accountId":"account","token":"login-token","userId":"owner"}\n'
  writeFileSync(credentialFile, savedCredentials, { mode: 0o600 })
  let installs = 0
  let privateWrites = 0

  assert.throws(
    () => prepareWechatInstallation({
      source,
      destination: runtime,
      credDir: credentials,
      tokenFile: credentialFile,
      plistDst: plist,
      nodeBin: '/fake/node',
      environment: {},
      configuredToken: 'replacement-token',
      installDependencies: () => { installs += 1 },
      writePrivate: () => { privateWrites += 1 },
    }),
    /token file must be exactly/,
  )

  assert.equal(installs, 0)
  assert.equal(privateWrites, 0)
  assert.equal(readFileSync(credentialFile, 'utf8'), savedCredentials)
  assert.equal(readFileSync(join(runtime, 'dsh-wechat-bridge.mjs'), 'utf8'), 'old bridge')
  assert.equal(existsSync(plist), false)
  assert.deepEqual(readdirSync(root).filter((name) => /\.(staging|backup|rollback)-/.test(name)), [])
})

test('failed staged npm install preserves the old runtime, token, owner, and plist', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-deploy-failure-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const runtime = join(root, 'runtime')
  const credentials = join(root, 'credentials')
  const plist = join(root, 'com.dsh.wechatbridge.plist')
  mkdirSync(source)
  writeRuntime(runtime)
  mkdirSync(join(runtime, 'node_modules'))
  mkdirSync(credentials)
  markCredentialDirectory(credentials)
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'package-lock.json'), '{}')
  writeFileSync(join(runtime, 'old-only'), 'remove me')
  writeFileSync(join(runtime, 'node_modules', 'old-dependency'), 'old dependency')
  const token = join(credentials, 'bridge-token')
  const owner = join(credentials, 'owner.json')
  writeFileSync(token, 'old-token\n')
  writeFileSync(owner, '{"userId":"old-owner"}\n')
  writeFileSync(plist, 'old plist')

  assert.throws(
    () => prepareWechatInstallation({
      source,
      destination: runtime,
      credDir: credentials,
      tokenFile: token,
      plistDst: plist,
      nodeBin: '/fake/node',
      environment: {
        WECHAT_CRED_DIR: credentials,
        WECHAT_BRIDGE_TOKEN_FILE: token,
        WECHAT_OWNER: 'new-owner',
      },
      configuredToken: 'new-token',
      configuredOwner: 'new-owner',
      installDependencies: () => { throw new Error('npm ci failed') },
    }),
    /npm ci failed/,
  )

  assert.equal(readFileSync(join(runtime, 'dsh-wechat-bridge.mjs'), 'utf8'), 'old bridge')
  assert.equal(readFileSync(join(runtime, 'node_modules', 'old-dependency'), 'utf8'), 'old dependency')
  assert.equal(readFileSync(token, 'utf8'), 'old-token\n')
  assert.equal(readFileSync(owner, 'utf8'), '{"userId":"old-owner"}\n')
  assert.equal(readFileSync(plist, 'utf8'), 'old plist')
  assert.deepEqual(
    readdirSync(root).filter((name) => name.includes('.staging-') || name.includes('.backup-')),
    [],
  )
})

test('post-install plist failure rolls back runtime and every private state change', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-prepare-rollback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const runtime = join(root, 'runtime')
  const credentials = join(root, 'credentials')
  const plist = join(root, 'com.dsh.wechatbridge.plist')
  mkdirSync(source)
  writeRuntime(runtime)
  mkdirSync(join(runtime, 'node_modules'))
  mkdirSync(credentials)
  markCredentialDirectory(credentials)
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'package-lock.json'), '{}')
  writeFileSync(join(runtime, 'node_modules', 'old-dependency'), 'old dependency')
  const token = join(credentials, 'bridge-token')
  const owner = join(credentials, 'owner.json')
  writeFileSync(token, 'old-token\n', { mode: 0o600 })
  writeFileSync(owner, '{"userId":"old-owner"}\n', { mode: 0o600 })
  writeFileSync(plist, 'old plist', { mode: 0o600 })

  assert.throws(
    () => prepareWechatInstallation({
      source,
      destination: runtime,
      credDir: credentials,
      tokenFile: token,
      plistDst: plist,
      nodeBin: '/fake/node',
      environment: {
        WECHAT_CRED_DIR: credentials,
        WECHAT_BRIDGE_TOKEN_FILE: token,
        WECHAT_OWNER: 'new-owner',
      },
      configuredToken: 'new-token',
      configuredOwner: 'new-owner',
      installDependencies: (staging) => {
        mkdirSync(join(staging, 'node_modules'))
        writeFileSync(join(staging, 'node_modules', 'new-dependency'), 'new dependency')
      },
      writePrivate: (file, data) => {
        if (canonicalizeWithExistingAncestor(file) === canonicalizeWithExistingAncestor(plist)) {
          throw new Error('injected plist failure')
        }
        writePrivateFile(file, data)
      },
    }),
    /injected plist failure/,
  )

  assert.equal(readFileSync(join(runtime, 'dsh-wechat-bridge.mjs'), 'utf8'), 'old bridge')
  assert.equal(readFileSync(join(runtime, 'node_modules', 'old-dependency'), 'utf8'), 'old dependency')
  assert.equal(readFileSync(token, 'utf8'), 'old-token\n')
  assert.equal(readFileSync(owner, 'utf8'), '{"userId":"old-owner"}\n')
  assert.equal(readFileSync(plist, 'utf8'), 'old plist')
  assert.equal(existsSync(join(credentials, 'bridge.out.log')), false)
  assert.equal(existsSync(join(credentials, 'bridge.err.log')), false)
  assert.deepEqual(
    readdirSync(root).filter((name) => /\.(staging|backup|rollback)-/.test(name)),
    [],
  )
})

test('launchd activation failure restores the old transaction and restarts the old service', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-launchd-rollback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const runtime = join(root, 'runtime')
  const credentials = join(root, 'credentials')
  const plist = join(root, 'com.dsh.wechatbridge.plist')
  mkdirSync(source)
  writeRuntime(runtime)
  mkdirSync(join(runtime, 'node_modules'))
  mkdirSync(credentials)
  markCredentialDirectory(credentials)
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'package-lock.json'), '{}')
  writeFileSync(join(runtime, 'node_modules', 'old-dependency'), 'old dependency')
  const token = join(credentials, 'bridge-token')
  const owner = join(credentials, 'owner.json')
  writeFileSync(token, 'old-token\n', { mode: 0o600 })
  writeFileSync(owner, '{"userId":"old-owner"}\n', { mode: 0o600 })
  writeFileSync(plist, 'old plist', { mode: 0o600 })

  const installation = prepareWechatInstallation({
    source,
    destination: runtime,
    credDir: credentials,
    tokenFile: token,
    plistDst: plist,
    nodeBin: '/fake/node',
    environment: {
      WECHAT_CRED_DIR: credentials,
      WECHAT_BRIDGE_TOKEN_FILE: token,
      WECHAT_OWNER: 'new-owner',
    },
    configuredToken: 'new-token',
    configuredOwner: 'new-owner',
    installDependencies: (staging) => {
      mkdirSync(join(staging, 'node_modules'))
      writeFileSync(join(staging, 'node_modules', 'new-dependency'), 'new dependency')
    },
    deferCommit: true,
  })

  const calls = []
  let bootstrapAttempts = 0
  let bootoutAttempts = 0
  const runLaunchctl = (args) => {
    calls.push(args[0])
    if (args[0] === 'bootout') {
      bootoutAttempts += 1
      if (bootoutAttempts > 1) throw new Error('job not loaded')
      return
    }
    if (args[0] === 'bootstrap') {
      bootstrapAttempts += 1
      if (bootstrapAttempts === 1) throw new Error('new bootstrap failed')
      return
    }
    if (args[0] === 'load') throw new Error('new load failed')
  }

  assert.throws(
    () => activatePreparedInstallation({
      installation,
      running: true,
      uid: 501,
      plistDst: plist,
      runLaunchctl,
    }),
    /launchd could not load/,
  )

  assert.deepEqual(calls, ['bootout', 'bootstrap', 'load', 'bootout', 'bootstrap'])
  assert.equal(readFileSync(join(runtime, 'dsh-wechat-bridge.mjs'), 'utf8'), 'old bridge')
  assert.equal(readFileSync(join(runtime, 'node_modules', 'old-dependency'), 'utf8'), 'old dependency')
  assert.equal(readFileSync(token, 'utf8'), 'old-token\n')
  assert.equal(readFileSync(owner, 'utf8'), '{"userId":"old-owner"}\n')
  assert.equal(readFileSync(plist, 'utf8'), 'old plist')
  assert.equal(existsSync(join(credentials, 'bridge.out.log')), false)
  assert.equal(existsSync(join(credentials, 'bridge.err.log')), false)
  assert.deepEqual(
    readdirSync(root).filter((name) => /\.(staging|backup|rollback)-/.test(name)),
    [],
  )
})

test('nested credential rollback removes created parents and still restores the old service after cleanup errors', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-nested-credential-rollback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const runtime = join(root, 'runtime')
  const credentials = join(root, 'state', 'nested', 'fresh-credentials')
  const token = join(credentials, 'bridge-token')
  const plist = join(root, 'agent.plist')
  mkdirSync(source)
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeRuntime(runtime)
  mkdirSync(join(runtime, 'node_modules'))
  writeFileSync(join(runtime, 'node_modules', 'old-dependency'), 'old dependency')
  writeFileSync(plist, 'old plist')

  const installation = prepareWechatInstallation({
    source,
    destination: runtime,
    credDir: credentials,
    tokenFile: token,
    plistDst: plist,
    nodeBin: '/fake/node',
    environment: {},
    configuredToken: 'new-token',
    configuredOwner: 'new-owner',
    installDependencies: (staging) => {
      mkdirSync(join(staging, 'node_modules'))
      writeFileSync(join(staging, 'node_modules', 'new-dependency'), 'new dependency')
    },
    deferCommit: true,
  })
  assert.equal(existsSync(token), true)

  const calls = []
  let bootouts = 0
  let bootstraps = 0
  const runLaunchctl = (args) => {
    calls.push(args[0])
    if (args[0] === 'bootout') {
      bootouts += 1
      if (bootouts > 1) throw new Error('cleanup job already absent')
      return
    }
    if (args[0] === 'bootstrap') {
      bootstraps += 1
      if (bootstraps === 1) throw new Error('new bootstrap failed')
      return
    }
    if (args[0] === 'load') throw new Error('new load failed')
  }

  assert.throws(
    () => activatePreparedInstallation({
      installation,
      running: true,
      uid: 501,
      plistDst: plist,
      runLaunchctl,
    }),
    /recovery reported additional errors/,
  )
  assert.deepEqual(calls, ['bootout', 'bootstrap', 'load', 'bootout', 'bootstrap'])
  assert.equal(readFileSync(join(runtime, 'dsh-wechat-bridge.mjs'), 'utf8'), 'old bridge')
  assert.equal(readFileSync(join(runtime, 'node_modules', 'old-dependency'), 'utf8'), 'old dependency')
  assert.equal(readFileSync(plist, 'utf8'), 'old plist')
  assert.equal(existsSync(token), false)
  assert.equal(existsSync(join(credentials, 'owner.json')), false)
  assert.equal(existsSync(credentials), false, 'all transaction-created empty parents are removed')
  assert.equal(existsSync(join(root, 'state')), false, 'created ancestor directories are removed deepest-first')
  assert.deepEqual(readdirSync(root).filter((name) => /\.(staging|backup|rollback)-/.test(name)), [])
})

test('successful staged install atomically replaces the runtime only after dependencies are ready', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-deploy-success-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const runtime = join(root, 'runtime')
  mkdirSync(source)
  writeRuntime(runtime)
  writeFileSync(join(source, 'dsh-wechat-bridge.mjs'), 'new bridge')
  writeFileSync(join(source, 'package.json'), '{"name":"dsh-wechat"}')
  writeFileSync(join(source, 'package-lock.json'), '{}')
  writeFileSync(join(runtime, 'old-only'), 'remove me')

  deployRuntimeAtomically({
    source,
    destination: runtime,
    installDependencies: (staging) => {
      mkdirSync(join(staging, 'node_modules'))
      writeFileSync(join(staging, 'node_modules', 'new-dependency'), 'ready')
      assert.equal(readFileSync(join(runtime, 'dsh-wechat-bridge.mjs'), 'utf8'), 'old bridge')
    },
  })

  assert.equal(readFileSync(join(runtime, 'dsh-wechat-bridge.mjs'), 'utf8'), 'new bridge')
  assert.equal(readFileSync(join(runtime, 'node_modules', 'new-dependency'), 'utf8'), 'ready')
  assert.equal(existsSync(join(runtime, 'old-only')), false)
  assert.deepEqual(
    readdirSync(root).filter((name) => name.includes('.staging-') || name.includes('.backup-')),
    [],
  )
})

test('npm bin symlinks still execute the installer main module', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wechat-bin-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modulePath = join(root, 'install.mjs')
  const linkPath = join(root, 'dsh-plugins-wechat')
  const otherPath = join(root, 'other.mjs')
  writeFileSync(modulePath, '')
  writeFileSync(otherPath, '')
  symlinkSync(modulePath, linkPath)

  assert.equal(isMainModule(modulePath, modulePath), true)
  assert.equal(isMainModule(linkPath, modulePath), true)
  assert.equal(isMainModule(otherPath, modulePath), false)
})
