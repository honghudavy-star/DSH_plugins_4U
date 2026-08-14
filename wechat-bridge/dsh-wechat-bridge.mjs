#!/usr/bin/env node
// dsh-wechat-bridge.mjs — 微信(官方 iLink) ⇄ DSH 桥接器 v3
//
// 功能:
//   1. 文本收发: 微信消息注入 DSH「微信」会话（GUI 原生显示），agent 回复发回微信
//   2. 图片/文件收发:
//      - 收: 微信发来的图片/文件自动下载; 图片以 base64 注入 prompt(GUI 可见、agent 可看)，
//        其他文件保存到 ~/.dsh-wechat/media/ 并在消息中给出路径
//      - 发: agent 回复里含 [发送图片: 路径] / [发送文件: 路径] 标记时，
//        桥接器把文件发给微信用户并剥掉标记
//   3. 主动发送/定时提醒:
//      - 桥接器自带本地 HTTP 接口 POST /send（{text, file?, to?}），发给绑定的 owner
//      - 定时提醒用 macOS launchd/cron 调 notify.mjs 或直接 curl
//
// v3 变更（修复「DSH 能看到回复、微信收不到」）:
//   - mux 事件流断线(如 DSH 重启导致 code=1006)后自动重连（指数退避），不再永久失联
//   - 每次（重）连上后从 session.history 补发断线期间遗漏的回复（按 lastFlushedSeq 去重，
//     持久化到 forward-state.json；首次运行把历史已完成的回合视为已送达，避免重发旧消息）
//   - 每个微信回合只转发该回合最终一条 assistant 文本（原实现只发第一条、后续全丢）
//
// 环境变量:
//   DSH_BASE              DSH HTTP 地址 (默认 http://127.0.0.1:3080)
//   WECHAT_SESSION_ID     指定 DSH 会话 id
//   WECHAT_CRED_DIR       凭据目录 (默认 ~/.dsh-wechat)
//   WECHAT_OWNER          owner 微信用户 id（默认取第一个发消息者）
//   WECHAT_BRIDGE_PORT    本地 HTTP 接口端口 (默认 8790)
//   WECHAT_BRIDGE_TOKEN   本地接口 Bearer token（设置后必须带 Authorization 头）
//   DSH_CWD               新建会话工作目录 (默认当前目录)

import { WeChatClient, MessageType } from 'wechat-ilink-client'
import qrcode from 'qrcode-terminal'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DSH_BASE = process.env.DSH_BASE || 'http://127.0.0.1:3080'
const HOST = new URL(DSH_BASE).host
const CRED_DIR = process.env.WECHAT_CRED_DIR || join(homedir(), '.dsh-wechat')
const CRED_FILE = join(CRED_DIR, 'credentials.json')
const SYNC_FILE = join(CRED_DIR, 'sync-buf.json')
const SESSION_FILE = join(CRED_DIR, 'session.json')
const OWNER_FILE = join(CRED_DIR, 'owner.json')
const TOKENS_FILE = join(CRED_DIR, 'tokens.json')
const FORWARD_STATE_FILE = join(CRED_DIR, 'forward-state.json')
const MEDIA_DIR = join(CRED_DIR, 'media')
const BRIDGE_PORT = Number(process.env.WECHAT_BRIDGE_PORT || 8790)
const BRIDGE_TOKEN = process.env.WECHAT_BRIDGE_TOKEN || ''
const SESSION_TITLE = '微信'
const MAX_IMAGES_PER_MSG = 3
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // DSH 单图上限 5MB

// ---------- DSH API 客户端 ----------

async function dshCall(method, payload) {
  const rpcId = randomUUID()
  const res = await fetch(`${DSH_BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: HOST },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${method}`)
  const body = await res.json()
  if (!body?.result?.ok) {
    const e = body?.result?.error || {}
    throw new Error(`${method} failed: ${e.code || 'unknown'} ${e.message || ''}`)
  }
  return body.result.value
}

async function ensureSession(preferredId) {
  if (preferredId) return preferredId
  const items = (await dshCall('session.list', {})).items
  for (const s of items) {
    const title = s.projections?.values?.title
    if (title === SESSION_TITLE) return s.sessionId
  }
  const created = await dshCall('session.create', {
    cwd: process.env.DSH_CWD || process.cwd(),
  })
  return created.sessionId
}

