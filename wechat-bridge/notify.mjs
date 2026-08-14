#!/usr/bin/env node
// notify.mjs — 主动发微信通知（定时提醒用）
//
// 用法:
//   node notify.mjs --text "该喝水了"
//   node notify.mjs --text "报告好了" --file /path/to/report.pdf
//
// 供 macOS launchd/cron 定时调用。也可直接 curl:
//   curl -s -X POST http://127.0.0.1:8790/send -H 'Content-Type: application/json' -d '{"text":"..."}'

const BRIDGE = process.env.WECHAT_BRIDGE_URL || 'http://127.0.0.1:8790'
const TOKEN = process.env.WECHAT_BRIDGE_TOKEN || ''

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}
const text = flag('text')
const file = flag('file')

if (!text && !file) {
  console.error('用法: node notify.mjs --text "内容" [--file 路径]')
  process.exit(1)
}

const payload = {}
if (text) payload.text = text
if (file) payload.file = file

const res = await fetch(`${BRIDGE}/send`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  },
  body: JSON.stringify(payload),
})
const body = await res.json().catch(() => ({}))
if (!res.ok || body.ok !== true) {
  console.error('发送失败:', JSON.stringify(body))
  process.exit(1)
}
console.log('已发送:', text ? text.slice(0, 60) : file)
