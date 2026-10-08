import mysql from 'mysql2/promise'
import { randomBytes } from 'node:crypto'
import { config } from './config.js'
import { logger } from './logger.js'

if (!config.jwtSecret) {
  config.jwtSecret = randomBytes(32).toString('hex')
  logger.warn('JWT_SECRET kosong — pakai random per-boot (token hangus saat restart). Set JWT_SECRET di .env!')
}

let pool = null

export async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: '+00:00',
    })
  }
  return pool
}

export async function dbQuery(sql, params = []) {
  const p = await getPool()
  const [rows] = await p.execute(sql, params)
  return rows
}

export async function pingDb() {
  const rows = await dbQuery('SELECT 1 AS ok')
  return rows?.[0]?.ok === 1
}
