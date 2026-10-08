/**
 * WhatsApp session manager (multi-device, multi-session).
 * One WA account per session id, session state in ./sessions/<id>/.
 */
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import pino from 'pino'
import QRCode from 'qrcode'
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser,
} from '@rexxhayanasi/elaina-baileys'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { emitSessionEvent, setSessionStatus, logMessage } from './persist.js'
import { shortJid } from '../jid.js'

import { randomUUID } from 'node:crypto'

const sessions = new Map() // id -> { sock, qr, pairingCode, status, me, saveCreds, reconnectTimer }

/** Generate session id = UUID v4 */
export function generateSessionId() {
  let id
  do {
    id = randomUUID()
  } while (sessions.has(id))
  return id
}

/** ID valid: UUID atau huruf/angka/dash/underscore maks 64 char (cegah path traversal) */
export function sanitizeId(id) {
  const clean = String(id || '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clean)) {
    const err = new Error('Session id tidak valid')
    err.status = 400
    throw err
  }
  return clean
}

export function getSession(id) {
  return sessions.get(id)
}

export function listSessions() {
  return [...sessions.entries()].map(([id, s]) => ({
    id,
    status: s.status,
    me: s.me,
    hasQr: !!s.qr,
    hasPairingCode: !!s.pairingCode,
  }))
}

export function getSock(id) {
  const s = sessions.get(id)
  if (!s?.sock) {
    const err = new Error(`Session "${id}" belum dibuat / belum connect. POST /sessions/${id}/start dulu.`)
    err.status = 404
    throw err
  }
  if (s.status !== 'open') {
    const err = new Error(`Session "${id}" belum terhubung (status: ${s.status})`)
    err.status = 409
    throw err
  }
  return s.sock
}

async function handleIncoming(sessionId, m) {
  const msg = m.messages?.[0]
  if (!msg?.message) return

  const remoteJid = msg.key.remoteJid
  const fromMe = !!msg.key.fromMe
  const type = Object.keys(msg.message).find(
    (k) => !['senderKeyDistributionMessage', 'messageContextInfo'].includes(k),
  )

  const record = {
    id: msg.key.id,
    remoteJid,
    fromMe,
    type: type || 'unknown',
    pushName: msg.pushName || null,
    timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
  }

  // Extract readable text where possible
  const content = msg.message
  record.text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    null

  // Button / list / template responses
  record.buttonResponse =
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedId ||
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    null

  // Quoted message reference
  const ctx = content.extendedTextMessage?.contextInfo
  if (ctx?.quotedMessage) {
    record.quoted = { stanzaId: ctx.stanzaId, participant: ctx.participant }
  }

  // Media flag (binary downloadable via /download endpoint)
  record.hasMedia = !!(
    content.imageMessage ||
    content.videoMessage ||
    content.audioMessage ||
    content.documentMessage ||
    content.stickerMessage
  )

  if (fromMe) {
    // Skip own echoes except to keep recent list useful
    pushSent(sessionId, { ...record, status: 'sent' })
  } else {
    logMessage(sessionId, 'in', record)
    emitSessionEvent(sessionId, 'message.received', record)
  }
}

