import { Router } from 'express'
import { asyncH, ok } from './_helpers.js'
import { adminOnly } from '../middleware/auth.js'
import { dbQuery, pingDb } from '../db.js'
import { listSessions, stopSession } from '../wa/session.js'

export const adminRoutes = Router()

adminRoutes.use(adminOnly)

// GET /admin/stats — ringkasan sistem
adminRoutes.get('/stats', asyncH(async (req, res) => {
  const [users] = await dbQuery('SELECT COUNT(*) AS c FROM users')
  const [userActive] = await dbQuery("SELECT COUNT(*) AS c FROM users WHERE active = 1")
  const [sessions] = await dbQuery('SELECT COUNT(*) AS c FROM sessions')
  const [byStatus] = await dbQuery('SELECT status, COUNT(*) AS c FROM sessions GROUP BY status')
  const [msgIn] = await dbQuery("SELECT COUNT(*) AS c FROM messages WHERE direction = 'in'")
  const [msgOut] = await dbQuery("SELECT COUNT(*) AS c FROM messages WHERE direction = 'out'")
  const [msgToday] = await dbQuery('SELECT COUNT(*) AS c FROM messages WHERE created_at >= CURDATE()')
  let db = false
  try { db = await pingDb() } catch { /* flag saja */ }
  ok(res, {
    db,
    liveSessions: listSessions().length,
    users: { total: users.c, active: userActive.c },
    sessions: { total: sessions.c, byStatus },
    messages: { in: msgIn.c, out: msgOut.c, today: msgToday.c },
    uptime: process.uptime(),
  })
}))

// GET /admin/sessions — semua session semua user (pantauan)
adminRoutes.get('/sessions', asyncH(async (req, res) => {
  const rows = await dbQuery(
    `SELECT s.*, u.username AS owner_name FROM sessions s LEFT JOIN users u ON u.id = s.owner_id ORDER BY s.updated_at DESC`,
  )
  const live = new Map(listSessions().map((s) => [s.id, s]))
  ok(res, {
    sessions: rows.map((r) => ({
      id: r.id,
      label: r.label,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      status: live.get(r.id)?.status || r.status,
      me: live.get(r.id)?.me || null,
      updatedAt: r.updated_at,
    })),
  })
}))

// POST /admin/sessions/:id/stop  { logout? } — paksa stop session user
adminRoutes.post('/sessions/:id/stop', asyncH(async (req, res) => {
  const logout = req.body?.logout ?? req.query.logout === 'true'
  const result = await stopSession(req.params.id, logout)
  if (logout) await dbQuery('DELETE FROM sessions WHERE id = ?', [req.params.id])
  ok(res, result)
}))

// DELETE /admin/sessions/:id — hapus record session (akun WA tetap login, file sesi tetap ada)
adminRoutes.delete('/sessions/:id', asyncH(async (req, res) => {
  await dbQuery('DELETE FROM sessions WHERE id = ?', [req.params.id])
  ok(res, { deleted: req.params.id })
}))

// GET /admin/messages?session=&limit= — intip pesan (audit)
adminRoutes.get('/messages', asyncH(async (req, res) => {
  const session = req.query.session
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200)
  const rows = session
    ? await dbQuery(
        `SELECT m.*, u.username AS owner_name FROM messages m LEFT JOIN sessions s ON s.id = m.session_id LEFT JOIN users u ON u.id = s.owner_id WHERE m.session_id = ? ORDER BY m.id DESC LIMIT ${limit}`,
        [session],
      )
    : await dbQuery(
        `SELECT m.*, u.username AS owner_name FROM messages m LEFT JOIN sessions s ON s.id = m.session_id LEFT JOIN users u ON u.id = s.owner_id ORDER BY m.id DESC LIMIT ${limit}`,
      )
  ok(res, { messages: rows })
}))
