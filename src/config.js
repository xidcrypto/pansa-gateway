function num(v, def) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

export const config = {
  port: num(process.env.PORT, 3000),

  // Master key server-to-server (opsional). Kalau diset, header x-api-key = akses admin penuh.
  apiKey: process.env.API_KEY || '',

  // JWT untuk user frontend
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // MySQL
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'wa_gateway',
    connectionLimit: num(process.env.DB_POOL, 10),
  },

  // Seed admin pertama (dipakai hanya kalau tabel users masih kosong)
  adminUser: process.env.ADMIN_USER || '',
  adminPass: process.env.ADMIN_PASS || '',

  // Webhook global (fallback kalau user tidak set webhook sendiri)
  webhookUrl: process.env.WEBHOOK_URL || '',
  webhookSecret: process.env.WEBHOOK_SECRET || '',

  sessionDir: process.env.SESSION_DIR || './sessions',
  mediaDir: process.env.MEDIA_DIR || './media',
  maxMediaBytes: num(process.env.MAX_MEDIA_BYTES, 64 * 1024 * 1024),
  recentLimit: num(process.env.RECENT_LIMIT, 100),

  corsOrigin: process.env.CORS_ORIGIN || '*',

  rate: {
    windowMs: num(process.env.RATE_WINDOW_MS, 15 * 60 * 1000),
    max: num(process.env.RATE_MAX, 1000),
    authMax: num(process.env.RATE_AUTH_MAX, 30),
    pairMax: num(process.env.RATE_PAIR_MAX, 20),
  },
}
