import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash)
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret)
}

export function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    active: !!row.active,
    webhookUrl: row.webhook_url || null,
    createdAt: row.created_at,
  }
}

export function validateUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(username)
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 128
}
