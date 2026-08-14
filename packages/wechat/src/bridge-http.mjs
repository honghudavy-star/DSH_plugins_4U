import { isBearerAuthorized, resolveLocalFile, selectOwnerRecipient } from './bridge-security.mjs'

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1e6) {
        reject(new Error('too_large'))
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createBridgeRequestHandler({ token, client, getOwner, resolveToken }) {
  if (typeof token !== 'string' || !token) throw new Error('bridge token is required')
  return async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    // 所有路由（包括 health）均先认证，未持有 token 的本机进程不能探测或外发。
    if (!isBearerAuthorized(req.headers.authorization, token)) {
      return send(401, { ok: false, error: 'unauthorized' })
    }
    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { ok: true, accountId: client.getAccountId?.() ?? null })
    }
    if (req.method !== 'POST' || req.url !== '/send') {
      return send(404, { ok: false, error: 'not_found' })
    }

    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return send(400, { ok: false, error: 'bad_json' })
    }

    let to
    try {
      to = selectOwnerRecipient(body.to, getOwner())
    } catch (error) {
      const code = String(error.message || error)
      return send(code === 'recipient_not_allowed' ? 403 : 400, { ok: false, error: code })
    }

    let file
    if (body.file != null) {
      try {
        file = resolveLocalFile(body.file)
      } catch (error) {
        return send(400, { ok: false, error: String(error.message || error) })
      }
    }

    try {
      if (file) {
        await client.sendMedia(to, file, typeof body.text === 'string' ? body.text : undefined, resolveToken(to))
      } else if (typeof body.text === 'string' && body.text) {
        await client.sendText(to, body.text, resolveToken(to))
      } else {
        return send(400, { ok: false, error: 'text_or_file_required' })
      }
      return send(200, { ok: true, to })
    } catch (error) {
      return send(500, { ok: false, error: String(error.message || error) })
    }
  }
}
