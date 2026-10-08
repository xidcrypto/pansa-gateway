/**
 * Persistence + webhook fan-out per session owner.
 * Dipakai session manager (event) dan routes (pesan terkirim).
 */
import { dbQuery } from '../db.js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { pushIncoming, pushSent } from './store.js'
import { shortJid } from '../jid.js'

async function sessionOwnerRow(sessionId) {
  const rows = await dbQuery(
    `SELECT s.*, u.webhook_url, u.webhook_secret
     FROM sessions s LEFT JOIN users u ON u.id = s.owner_id
     WHERE s.id = ? LIMIT 1`,
    [sessionId],
  ).catch(() => [])
  return rows[0] || null
}

function targetWebhook(ownerRow) {
  const url = ownerRow?.webhook_url || config.webhookUrl
  const secret = ownerRow?.webhook_secret || config.webhookSecret
  return { url, secret }
}

export async function setSessionStatus(sessionId, status, me = null) {
  const patch = { status }
  if (me?.id) patch.phone = shortJid(me.id)
  if (me?.name) patch.wa_name = String(me.name).slice(0, 128)
  const keys = Object.keys(patch)
  await dbQuery(
    `INSERT INTO sessions (id, status${me?.id ? ', phone' : ''}${me?.name ? ', wa_name' : ''})
     VALUES (?, ?${me?.id ? ', ?' : ''}${me?.name ? ', ?' : ''})
     ON DUPLICATE KEY UPDATE status = VALUES(status)${me?.id ? ', phone = VALUES(phone)' : ''}${me?.name ? ', wa_name = VALUES(wa_name)' : ''}, updated_at = CURRENT_TIMESTAMP`,
    [sessionId, status, ...(me?.id ? [patch.phone] : []), ...(me?.name ? [patch.wa_name] : [])],
  ).catch((e) => logger.warn({ e: e.message }, 'setSessionStatus failed'))
  void keys
}

export async function logMessage(sessionId, direction, record) {
  pushDirection(sessionId, direction, record)
  await dbQuery(
    `INSERT INTO messages (session_id, direction, wa_id, remote_jid, msg_type, text_body, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      direction,
      record.id || record.messageId || null,
      record.remoteJid || record.to || null,
      record.type || null,
      record.text ? String(record.text).slice(0, 16000) : null,
      safeJson(record),
    ],
  ).catch((e) => logger.warn({ e: e.message }, 'logMessage failed'))
}

function pushDirection(sessionId, direction, record) {
  if (direction === 'in') pushIncoming(sessionId, record)
  else pushSent(sessionId, record)
}

function safeJson(record) {
  try {
    const clean = { ...record }
    // jangan simpan binary/base64 raksasa ke kolom JSON
    for (const k of Object.keys(clean)) {
      if (typeof clean[k] === 'string' && clean[k].length > 8000) clean[k] = clean[k].slice(0, 8000) + '…'
    }
    return JSON.stringify(clean)
  } catch {
    return null
  }
}

export async function recentFromDb(sessionId, direction, limit = 20) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 200)
  const rows = await dbQuery(
    `SELECT wa_id AS id, remote_jid AS remoteJid, msg_type AS type, text_body AS text,
            payload, created_at AS timestamp
     FROM messages WHERE session_id = ? AND direction = ?
     ORDER BY id DESC LIMIT ${lim}`,
    [sessionId, direction],
  ).catch(() => [])
  return rows.map((r) => {
    let extra = {}
    if (r.payload) {
      if (typeof r.payload === 'object') extra = r.payload
      else try { extra = JSON.parse(r.payload) } catch { /* abaikan */ }
    }
    return { direction, ...extra, id: r.id, remoteJid: r.remoteJid, type: r.type, text: r.text, timestamp: r.timestamp }
  })
}

/**
 * Webhook fan-out: kirim ke webhook milik owner session,
 * fallback ke webhook global kalau owner tidak set.
 * Payload: { event, session, ts, data }
 */
export async function emitSessionEvent(sessionId, event, data = {}) {
  const owner = await sessionOwnerRow(sessionId)
  const { url, secret } = targetWebhook(owner)
  if (!url) return
  const payload = { event, session: sessionId, ts: new Date().toISOString(), data }
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (secret) headers['x-webhook-secret'] = secret
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) logger.warn({ sessionId, event, status: res.status }, 'Webhook delivery failed')
  } catch (err) {
    logger.warn({ sessionId, event, err: err.message }, 'Webhook delivery error')
  }
}

export { shortJid }
