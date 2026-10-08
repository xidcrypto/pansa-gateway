/**
 * Guard: semua route di bawah /sessions/:session wajib login + pemilik/admin.
 * Dipasang sekali di server.js sebelum sub-router, jadi tiap route otomatis terlindungi.
 */
import { authRequired, sessionOwner } from './auth.js'
import { sendLimiter } from './rate.js'

function isSendRoute(req) {
  return req.path.includes('/send/') || req.path === '/send/text'
}

export function sessionGuard(req, res, next) {
  authRequired(req, res, (err) => {
    if (err) return next(err)
    sessionOwner(req, res, (err2) => {
      if (err2) return next(err2)
      if (req.method === 'POST' && isSendRoute(req)) {
        return sendLimiter(req, res, next)
      }
      return next()
    })
  })
}