function extractAssistantText(event) {
  if (event?.type !== 'assistant/message') return null
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return null
  const parts = content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
  return parts.length ? parts.join('\n') : null
}

function openMux({ onFrame, onConnected, onError }) {
  // 带指数退避的自动重连：断线（如 DSH 重启 code=1006）后持续重连，
  // 重连成功后回调 onConnected 触发历史补发，避免回复永久丢失。
  const wsUrl = DSH_BASE.replace(/^http/, 'ws') + '/api/events.mux'
  let closed = false
  let ws = null
  let retryMs = 1000
  const connect = () => {
    if (closed) return
    try {
      ws = new WebSocket(wsUrl)
    } catch (e) {
      onError?.(e)
      return scheduleReconnect('create failed')
    }
    ws.onopen = () => {
      retryMs = 1000
      console.log(`[dsh] 已连接事件流 ${wsUrl}`)
      onConnected?.()
    }
    ws.onmessage = (ev) => {
      try {
        const serverReq = JSON.parse(String(ev.data))
        if (serverReq?.payload) onFrame(serverReq.payload)
      } catch {}
    }
    ws.onclose = (e) => scheduleReconnect(`code=${e.code}`)
    ws.onerror = () => { try { ws.close() } catch {} }
  }
  const scheduleReconnect = (why) => {
    if (closed) return
    console.error(`[dsh] 事件流断开（${why}），${Math.round(retryMs / 1000)}s 后重连…`)
    const delay = retryMs
    retryMs = Math.min(retryMs * 2, 30000)
    setTimeout(connect, delay)
  }
  connect()
  return () => { closed = true; try { ws?.close() } catch {} }
}

// ---------- 状态持久化 ----------

function loadJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
function saveJson(file, value) {
  mkdirSync(CRED_DIR, { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2))
}

function loadCreds() { return loadJson(CRED_FILE, null) }
function saveCreds(creds) { saveJson(CRED_FILE, creds) }
function loadSessionId() { return loadJson(SESSION_FILE, {}).sessionId }
function saveSessionId(id) { saveJson(SESSION_FILE, { sessionId: id }) }
function loadOwner() { return loadJson(OWNER_FILE, {}).userId }
function saveOwner(userId) { saveJson(OWNER_FILE, { userId }) }

// context_token 持久化：iLink 要求回复必须携带最近一次入站的 context_token（约 24h 有效）。
// 桥接器每次收到消息都保存 token，重启后仍能主动发送，直到 token 过期需对方再发一条消息刷新。
const tokens = loadJson(TOKENS_FILE, {})
function saveToken(userId, token) {
  if (!userId || !token) return
  tokens[userId] = token
  try { saveJson(TOKENS_FILE, tokens) } catch {}
}
function resolveToken(userId) {
  return tokens[userId] || client.getContextToken(userId)
}

// ---------- 媒体工具 ----------

function sniffImageType(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buf.length >= 6 && (buf.slice(0, 4).toString('ascii') === 'GIF8')) return 'image/gif'
  return null
}

function safeFileName(name) {
  const base = String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(-120)
  return base || 'file'
}

async function handleInboundMedia(client, items) {
  // 返回 { parts: 注入 prompt 的 content parts, notes: 附带的文字说明 }
  const parts = []
  const notes = []
  let imgCount = 0
  mkdirSync(MEDIA_DIR, { recursive: true })
  for (const item of items || []) {
    if (!WeChatClient.isMediaItem(item)) continue
    try {
      const media = await client.downloadMedia(item)
      if (!media) continue
      if (media.kind === 'image' && imgCount < MAX_IMAGES_PER_MSG && media.data.length <= MAX_IMAGE_BYTES) {
        const mime = sniffImageType(media.data)
        if (mime) {
          parts.push({
            type: 'image',
            mediaType: mime,
            data: media.data.toString('base64'),
            name: media.fileName || `wechat-image-${Date.now()}.${mime.split('/')[1]}`,
          })
          imgCount += 1
          continue
        }
      }
      // 其他（文件/视频/语音/超限图片）→ 保存到本地
      const ext = media.fileName ? '' : '.bin'
      const name = media.fileName || `wechat-${media.kind}-${Date.now()}${ext}`
      const path = join(MEDIA_DIR, `${Date.now()}-${safeFileName(name)}`)
      writeFileSync(path, media.data)
      const kindLabel = media.kind === 'file' ? '文件' : media.kind === 'video' ? '视频' : media.kind === 'voice' ? '语音' : '图片'
      notes.push(`[微信${kindLabel} 已保存] ${media.fileName || name} → ${path}`)
    } catch (e) {
      notes.push(`[微信媒体下载失败] ${e.message}`)
    }
  }
  return { parts, notes }
}

