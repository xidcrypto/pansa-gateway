import rateLimit from 'express-rate-limit'
import { config } from '../config.js'

/** Global: longgar, anti-banjir */
export const globalLimiter = rateLimit({
  windowMs: config.rate.windowMs,
  max: config.rate.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Rate limit, coba lagi nanti' },
})

/** Pairing: diketatkan (anti brute-force kode) */
export const pairLimiter = rateLimit({
  windowMs: config.rate.windowMs,
  max: config.rate.pairMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Terlalu banyak minta pairing code, coba lagi nanti' },
})

/** Kirim pesan per session: cegah satu user spam gateway */
export const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.id ?? 'anon'}:${req.params.session ?? ''}`,
  message: { success: false, error: 'Terlalu banyak kirim pesan, pelankan' },
})
