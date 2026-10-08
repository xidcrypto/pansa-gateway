import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { asyncH, ok } from './_helpers.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { config } from '../config.js'
import { dbQuery } from '../db.js'
import { hashPassword, verifyPassword, signToken, publicUser, validateUsername, validatePassword } from '../auth.js'

export const authRoutes = Router()

const loginLimiter = rateLimit({
  windowMs: config.rate.windowMs,
  max: config.rate.authMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Terlalu banyak percobaan login, coba lagi nanti' },
})

// POST /auth/login  { username, password } -> { token, user }
authRoutes.post('/login', loginLimiter, asyncH(async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ success: false, error: '"username" dan "password" wajib diisi' })
  }
  const rows = await dbQuery('SELECT * FROM users WHERE username = ? LIMIT 1', [username])
  const user = rows[0]
  if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ success: false, error: 'Username atau password salah' })
  }
  ok(res, { token: signToken(user), user: publicUser(user) })
}))

// GET /auth/me -> profil sendiri
authRoutes.get('/me', authRequired, asyncH(async (req, res) => {
  ok(res, { user: publicUser(req.user) })
}))

// PATCH /auth/me  { webhookUrl?, webhookSecret? } — user atur webhook sendiri
authRoutes.patch('/me', authRequired, asyncH(async (req, res) => {
  const { webhookUrl, webhookSecret } = req.body || {}
  if (webhookUrl != null && (typeof webhookUrl !== 'string' || webhookUrl.length > 512)) {
    return res.status(400).json({ success: false, error: 'webhookUrl tidak valid' })
  }
  await dbQuery('UPDATE users SET webhook_url = ?, webhook_secret = ? WHERE id = ?', [
    webhookUrl || null,
    webhookSecret || null,
    req.user.id,
  ])
  const rows = await dbQuery('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.id])
  ok(res, { user: publicUser(rows[0]) })
}))

// PATCH /auth/password  { oldPassword, newPassword }
authRoutes.patch('/password', authRequired, asyncH(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {}
  const rows = await dbQuery('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.id])
  const user = rows[0]
  if (!user || !(await verifyPassword(oldPassword || '', user.password_hash))) {
    return res.status(401).json({ success: false, error: 'Password lama salah' })
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ success: false, error: 'Password baru min 6 karakter' })
  }
  await dbQuery('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(newPassword), req.user.id])
  ok(res, { updated: true })
}))

// ---------- Admin: kelola user ----------
const admin = [authRequired, adminOnly]

// GET /auth/users — list semua user
authRoutes.get('/users', ...admin, asyncH(async (req, res) => {
  const rows = await dbQuery('SELECT * FROM users ORDER BY id ASC')
  ok(res, { users: rows.map(publicUser) })
}))

// POST /auth/users  { username, password, role? } — bikin user
authRoutes.post('/users', ...admin, asyncH(async (req, res) => {
  const { username, password, role } = req.body || {}
  if (!validateUsername(username)) {
    return res.status(400).json({ success: false, error: 'username 3-32 char, huruf/angka/._-' })
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ success: false, error: 'password min 6 karakter' })
  }
  const r = role === 'admin' ? 'admin' : 'user'
  try {
    const result = await dbQuery('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
      username,
      await hashPassword(password),
      r,
    ])
    const rows = await dbQuery('SELECT * FROM users WHERE id = ? LIMIT 1', [result.insertId])
    ok(res, { user: publicUser(rows[0]) }, 201)
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: `Username "${username}" sudah dipakai` })
    }
    throw e
  }
}))

// PATCH /auth/users/:id  { password?, role?, active? }
authRoutes.patch('/users/:id', ...admin, asyncH(async (req, res) => {
  const target = Number(req.params.id)
  if (!Number.isInteger(target)) return res.status(400).json({ success: false, error: 'id tidak valid' })
  const rows = await dbQuery('SELECT * FROM users WHERE id = ? LIMIT 1', [target])
  if (!rows[0]) return res.status(404).json({ success: false, error: 'User tidak ditemukan' })
  const { password, role, active } = req.body || {}
  const sets = []
  const vals = []
  if (password != null) {
    if (!validatePassword(password)) return res.status(400).json({ success: false, error: 'password min 6 karakter' })
    sets.push('password_hash = ?')
    vals.push(await hashPassword(password))
  }
  if (role != null) {
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ success: false, error: 'role harus admin|user' })
    if (target === req.user.id && role !== 'admin') {
      return res.status(400).json({ success: false, error: 'Tidak bisa cabut admin diri sendiri' })
    }
    sets.push('role = ?')
    vals.push(role)
  }
  if (active != null) {
    if (target === req.user.id && !active) {
      return res.status(400).json({ success: false, error: 'Tidak bisa nonaktifkan diri sendiri' })
    }
    sets.push('active = ?')
    vals.push(active ? 1 : 0)
  }
  if (!sets.length) return res.status(400).json({ success: false, error: 'Tidak ada field diubah' })
  vals.push(target)
  await dbQuery(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals)
  const updated = await dbQuery('SELECT * FROM users WHERE id = ? LIMIT 1', [target])
  ok(res, { user: publicUser(updated[0]) })
}))

// DELETE /auth/users/:id — hapus user (session jadi yatim, tetap bisa di-manage admin)
authRoutes.delete('/users/:id', ...admin, asyncH(async (req, res) => {
  const target = Number(req.params.id)
  if (!Number.isInteger(target)) return res.status(400).json({ success: false, error: 'id tidak valid' })
  if (target === req.user.id) {
    return res.status(400).json({ success: false, error: 'Tidak bisa hapus diri sendiri' })
  }
  const result = await dbQuery('DELETE FROM users WHERE id = ?', [target])
  if (!result.affectedRows) return res.status(404).json({ success: false, error: 'User tidak ditemukan' })
  ok(res, { deleted: target })
}))
