import { Router } from 'express'
import { asyncH, ok } from './_helpers.js'
import { getSock } from '../wa/session.js'
import { toJid, normalizePhone } from '../jid.js'
import { downloadMediaMessage } from '@rexxhayanasi/elaina-baileys'

export const miscRoutes = Router({ mergeParams: true })

const sid = (req) => req.params.session

// ---------- Presence ----------
// POST /sessions/:session/presence  { to?, type: available|unavailable|composing|recording|paused }
miscRoutes.post('/presence', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const { to, type } = req.body || {}
  if (!type) return res.status(400).json({ success: false, error: '"type" wajib diisi' })
  await sock.sendPresenceUpdate(type, to ? toJid(to) : undefined)
  ok(res, { presence: type })
}))

miscRoutes.post('/subscribe', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const { to } = req.body || {}
  if (!to) return res.status(400).json({ success: false, error: '"to" wajib diisi' })
  await sock.presenceSubscribe(toJid(to))
  ok(res, { subscribed: to })
}))

// ---------- Contacts / checks ----------
// POST /sessions/:session/check  { phones: [] } -> onWhatsApp
miscRoutes.post('/check', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const { phones, phone } = req.body || {}
  const list = phones || (phone ? [phone] : [])
  if (!list.length) return res.status(400).json({ success: false, error: '"phones[]" atau "phone" wajib diisi' })
  const result = await sock.onWhatsApp(...list.map((p) => normalizePhone(p)))
  ok(res, { result })
}))

// GET /sessions/:session/avatar/:phone  -> profile picture url
miscRoutes.get('/avatar/:phone', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const url = await sock.profilePictureUrl(toJid(req.params.phone)).catch(() => null)
  ok(res, { url })
}))

// GET /sessions/:session/status/:phone  -> about/status text
miscRoutes.get('/status/:phone', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const result = await sock.fetchStatus(toJid(req.params.phone))
  ok(res, { result })
}))

// ---------- Blocklist ----------
// GET /sessions/:session/blocklist
miscRoutes.get('/blocklist', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  ok(res, { blocklist: await sock.fetchBlocklist() })
}))

// POST /sessions/:session/block  { phone, action: block|unblock }
miscRoutes.post('/block', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const { phone, action } = req.body || {}
  if (!phone || !['block', 'unblock'].includes(action)) {
    return res.status(400).json({ success: false, error: '"phone" dan action block|unblock wajib diisi' })
  }
  await sock.updateBlockStatus(toJid(phone), action)
  ok(res, { [action === 'block' ? 'blocked' : 'unblocked']: phone })
}))

// ---------- Profile ----------
// PATCH /sessions/:session/profile  { name?, status? }
miscRoutes.patch('/profile', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const { name, status } = req.body || {}
  if (name) await sock.updateProfileName(name)
  if (status != null) await sock.updateProfileStatus(status)
  ok(res, { updated: true })
}))

// POST /sessions/:session/profile/picture  { media: {url|base64|path} }
// NOTE: foto profil butuh sharp; kalau belum install, endpoint akan error jelas.
miscRoutes.post('/profile/picture', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const { media = {} } = req.body || {}
  const { resolveMedia } = await import('../wa/media.js')
  const { buffer } = await resolveMedia(typeof media === 'string' ? { url: media } : media)
  const me = sock.user?.id
  if (!me) return res.status(409).json({ success: false, error: 'Session belum connect' })
  await sock.updateProfilePicture(me, buffer)
  ok(res, { updated: true })
}))

// DELETE /sessions/:session/profile/picture
miscRoutes.delete('/profile/picture', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const me = sock.user?.id
  if (!me) return res.status(409).json({ success: false, error: 'Session belum connect' })
  await sock.removeProfilePicture(me)
  ok(res, { removed: true })
}))

// ---------- Media download ----------
// POST /sessions/:session/download  { message: <raw WA message object dari webhook> } -> base64
miscRoutes.post('/download', asyncH(async (req, res) => {
  const { message, asDataUri } = req.body || {}
  if (!message?.message && !message?.key) {
    return res.status(400).json({ success: false, error: '"message" (objek pesan mentah WA) wajib diisi' })
  }
  const buffer = await downloadMediaMessage(message, 'buffer', {})
  if (asDataUri) {
    const type = Object.keys(message.message || {}).find((k) => k.endsWith('Message')) || ''
    const mime =
      message.message?.[type]?.mimetype ||
      (type.startsWith('image') ? 'image/jpeg' : type.startsWith('video') ? 'video/mp4' : 'application/octet-stream')
    return ok(res, { dataUri: `data:${mime};base64,${buffer.toString('base64')}`, mimetype: mime })
  }
  ok(res, { base64: buffer.toString('base64'), bytes: buffer.length })
}))

// POST /sessions/:session/pair-code  (alias, body: { phone, code? }) — sama seperti /sessions/:id/pair
miscRoutes.post('/pair-code', asyncH(async (req, res) => {
  const { requestPairing } = await import('../wa/session.js')
  ok(res, await requestPairing(sid(req), req.body?.phone, req.body?.code))
}))
