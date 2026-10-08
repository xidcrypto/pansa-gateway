import { Router } from 'express'
import { asyncH, ok } from './_helpers.js'
import { authRequired, sessionOwner } from '../middleware/auth.js'
import { pairLimiter } from '../middleware/rate.js'
import {
  startSession, requestPairing, cancelPairing, stopSession,
  sessionInfo, listSessions,
} from '../wa/session.js'
import { dbQuery } from '../db.js'

export const sessionRoutes = Router()

async function touchSession(id, patch = {}) {
  const sets = ['status = VALUES(status)']
  const vals = []
  // upsert ringan: pastikan row ada
  await dbQuery(
    `INSERT INTO sessions (id, status) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
    [id, patch.status || 'connecting'],
  )
  if (patch.label != null) await dbQuery('UPDATE sessions SET label = ? WHERE id = ?', [patch.label, id])
  if (patch.ownerId != null) await dbQuery('UPDATE sessions SET owner_id = ? WHERE id = ?', [patch.ownerId, id])
}

// List sessions — admin: semua + owner; user: miliknya saja
sessionRoutes.get('/', authRequired, asyncH(async (req, res) => {
  const live = listSessions()
  const liveMap = new Map(live.map((s) => [s.id, s]))
  let rows
  if (req.user.role === 'admin') {
    rows = await dbQuery(
      `SELECT s.*, u.username AS owner_name FROM sessions s LEFT JOIN users u ON u.id = s.owner_id ORDER BY s.updated_at DESC`,
    )
  } else {
    rows = await dbQuery(`SELECT * FROM sessions WHERE owner_id = ? ORDER BY updated_at DESC`, [req.user.id])
  }
  const out = rows.map((r) => {
    const l = liveMap.get(r.id)
    return {
      id: r.id,
      label: r.label,
      ownerId: r.owner_id,
      ownerName: r.owner_name || null,
      status: l?.status || r.status,
      me: l?.me || (r.phone ? { id: r.phone, name: r.wa_name } : null),
      hasQr: !!l?.qr,
      hasPairingCode: !!l?.pairingCode,
    }
  })
  // Session live yang belum tercatat di DB (dibuat sebelum migrasi) — tampilkan utk admin saja
  if (req.user.role === 'admin') {
    const known = new Set(rows.map((r) => r.id))
    for (const l of live) {
      if (!known.has(l.id)) out.push({ id: l.id, label: null, ownerId: null, ownerName: null, ...l })
    }
  }
  ok(res, { sessions: out })
}))

// Create session — owner otomatis = user yang login (admin bisa titip ke user lain via ownerId)
sessionRoutes.post('/', authRequired, asyncH(async (req, res) => {
  const { generateSessionId } = await import('../wa/session.js')
  const id = generateSessionId()
  const result = await startSession(id)
  let ownerId = req.user.role === 'admin' && !req.isMaster ? req.user.id : req.user.id
  if (req.user.role === 'admin' && Number.isInteger(req.body?.ownerId)) ownerId = req.body.ownerId
  if (req.isMaster && Number.isInteger(req.body?.ownerId)) ownerId = req.body.ownerId
  if (req.isMaster && !Number.isInteger(req.body?.ownerId)) ownerId = null
  await touchSession(id, { status: 'connecting', label: req.body?.label || null, ownerId })
  ok(res, { ...result, ownerId }, 201)
}))

// Start (or reuse) — harus pemilik / admin
sessionRoutes.post('/:id/start', authRequired, sessionOwner, asyncH(async (req, res) => {
  const result = await startSession(req.params.id)
  const ownerId = req.sessionRow?.owner_id ?? (req.user.role === 'admin' ? null : req.user.id)
  await touchSession(req.params.id, { status: 'connecting', ownerId })
  ok(res, result)
}))

// QR — harus pemilik / admin
sessionRoutes.get('/:id/qr', authRequired, sessionOwner, asyncH(async (req, res) => {
  const info = sessionInfo(req.params.id)
  ok(res, { status: info.status, qr: info.qr })
}))

// Status — harus pemilik / admin
sessionRoutes.get('/:id/status', authRequired, sessionOwner, asyncH(async (req, res) => {
  ok(res, sessionInfo(req.params.id))
}))

// Pairing — harus pemilik / admin + rate limit ketat
sessionRoutes.post('/:id/pair', authRequired, sessionOwner, pairLimiter, asyncH(async (req, res) => {
  ok(res, await requestPairing(req.params.id, req.body?.phone, req.body?.code))
}))

sessionRoutes.post('/:id/pair/cancel', authRequired, sessionOwner, asyncH(async (req, res) => {
  const { cancelPairing } = await import('../wa/session.js')
  void cancelPairing
  ok(res, cancelPairing(req.params.id))
}))

// PATCH /sessions/:id — ganti label (pemilik/admin)
sessionRoutes.patch('/:id', authRequired, sessionOwner, asyncH(async (req, res) => {
  const { label } = req.body || {}
  if (typeof label !== 'string' || label.length > 128) {
    return res.status(400).json({ success: false, error: 'label maks 128 char' })
  }
  await touchSession(req.params.id, { label })
  ok(res, { id: req.params.id, label })
}))

// Stop — harus pemilik / admin
sessionRoutes.post('/:id/stop', authRequired, sessionOwner, asyncH(async (req, res) => {
  const logout = req.body?.logout ?? req.query.logout === 'true'
  const result = await stopSession(req.params.id, logout)
  if (logout) await dbQuery('DELETE FROM sessions WHERE id = ?', [req.params.id])
  ok(res, result)
}))

sessionRoutes.delete('/:id', authRequired, sessionOwner, asyncH(async (req, res) => {
  const logout = req.query.logout === 'true'
  const result = await stopSession(req.params.id, logout)
  if (req.user.role === 'admin' || logout) {
    await dbQuery('DELETE FROM sessions WHERE id = ?', [req.params.id])
  }
  ok(res, result)
}))