function parseSendMarkers(text) {
  // 提取 [发送图片: path] / [发送文件: path]，返回 { files: [{kind, path}], clean: 剥掉标记后的文本 }
  const files = []
  const clean = text
    .replace(/\[发送图片:\s*([^\]]+)\]/g, (_, p) => { files.push({ kind: 'image', path: p.trim() }); return '' })
    .replace(/\[发送文件:\s*([^\]]+)\]/g, (_, p) => { files.push({ kind: 'file', path: p.trim() }); return '' })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { files, clean }
}

// ---------- 主流程 ----------

console.log(`[dsh-wechat v3] DSH=${DSH_BASE} 本地接口 http://127.0.0.1:${BRIDGE_PORT}`)

// 1. 登录 / 恢复登录
const saved = loadCreds()
const client = saved ? new WeChatClient(saved) : new WeChatClient()

if (!saved) {
  console.log('[微信] 首次运行，等待扫码登录（用手机微信「扫一扫」）…')
  const result = await client.login({
    onQRCode: (url) => {
      console.log('[微信] 二维码 URL:', url)
      qrcode.generate(url, { small: true }, (qr) => console.log(qr))
    },
    onStatus: (s) => console.log('[微信]', s),
  })
  if (!result.connected) {
    console.error('[微信] 登录失败:', result.message || 'unknown')
    process.exit(1)
  }
  saveCreds({ accountId: result.accountId, token: result.botToken, baseUrl: result.baseUrl })
  console.log(`[微信] 登录成功 account_id=${result.accountId}`)
} else {
  console.log(`[微信] 使用已保存凭据 account_id=${saved.accountId}`)
}

// 2. 目标 DSH 会话（DSH 未启动时持续重试）
let targetSessionId
{
  let delay = 3000
  for (;;) {
    try {
      targetSessionId = await ensureSession(process.env.WECHAT_SESSION_ID || loadSessionId())
      break
    } catch (e) {
      console.error(`[dsh] 无法连接 DSH（${Math.round(delay / 1000)}s 后重试）: ${e.message}`)
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(Math.round(delay * 1.5), 30000)
    }
  }
  saveSessionId(targetSessionId)
  console.log(`[dsh] 目标会话: ${targetSessionId}`)
}

// 3. 一次性注入能力说明（每个会话只注入一次，agent 由此知道微信能力）
{
  const flagFile = join(CRED_DIR, `instructed-${targetSessionId}`)
  if (!existsSync(flagFile)) {
    const instruction = `[系统说明] 你正通过微信与用户对话（消息由 dsh-wechat 桥接器转发）。你的回复会发回微信。
能力与约定：
1. 需要把本地文件发给微信用户时，在回复中加一行标记：[发送图片: 绝对路径] 或 [发送文件: 绝对路径]（标记行不会发给用户，文件会随回复一起发送）。
2. 需要主动给用户发微信通知（不等待用户消息）时，用 bash 执行：
   curl -s -X POST http://127.0.0.1:${BRIDGE_PORT}/send -H 'Content-Type: application/json' -d '{"text":"通知内容"}'
   发文件时加 "file":"绝对路径"。
3. 定时提醒：用 launchd/cron 定时调用上述 /send 接口即可（见项目 README）。`
    try {
      await dshCall('session.prompt', {
        sessionId: targetSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: instruction }],
      })
      saveJson(flagFile, { at: Date.now() })
      console.log('[dsh] 已注入微信能力说明')
    } catch (e) {
      console.error('[dsh] 注入能力说明失败:', e.message)
    }
  }
}

// 4. owner 追踪（第一个发消息的微信用户）
let ownerUserId = process.env.WECHAT_OWNER || loadOwner()

