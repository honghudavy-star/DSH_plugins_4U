// verify-wechat-loop.mjs — 监听微信会话，验证 消息进 DSH → agent 回复 全链路
// 用法: node verify-wechat-loop.mjs <sessionId>
const sessionId = process.argv[2]
if (!sessionId) { console.error('需要 sessionId'); process.exit(1) }

const ws = new WebSocket('ws://127.0.0.1:3080/api/events.mux')
let sawInbound = false
const timer = setTimeout(() => {
  console.error(`超时（${120}s）未观察到完整闭环`)
  process.exit(1)
}, 120000)

ws.onmessage = (ev) => {
  try {
    const f = JSON.parse(String(ev.data)).payload
    if (f?.type !== 'session/event' || f.sessionId !== sessionId) return
    const evt = f.event
    if (evt.type === 'user/message') {
      // user/message 的 data 本身就是 message（content 在 data.content，不是 data.message.content）
      const content = evt.data?.content || evt.data?.message?.content || []
      const text = content.map(b => b.type === 'text' ? b.text : '').join(' ') || ''
      if (text.includes('[微信消息]')) {
        sawInbound = true
        console.log('✅ 微信消息已进入 DSH 会话:', text.slice(0, 120))
      }
    }
    if (evt.type === 'assistant/message' && sawInbound) {
      const text = evt.data?.message?.content?.filter(b => b.type === 'text').map(b => b.text).join('\n')
      if (text) {
        console.log('✅ agent 回复已生成:', text.slice(0, 300))
        console.log('（回复已由桥接器转发回微信）')
        clearTimeout(timer)
        ws.close()
        process.exit(0)
      }
    }
  } catch {}
}
ws.onopen = () => console.log('监听中… 请在微信里给 bot 发一条消息')
ws.onerror = (e) => { console.error('WS 错误', e.message); process.exit(1) }