export async function startSession(rawId) {
  const id = sanitizeId(rawId)
  let entry = sessions.get(id)
  if (entry && (entry.status === 'open' || entry.status === 'connecting' || entry.status === 'qr')) {
    return { id, status: entry.status, reused: true }
  }
  if (entry?.reconnectTimer) {
    clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
  }

  const dir = path.join(config.sessionDir, id)
  await mkdir(dir, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(dir)
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))

  entry = sessions.get(id) || {}
  entry.status = 'connecting'
  entry.qr = null
  entry.pairingCode = null
  entry.me = entry.me || null
  entry.reconnectTimer = null
  sessions.set(id, entry)

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
    browser: ['Baileys Gateway', 'Chrome', '1.0'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
  })
  entry.sock = sock
  entry.saveCreds = saveCreds

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) {
      entry.qr = await QRCode.toDataURL(qr).catch(() => null)
      entry.status = 'qr'
      setSessionStatus(id, 'qr').catch(() => {})
      emitSessionEvent(id, 'qr', { qr: entry.qr })
    }
    if (connection === 'open') {
      entry.status = 'open'
      entry.qr = null
      entry.pairingCode = null
      entry.me = sock.user ? { id: sock.user.id, name: sock.user.name } : null
      logger.info({ session: id, me: entry.me?.id }, 'WhatsApp connected')
      setSessionStatus(id, 'open', entry.me).catch(() => {})
      emitSessionEvent(id, 'connected', { me: entry.me })
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut
      entry.status = loggedOut ? 'logged_out' : 'close'
      logger.warn({ session: id, code }, loggedOut ? 'Session logged out' : 'Connection closed')
      setSessionStatus(id, entry.status).catch(() => {})
      emitSessionEvent(id, loggedOut ? 'logged_out' : 'disconnected', { code })
      // Auto reconnect unless logged out or explicitly stopped
      if (!loggedOut && sessions.has(id) && !entry.reconnectTimer) {
        entry.reconnectTimer = setTimeout(() => {
          entry.reconnectTimer = null
          startSession(id).catch((e) => logger.error({ session: id, e }, 'Reconnect failed'))
        }, 5000)
      }
    }
  })

  sock.ev.on('messages.upsert', (m) => {
    if (m.type === 'notify') handleIncoming(id, m).catch((e) => logger.error(e))
  })

  sock.ev.on('messages.update', (updates) => {
    for (const u of updates) {
      if (u.update?.status) {
        emitSessionEvent(id, 'message.status', {
          id: u.key.id,
          remoteJid: u.key.remoteJid,
          status: u.update.status,
        })
      }
    }
  })

  sock.ev.on('presence.update', (p) => {
    emitSessionEvent(id, 'presence', { id: p.id, presences: p.presences })
  })

  sock.ev.on('groups.upsert', (g) => emitSessionEvent(id, 'group.joined', g))
  sock.ev.on('groups.update', (g) => emitSessionEvent(id, 'group.updated', g))
  sock.ev.on('group-participants.update', (g) => emitSessionEvent(id, 'group.participants', g))
  sock.ev.on('call', (c) => emitSessionEvent(id, 'call', c))

  return { id, status: 'connecting' }
}

export async function requestPairing(id, phone, customCode) {
  const entry = sessions.get(id)
  if (!entry?.sock) {
    const err = new Error(`Session "${id}" belum di-start. POST /sessions/${id}/start dulu.`)
    err.status = 404
    throw err
  }
  const digits = String(phone || '').replace(/[^0-9]/g, '')
  if (digits.length < 6 || digits.length > 15 || digits.startsWith('0')) {
    const err = new Error('phone harus format internasional (cth: 6281234567890), tanpa awalan 0')
    err.status = 400
    throw err
  }
  if (customCode != null && customCode !== '') {
    // Custom pairing code: tepat 8 char, huruf/angka (yang tampil di HP)
    const code = String(customCode).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (code.length !== 8) {
      const err = new Error('Custom pairing code harus tepat 8 karakter huruf/angka (cth: ABCD1234)')
      err.status = 400
      throw err
    }
    const pairingCode = await entry.sock.requestPairingCode(digits, code)
    entry.pairingCode = pairingCode
    entry.status = 'pairing'
    return { pairingCode, custom: true }
  }
  const code = await entry.sock.requestPairingCode(digits)
  entry.pairingCode = code
  entry.status = 'pairing'
  return { pairingCode: code, custom: false }
}

export function cancelPairing(id) {
  const entry = sessions.get(id)
  if (!entry?.sock) {
    const err = new Error(`Session "${id}" belum di-start.`)
    err.status = 404
    throw err
  }
  const cancelled = entry.sock.cancelPairingCode?.() ?? false
  if (cancelled) {
    entry.pairingCode = null
    if (entry.status === 'pairing') entry.status = 'connecting'
  }
  return { cancelled }
}

export async function stopSession(id, logout = false) {
  const entry = sessions.get(id)
  if (!entry) return { id, stopped: false }
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
  }
  try {
    if (logout && entry.sock) await entry.sock.logout().catch(() => {})
    entry.sock?.end?.(new Error('Stopped via API'))
  } catch { /* noop */ }
  sessions.delete(id)
  emitSessionEvent(id, 'stopped', { logout })
  return { id, stopped: true, logout }
}

export function sessionInfo(id) {
  const s = sessions.get(id)
  if (!s) {
    const err = new Error(`Session "${id}" tidak ditemukan`)
    err.status = 404
    throw err
  }
  return {
    id,
    status: s.status,
    me: s.me,
    qr: s.status === 'qr' ? s.qr : null,
    pairingCode: s.status === 'pairing' ? s.pairingCode : null,
  }
}

// Pre-normalize helper for JIDs coming back from WA
export { jidNormalizedUser }