// 5. 本地 HTTP 接口：主动发送（定时提醒/通知）
{
  const server = createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (BRIDGE_TOKEN && req.headers.authorization !== `Bearer ${BRIDGE_TOKEN}`) return send(401, { ok: false, error: 'unauthorized' })
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, accountId: client.getAccountId?.() ?? null })
    if (req.method === 'POST' && req.url === '/send') {
      let body = {}
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        return send(400, { ok: false, error: 'bad_json' })
      }
      const to = body.to || ownerUserId
      if (!to) return send(400, { ok: false, error: 'no_owner_yet' })
      try {
        if (body.file) {
          await client.sendMedia(to, body.file, typeof body.text === 'string' ? body.text : undefined, resolveToken(to))
        } else if (typeof body.text === 'string' && body.text) {
          await client.sendText(to, body.text, resolveToken(to))
        } else {
          return send(400, { ok: false, error: 'text_or_file_required' })
        }
        return send(200, { ok: true, to })
      } catch (e) {
        return send(500, { ok: false, error: String(e.message || e) })
      }
    }
    return send(404, { ok: false, error: 'not_found' })
  })
  server.listen(BRIDGE_PORT, '127.0.0.1', () => console.log(`[http] 主动发送接口就绪 http://127.0.0.1:${BRIDGE_PORT}/send`))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new Error('too_large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// 6. 回复通道：DSH 会话里 agent 的回复 → 发回微信（支持文件标记）
//    一个微信回合 = 一条带 [微信消息] 标记的 user/message 起、turn/end 止。
//    回合内多条 assistant 消息只取最后一条文本作为最终回复转发（避免只发中间过程、
//    漏掉最终答案）。mux 断线期间产生的回复由 replayMissed() 从 session.history 补发。
let pending = null // { from, text, files }
let lastFlushedSeq = loadForwardState()
let chain = Promise.resolve()

function wechatSenderOf(evt) {
  const content = evt?.data?.content
  if (!Array.isArray(content)) return null
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string') {
      const m = b.text.match(/^\[微信消息\] 来自「([^」]+)」/)
      if (m) return m[1]
    }
  }
  return null
}

function loadForwardState() {
  const v = loadJson(FORWARD_STATE_FILE, null)
  return typeof v?.lastFlushedSeq === 'number' ? v.lastFlushedSeq : null
}
function persistForwardState() {
  try { saveJson(FORWARD_STATE_FILE, { lastFlushedSeq }) } catch {}
}

async function flushPending(shouldSend) {
  const cur = pending
  pending = null
  if (!cur || !shouldSend) return
  const text = (cur.text || '').trim()
  if (text) {
    console.log(`[微信] 回复 → ${cur.from}: ${text.slice(0, 120)}`)
    await client.sendText(cur.from, text, resolveToken(cur.from))
  }
  for (const f of cur.files) {
    console.log(`[微信] 发送${f.kind} → ${cur.from}: ${f.path}`)
    await client.sendMedia(cur.from, f.path, undefined, resolveToken(cur.from))
  }
}

// 实时事件与断线补发共用同一状态机；发送失败时抛错、不推进 lastFlushedSeq，
// 下次重连会重试该回合，日志可查。
async function handleSessionEvent(evt) {
  if (!evt || typeof evt !== 'object') return
  const seq = typeof evt.seq === 'number' ? evt.seq : null
  switch (evt.type) {
    case 'user/message': {
      const from = wechatSenderOf(evt)
      if (from) {
        if (pending) await flushPending(true) // 兜底：上一回合异常未收尾时先发掉
        pending = { from, text: null, files: [] }
      } else if (pending) {
        pending = null // 非微信输入（GUI 手动输入/系统注入）打断转发关联
      }
      break
    }
    case 'assistant/message': {
      if (!pending) break
      const text = extractAssistantText(evt)
      if (text) {
        const { files, clean } = parseSendMarkers(text)
        pending.text = clean
        pending.files = files
      }
      break
    }
    case 'turn/end': {
      const isNew = lastFlushedSeq == null || seq == null || seq > lastFlushedSeq
      await flushPending(isNew)
      if (isNew && seq != null && (lastFlushedSeq == null || seq > lastFlushedSeq)) {
        lastFlushedSeq = seq
        persistForwardState()
      }
      break
    }
  }
}

function queueEvent(evt) {
  chain = chain.then(() => handleSessionEvent(evt)).catch((e) => console.error('[转发处理失败]', e.message))
  return chain
}

