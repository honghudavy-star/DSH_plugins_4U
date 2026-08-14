// test-dsh-side.mjs — 验证 DSH 侧链路：create 会话 → 注入消息 → mux 收到回复
// 与 dsh-wechat-bridge.mjs 使用完全相同的 API 调用方式
import { randomUUID } from 'node:crypto'

const DSH_BASE = process.env.DSH_BASE || 'http://127.0.0.1:3080'
const HOST = new URL(DSH_BASE).host

async function dshCall(method, payload) {
  const rpcId = randomUUID()
  const res = await fetch(`${DSH_BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: HOST },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  const body = await res.json()
  if (!body?.result?.ok) throw new Error(JSON.stringify(body?.result?.error))
  return body.result.value
}

console.log('1) 创建会话 …')
const created = await dshCall('session.create', { cwd: process.cwd() })
const sessionId = created.sessionId
console.log('   会话:', sessionId)

console.log('2) 打开 mux 事件流 …')
const ws = new WebSocket('ws://127.0.0.1:3080/api/events.mux')
let gotReply = false
ws.onmessage = (ev) => {
  try {
    const f = JSON.parse(String(ev.data)).payload
    if (f?.type === 'session/event' && f.sessionId === sessionId && f.event?.type === 'assistant/message') {
      const text = f.event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      if (text) {
        console.log('4) 收到 assistant 回复:', text.slice(0, 200))
        gotReply = true
        ws.close()
        process.exit(0)
      }
    }
  } catch {}
}
await new Promise(r => ws.onopen = r)

console.log('3) 注入测试消息 …')
await dshCall('session.prompt', {
  sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: '[微信消息] 来自「测试」：你好，这是一条链路测试。请只回复四个字：链路正常。' }],
})
console.log('   已注入，等待 agent 回复（最长 60s）…')

setTimeout(() => {
  if (!gotReply) {
    console.error('超时未收到回复')
    process.exit(1)
  }
}, 60000)
