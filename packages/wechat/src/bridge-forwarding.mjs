export async function sendPendingReply(pending, {
  client,
  resolveToken,
  resolveFile,
  log = console.log,
} = {}) {
  if (!pending || typeof pending !== 'object') return
  let text = (pending.text || '').trim()
  if (pending.rejectedFiles > 0) {
    const warning = `[安全限制] ${pending.rejectedFiles} 个文件未发送：路径必须是已存在普通文件的绝对路径。`
    text = text ? `${text}\n\n${warning}` : warning
  }
  if (text) {
    log(`[微信] 回复 → ${pending.from}: ${text.slice(0, 120)}`)
    await client.sendText(pending.from, text, resolveToken(pending.from))
  }
  for (const item of pending.files || []) {
    const file = resolveFile(item.path)
    log(`[微信] 发送${item.kind} → ${pending.from}: ${file}`)
    // Deliberately allow transport errors to reject the whole turn. The caller
    // must not advance its durable forwarding waterline until every send ends.
    await client.sendMedia(pending.from, file, undefined, resolveToken(pending.from))
  }
}

export async function fetchHistoryThroughWaterline({
  fetchPage,
  lastFlushedSeq,
  pageSize = 100,
  maxPages = 1000,
}) {
  if (typeof fetchPage !== 'function') throw new Error('history_fetcher_required')
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error('invalid_history_page_size')
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) throw new Error('invalid_history_page_limit')
  const pages = []
  let beforeSeq
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const history = await fetchPage({
      maxMessages: pageSize,
      ...(beforeSeq != null ? { beforeSeq } : {}),
    })
    const events = (history?.events || [])
      .map((item) => item?.event || item)
      .filter((event) => event && Number.isSafeInteger(event.seq))
    if (!events.length) {
      if (history?.hasMore) throw new Error('history pagination returned no events before reaching the waterline')
      break
    }
    pages.push(events)
    const oldest = Math.min(...events.map((event) => event.seq))
    if (lastFlushedSeq == null || oldest <= lastFlushedSeq || !history?.hasMore) break
    if (beforeSeq != null && oldest >= beforeSeq) {
      throw new Error('history pagination did not make progress')
    }
    if (pageNumber + 1 >= maxPages) {
      throw new Error(`history pagination limit reached before seq=${lastFlushedSeq}`)
    }
    beforeSeq = oldest
  }

  const ordered = pages.flat().sort((left, right) => left.seq - right.seq)
  const unique = []
  let previousSeq = null
  for (const event of ordered) {
    if (event.seq === previousSeq) continue
    unique.push(event)
    previousSeq = event.seq
  }
  return unique
}

export async function finishForwardingTurn({
  state,
  shouldSend,
  seq,
  sendPending,
  completeOrigin,
  persistWater,
}) {
  const pending = state.pending
  const blockedSeq = pending?.blockedSeq
  if (pending && shouldSend) {
    try {
      await sendPending(pending)
    } catch (error) {
      if (pending.blockedSeq == null && Number.isSafeInteger(seq)) pending.blockedSeq = seq
      throw error
    }
  }

  let nextWater = state.lastFlushedSeq
  const commitSeq = blockedSeq ?? seq
  if (shouldSend && commitSeq != null && (nextWater == null || commitSeq > nextWater)) {
    nextWater = commitSeq
    try {
      persistWater(nextWater)
    } catch (error) {
      if (pending && pending.blockedSeq == null && Number.isSafeInteger(commitSeq)) pending.blockedSeq = commitSeq
      throw error
    }
  }
  if (pending && shouldSend && pending.correlationId) {
    try {
      completeOrigin(pending.correlationId)
    } catch (error) {
      // The reply and waterline are already durable. Reflect that state in
      // memory so an origin-store cleanup error cannot duplicate the send.
      state.pending = null
      state.lastFlushedSeq = nextWater
      throw error
    }
  }
  state.pending = null
  state.lastFlushedSeq = nextWater
  return { recoveredFromBlock: blockedSeq != null }
}
