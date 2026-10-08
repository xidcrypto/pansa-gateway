import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'
import { config } from './config.js'
import { logger } from './logger.js'
import { openapi } from './openapi.js'
import { pingDb } from './db.js'
import { migrate, seedAdmin } from './migrate.js'
import { authRequired } from './middleware/auth.js'
import { globalLimiter } from './middleware/rate.js'
import { sessionGuard } from './middleware/session.js'
import { authRoutes } from './routes/auth.js'
import { sessionRoutes } from './routes/sessions.js'
import { messageRoutes } from './routes/messages.js'
import { groupRoutes } from './routes/groups.js'
import { miscRoutes } from './routes/misc.js'
import { blastRoutes } from './routes/blast.js'
import { adminRoutes } from './routes/admin.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet({ crossOriginResourcePolicy: false }))
  app.use(cors({
    origin: config.corsOrigin === '*' ? '*' : config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: config.corsOrigin !== '*',
  }))
  app.use(express.json({ limit: '25mb' }))
  app.use(globalLimiter)

  // Publik: health + docs
  app.get('/health', async (req, res) => {
    let db = false
    try { db = await pingDb() } catch { /* tetap 200, flag db:false */ }
    res.json({ success: true, status: 'ok', db, uptime: process.uptime() })
  })
  app.get('/openapi.json', (req, res) => {
    res.json({ ...openapi, servers: [{ url: `http://localhost:${config.port}` }] })
  })
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
    customSiteTitle: 'Baileys Gateway API',
    swaggerOptions: { persistAuthorization: true },
  }))

  // Auth (login di-rate-limit di router)
  app.use('/auth', authRoutes)

  // Session butuh login. Guard kepemilikan dipasang per-route di router.
  app.use('/sessions', sessionRoutes)

  // Semua route di bawah /sessions/:session wajib login + pemilik/admin
  app.use('/sessions/:session', sessionGuard, messageRoutes)
  app.use('/sessions/:session/groups', sessionGuard, groupRoutes)
  app.use('/sessions/:session/blast', sessionGuard, blastRoutes)
  app.use('/sessions/:session', sessionGuard, miscRoutes)

  // Admin
  app.use('/admin', authRequired, adminRoutes)

  // 404
  app.use((req, res) => {
    res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} tidak ditemukan` })
  })

  // Error handler (jangan bocorkan detail internal ke client)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.output?.statusCode || 500
    const safe = status >= 400 && status < 500 ? err.message : 'Internal server error'
    if (status >= 500) logger.error({ err: err.message, stack: err.stack, path: req.path }, 'Request error')
    else logger.warn({ err: err.message, path: req.path }, 'Client error')
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: safe || 'Internal server error',
    })
  })

  return app
}

export async function initApp() {
  await migrate()
  await seedAdmin()
  return createApp()
}

export function startServer() {
  initApp()
    .then((app) => {
      const server = app.listen(config.port, () => {
        logger.info(`Baileys Gateway jalan di http://localhost:${config.port}`)
        if (!config.apiKey) logger.info('API_KEY kosong — akses pakai JWT login.')
        // Restore semua session yang belum logout (biar auto-connect habis restart server)
        import('./wa/session.js').then(async ({ startSession }) => {
          try {
            const { dbQuery } = await import('./db.js')
            const rows = await dbQuery(`SELECT id FROM sessions WHERE status != 'logged_out'`)
            for (const [i, r] of rows.entries()) {
              setTimeout(() => {
                startSession(r.id).catch((e) => logger.error({ session: r.id, e: e.message }, 'Restore failed'))
              }, i * 2000) // stagger 2 detik per session biar tidak membanjiri WA
            }
            if (rows.length) logger.info({ count: rows.length }, 'Restoring sessions...')
            // Resume blast yang kepotong restart
            const { resumeInterrupted } = await import('./wa/blast.js')
            resumeInterrupted()
          } catch (e) {
            logger.error({ err: e.message }, 'Session restore gagal')
          }
        })
      })
      return server
    })
    .catch((e) => {
      logger.error({ err: e.message }, 'Gagal init (DB belum jalan?). Set DB_* di .env lalu restart.')
      process.exit(1)
    })
}