async function fetchHistoryPages() {
  // 从尾部向前翻页，直到覆盖 lastFlushedSeq（最多 3 页，防止异常时拉爆）
  const pages = []
  let beforeSeq
  for (let i = 0; i < 3; i++) {
    const hist = await dshCall('session.history', {
      sessionId: targetSessionId,
      maxMessages: 100,
      ...(beforeSeq != null ? { beforeSeq } : {}),
    })
    const events = (hist.events || []).map((e) => e.event).filter((e) => e && typeof e.seq === 'number')
    if (!events.length) break
    pages.unshift(events)
    const oldest = events[0].seq
    if (lastFlushedSeq != null && oldest <= lastFlushedSeq) break
    if (!hist.hasMore) break
    beforeSeq = oldest
  }
  return pages.flat()
}

async function replayMissed() {
  if (lastFlushedSeq == null) {
    // 首次运行/升级：历史里已完成的回合视为已送达（不重发旧消息），
    // 之后只转发新回合。当前正进行中的回合由实时事件流接管。
    const hist = await dshCall('session.history', { sessionId: targetSessionId, maxMessages: 100 })
    const events = (hist.events || []).map((e) => e.event)
    let init = null
    for (const e of events) if (e?.type === 'turn/end' && typeof e.seq === 'number') init = e.seq
    if (init == null) for (const e of events) if (typeof e?.seq === 'number') init = Math.max(init ?? 0, e.seq)
    lastFlushedSeq = init
    persistForwardState()
    console.log(`[dsh] 首次运行：已送达水位设为 seq=${lastFlushedSeq}，之后回复实时转发`)
    return
  }
  const all = await fetchHistoryPages()
  const todo = all.filter((e) => e.seq > lastFlushedSeq)
  if (!todo.length) return
  console.log(`[dsh] 事件流恢复，补发 ${todo.length} 条断线期间的事件…`)
  for (const evt of todo) await handleSessionEvent(evt)
}

openMux({
  onFrame: (frame) => {
    if (frame?.type !== 'session/event' || frame.sessionId !== targetSessionId) return
    queueEvent(frame.event)
  },
  onConnected: () => {
    chain = chain.then(() => replayMissed()).catch((e) => console.error('[dsh] 补发历史回复失败:', e.message))
  },
  onError: (e) => console.error('[dsh] 事件流错误:', e.message),
})

// 7. 入站：微信消息（文本 + 图片/文件）→ DSH 会话
client.on('message', async (msg) => {
  try {
    if (msg.message_type !== MessageType.USER) return
    const from = msg.from_user_id
    if (!from) return
    if (!ownerUserId) { ownerUserId = from; saveOwner(from); console.log(`[微信] owner 绑定: ${from}`) }
    if (msg.context_token) saveToken(from, msg.context_token)

    const text = (WeChatClient.extractText(msg) || '').trim()
    const { parts, notes } = await handleInboundMedia(client, msg.item_list)

    const content = []
    const lines = [`[微信消息] 来自「${from}」`]
    if (text) lines.push(text)
    if (notes.length) lines.push(notes.join('\n'))
    content.push({ type: 'text', text: lines.join('\n') })
    for (const p of parts) content.push(p)

    console.log(`[微信] ${from}: ${(text || notes.join('; ')).slice(0, 120)}`)
    await dshCall('session.prompt', {
      sessionId: targetSessionId,
      mode: 'queue',
      content,
    })
    // 回复转发由第 6 节状态机按 user/message 事件里的 [微信消息] 标记自动关联，无需在此登记
  } catch (e) {
    console.error('[处理微信消息失败]', e.message)
  }
})

client.on('error', (e) => console.error('[微信] 连接错误:', e.message))
client.on('sessionExpired', () => {
  console.error('[微信] 会话过期，请删除凭据文件重新扫码: rm', CRED_FILE)
  process.exit(1)
})

// 8. 开始长轮询（带游标持久化）
await client.start({
  loadSyncBuf: () => { try { return readFileSync(SYNC_FILE, 'utf8') } catch { return undefined } },
  saveSyncBuf: (buf) => { mkdirSync(CRED_DIR, { recursive: true }); writeFileSync(SYNC_FILE, buf) },
})

console.log('[dsh-wechat] 运行中。微信私信 → DSH 会话；回复自动回微信；支持图片/文件。Ctrl-C 停止。')

process.on('SIGINT', () => {
  console.log('\n[dsh-wechat] 停止。')
  client.stop()
  process.exit(0)
})
