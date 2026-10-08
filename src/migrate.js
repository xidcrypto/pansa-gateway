import bcrypt from 'bcryptjs'
import { dbQuery } from './db.js'
import { config } from './config.js'
import { logger } from './logger.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  active TINYINT(1) NOT NULL DEFAULT 1,
  webhook_url VARCHAR(512) NULL,
  webhook_secret VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_id INT UNSIGNED NULL,
  label VARCHAR(128) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'connecting',
  phone VARCHAR(24) NULL,
  wa_name VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sessions_owner (owner_id),
  INDEX idx_sessions_status (status),
  CONSTRAINT fk_sessions_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  direction ENUM('in','out') NOT NULL,
  wa_id VARCHAR(128) NULL,
  remote_jid VARCHAR(128) NULL,
  msg_type VARCHAR(64) NULL,
  text_body TEXT NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_messages_session (session_id, created_at),
  INDEX idx_messages_remote (remote_jid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blasts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  owner_id INT UNSIGNED NULL,
  label VARCHAR(128) NULL,
  text_body TEXT NOT NULL,
  media_json JSON NULL,
  buttons_json JSON NULL,
  total INT UNSIGNED NOT NULL DEFAULT 0,
  delay_min INT UNSIGNED NOT NULL DEFAULT 3000,
  delay_max INT UNSIGNED NOT NULL DEFAULT 8000,
  status ENUM('queued','running','paused','done','cancelled','failed') NOT NULL DEFAULT 'queued',
  error VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  INDEX idx_blasts_owner (owner_id, created_at),
  INDEX idx_blasts_session (session_id, created_at),
  INDEX idx_blasts_status (status),
  CONSTRAINT fk_blasts_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blast_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id BIGINT UNSIGNED NOT NULL,
  phone VARCHAR(24) NOT NULL,
  vars JSON NULL,
  status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  error VARCHAR(512) NULL,
  sent_at TIMESTAMP NULL,
  INDEX idx_recipients_campaign (campaign_id, status, id),
  CONSTRAINT fk_recipients_campaign FOREIGN KEY (campaign_id) REFERENCES blasts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

export async function migrate() {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await dbQuery(stmt)
  }
  logger.info('DB schema OK (users, sessions, messages)')
}

export async function seedAdmin() {
  const rows = await dbQuery('SELECT COUNT(*) AS c FROM users')
  if (rows[0].c > 0) return null
  const username = config.adminUser || 'admin'
  let password = config.adminPass
  let generated = false
  if (!password) {
    // Generate sekali, tampilkan di console — admin wajib ganti setelah login
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    password = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    generated = true
  }
  const hash = await bcrypt.hash(password, 10)
  await dbQuery(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`, [username, hash])
  logger.warn({ username }, generated ? `Seed admin dibuat. PASSWORD: ${password} — segera ganti!` : 'Seed admin dibuat dari ADMIN_USER/ADMIN_PASS')
  return { username, password: generated ? password : undefined }
}
