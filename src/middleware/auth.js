import jwt from 'jsonwebtoken'
import { verifyToken } from '../auth.js'
import { dbQuery } from '../db.js'
import { config } from '../config.js'

function fromHeader(req) {
  const h = req.headers.authorization || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/**
 * Auth gabungan:
 * 1. Bearer JWT (user frontend) -> req.user = { id, username, role }, req.isMaster = false
 * 2. x-api-key master (server-to-server) -> req.user = { id: 0, role: 'admin' }, req.isMaster = true
 * Tanpa keduanya -> 401 (kecuali /health, /docs, /openapi.json)
 */
export async function authRequired(req, res, next) {
  try {
    const token = fromHeader(req)
    if (token) {
      let payload
      try {
        payload = verifyToken(token)
      } catch {
        return res.status(401).json({ success: false, error: 'Token tidak valid / kedaluwarsa' })
      }
      const rows = await dbQuery('SELECT * FROM users WHERE id = ? LIMIT 1', [payload.sub])
      const user = rows[0]
      if (!user || !user.active) {
        return res.status(401).json({ success: false, error: 'User tidak aktif' })
      }
      req.user = { id: user.id, username: user.username, role: user.role, row: user }
      req.isMaster = false
      return next()
    }
    const key = req.headers['x-api-key']
    if (config.apiKey && key === config.apiKey) {
      req.user = { id: 0, username: 'master', role: 'admin' }
      req.isMaster = true
      return next()
    }
    return res.status(401).json({ success: false, error: 'Butuh login (Bearer token) atau x-api-key' })
  } catch (e) {
    return next(e)
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Khusus admin' })
  }
  return next()
}

/**
 * Kepemilikan session.
 * - master key / admin: boleh akses semua session
 * - user: hanya session miliknya (sessions.owner_id = user.id)
 * Menaruh session row DB di req.sessionRow.
 */
export async function sessionOwner(req, res, next) {
  try {
    const sid = req.params.session || req.params.id
    if (!sid) return res.status(400).json({ success: false, error: 'Session id wajib' })
    const rows = await dbQuery('SELECT * FROM sessions WHERE id = ? LIMIT 1', [sid])
    const row = rows[0]
    if (!row) {
      // Session mungkin dibuat sebelum DB dipakai — izinkan admin/master atau tolak user
      if (req.user?.role === 'admin') {
        req.sessionRow = null
        return next()
      }
      return res.status(404).json({ success: false, error: 'Session tidak ditemukan' })
    }
    if (req.user?.role !== 'admin' && row.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bukan session milikmu' })
    }
    req.sessionRow = row
    return next()
  } catch (e) {
    return next(e)
  }
}

// Untuk jsonwebtoken yang butuh import di middleware (hindari circular)
void jwt
