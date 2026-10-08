/**
 * In-memory ring store for recent incoming/outgoing messages.
 * (For production history, rely on webhook -> your database.)
 */
import { config } from '../config.js'

const incoming = new Map() // sessionId -> []
const outgoing = new Map()

function push(map, sessionId, record) {
  if (!map.has(sessionId)) map.set(sessionId, [])
  const arr = map.get(sessionId)
  arr.unshift(record)
  if (arr.length > config.recentLimit) arr.length = config.recentLimit
}

export function pushIncoming(sessionId, record) {
  push(incoming, sessionId, record)
}

export function pushSent(sessionId, record) {
  push(outgoing, sessionId, record)
}

export function getIncoming(sessionId, limit = 20) {
  return (incoming.get(sessionId) || []).slice(0, limit)
}

export function getOutgoing(sessionId, limit = 20) {
  return (outgoing.get(sessionId) || []).slice(0, limit)
}
