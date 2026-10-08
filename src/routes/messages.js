import { Router } from 'express'
import { asyncH, ok } from './_helpers.js'
import { getSession, getSock } from '../wa/session.js'
import { logMessage, recentFromDb } from '../wa/persist.js'
import { toJid } from '../jid.js'
import { resolveMedia } from '../wa/media.js'
import { MB } from '@rexxhayanasi/elaina-baileys'

export const messageRoutes = Router({ mergeParams: true })

function sid(req) {
  return req.params.session
}

function resultOf(sent, jid) {
  return { messageId: sent?.key?.id || null, to: jid, status: sent?.status || 'sent' }
}

// POST /sessions/:session/send/text  { to, text, replyTo? }
messageRoutes.post('/send/text', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, text, replyTo } = req.body || {}
  if (!to || !text) return res.status(400).json({ success: false, error: '"to" dan "text" wajib diisi' })
  const jid = toJid(to)
  const quoted = replyTo ? { key: { remoteJid: jid, id: replyTo, fromMe: false }, message: { conversation: '' } } : undefined
  const sent = await sock.sendMessage(jid, { text, ...(quoted ? { quoted } : {}) })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'text' })
  ok(res, r)
}))

// POST /sessions/:session/send/image  { to, caption?, media: {url|base64|dataUri|path}, ... }
messageRoutes.post('/send/image', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, caption, media = {}, ...rest } = req.body || {}
  if (!to) return res.status(400).json({ success: false, error: '"to" wajib diisi' })
  const jid = toJid(to)
  const { buffer, mimetype } = await resolveMedia(typeof media === 'string' ? { url: media } : media)
  const sent = await sock.sendMessage(jid, { image: buffer, mimetype, caption: caption || '', ...rest.mediaExtra })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'image' })
  ok(res, r)
}))

// POST /sessions/:session/send/video  { to, caption?, media }
messageRoutes.post('/send/video', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, caption, media = {}, gifPlayback } = req.body || {}
  if (!to) return res.status(400).json({ success: false, error: '"to" wajib diisi' })
  const jid = toJid(to)
  const { buffer, mimetype } = await resolveMedia(typeof media === 'string' ? { url: media } : media)
  const sent = await sock.sendMessage(jid, { video: buffer, mimetype, caption: caption || '', gifPlayback: !!gifPlayback })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'video' })
  ok(res, r)
}))

// POST /sessions/:session/send/audio  { to, media, ptt? }
messageRoutes.post('/send/audio', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, media = {}, ptt } = req.body || {}
  if (!to) return res.status(400).json({ success: false, error: '"to" wajib diisi' })
  const jid = toJid(to)
  const { buffer, mimetype } = await resolveMedia(typeof media === 'string' ? { url: media } : media)
  const sent = await sock.sendMessage(jid, { audio: buffer, mimetype, ptt: !!ptt })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'audio' })
  ok(res, r)
}))

// POST /sessions/:session/send/document  { to, filename?, media }
messageRoutes.post('/send/document', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, filename, media = {}, mimetype } = req.body || {}
  if (!to) return res.status(400).json({ success: false, error: '"to" wajib diisi' })
  const jid = toJid(to)
  const resolved = await resolveMedia(typeof media === 'string' ? { url: media } : media)
  const sent = await sock.sendMessage(jid, {
    document: resolved.buffer,
    mimetype: mimetype || resolved.mimetype,
    fileName: filename || resolved.filename || 'file',
  })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'document' })
  ok(res, r)
}))

// POST /sessions/:session/send/sticker  { to, media }
messageRoutes.post('/send/sticker', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, media = {} } = req.body || {}
  if (!to) return res.status(400).json({ success: false, error: '"to" wajib diisi' })
  const jid = toJid(to)
  const { buffer, mimetype } = await resolveMedia(typeof media === 'string' ? { url: media } : media)
  const sent = await sock.sendMessage(jid, { sticker: buffer, mimetype })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'sticker' })
  ok(res, r)
}))

// POST /sessions/:session/send/location  { to, latitude, longitude, name? }
messageRoutes.post('/send/location', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, latitude, longitude, name } = req.body || {}
  if (!to || latitude == null || longitude == null) {
    return res.status(400).json({ success: false, error: '"to", "latitude", "longitude" wajib diisi' })
  }
  const jid = toJid(to)
  const sent = await sock.sendMessage(jid, {
    location: { degreesLatitude: Number(latitude), degreesLongitude: Number(longitude), name: name || undefined },
  })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'location' })
  ok(res, r)
}))

// POST /sessions/:session/send/contact  { to, name, phone, ...vcard fields }
messageRoutes.post('/send/contact', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, name, phone } = req.body || {}
  if (!to || !name || !phone) return res.status(400).json({ success: false, error: '"to", "name", "phone" wajib diisi' })
  const jid = toJid(to)
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${String(phone).replace(/[^0-9]/g, '')}:${phone}\nEND:VCARD`
  const sent = await sock.sendMessage(jid, { contacts: { displayName: name, contacts: [{ vcard }] } })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'contact' })
  ok(res, r)
}))

// POST /sessions/:session/send/poll  { to, question, options[] }
messageRoutes.post('/send/poll', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, question, options } = req.body || {}
  if (!to || !question || !Array.isArray(options) || !options.length) {
    return res.status(400).json({ success: false, error: '"to", "question", "options[]" wajib diisi' })
  }
  const jid = toJid(to)
  const sent = await sock.sendMessage(jid, { poll: { name: question, values: options, selectableCount: 1 } })
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'poll' })
  ok(res, r)
}))

// ---------- Interactive (Elaina MessageBuilder) ----------

function applyButtons(b, btns = []) {
  for (const btn of btns) {
    const kind = btn.kind || btn.type || 'reply'
    switch (kind) {
      case 'reply': b.addReply(btn.text || '', btn.id || ''); break
      case 'url': b.addUrl(btn.text || '', btn.url || ''); break
      case 'copy': b.addCopy(btn.text || '', btn.code || ''); break
      case 'call': b.addCall(btn.text || '', btn.id || ''); break
      case 'reminder': b.addReminder(btn.text || '', btn.id || ''); break
      case 'cancelReminder': b.addCancelReminder(btn.text || '', btn.id || ''); break
      case 'address': b.addAddress(btn.text || '', btn.id || ''); break
      case 'location': b.addLocation(btn.options || {}); break
      case 'raw': b.addButton(btn.name || '', btn.params || {}); break
      default: b.addReply(btn.text || '', btn.id || '')
    }
  }
  return b
}

function applyHeader(b, body = {}) {
  if (body.title) b.setTitle(body.title)
  if (body.subtitle) b.setSubtitle(body.subtitle)
  if (body.text) b.setBody(body.text)
  if (body.footer) b.setFooter(body.footer)
  if (body.image) b.setImage(body.image)
  else if (body.video) b.setVideo(body.video)
  else if (body.document) b.setDocument(body.document)
  return b
}

// POST /sessions/:session/send/button
// { to, title?, body, footer?, image?, video?, buttons: [{kind:'reply|url|copy|call|...', text, id|url|code}] }
messageRoutes.post('/send/button', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, title, body, footer, image, video, buttons } = req.body || {}
  if (!to || !body) return res.status(400).json({ success: false, error: '"to" dan "body" wajib diisi' })
  if (!Array.isArray(buttons) || !buttons.length) {
    return res.status(400).json({ success: false, error: '"buttons[]" wajib diisi (min 1)' })
  }
  const jid = toJid(to)
  let b = new MB.Button(sock)
  b = applyHeader(b, { title, text: body, footer, image, video })
  b = applyButtons(b, buttons)
  const sent = await b.send(jid)
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'button' })
  ok(res, r)
}))

// POST /sessions/:session/send/list
// { to, title?, body, footer?, buttonText?, sections: [{title, rows:[{title, description?, id?}]}] }
messageRoutes.post('/send/list', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, title, body, footer, buttonText, sections } = req.body || {}
  if (!to || !body) return res.status(400).json({ success: false, error: '"to" dan "body" wajib diisi' })
  if (!Array.isArray(sections) || !sections.length) {
    return res.status(400).json({ success: false, error: '"sections[]" wajib diisi' })
  }
  const jid = toJid(to)
  const b = new MB.Button(sock)
  applyHeader(b, { title, text: body, footer })
  b.addSelection(buttonText || 'Pilih')
  for (const sec of sections) {
    b.makeSection(sec.title || '')
    for (const row of sec.rows || []) {
      b.makeRow(row.header || '', row.title || '', row.description || '', row.id || '')
    }
  }
  const sent = await b.send(jid)
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'list' })
  ok(res, r)
}))

// POST /sessions/:session/send/carousel
// { to, body?, footer?, cards: [{title?, body, image|video (wajib), buttons:[...]}] }
messageRoutes.post('/send/carousel', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, body, footer, cards } = req.body || {}
  if (!to) return res.status(400).json({ success: false, error: '"to" wajib diisi' })
  if (!Array.isArray(cards) || !cards.length) {
    return res.status(400).json({ success: false, error: '"cards[]" wajib diisi (min 1)' })
  }
  const jid = toJid(to)
  const built = []
  for (const c of cards) {
    if (!c.image && !c.video) {
      return res.status(400).json({ success: false, error: 'Setiap card wajib ada "image" atau "video"' })
    }
    let b = new MB.Button(sock)
    b = applyHeader(b, { title: c.title, text: c.body || c.text || '', image: c.image, video: c.video })
    b = applyButtons(b, c.buttons || [])
    built.push(await b.toCard())
  }
  const carousel = new MB.Carousel(sock)
  if (body) carousel.setBody(body)
  if (footer) carousel.setFooter(footer)
  carousel.addCard(built)
  const sent = await carousel.send(jid)
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'carousel' })
  ok(res, r)
}))

// POST /sessions/:session/send/buttonv2 (classic quick-reply buttons)
// { to, body, footer?, buttons: [{text, id?}] }
messageRoutes.post('/send/buttonv2', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, body, footer, title, subtitle, buttons } = req.body || {}
  if (!to || !body) return res.status(400).json({ success: false, error: '"to" dan "body" wajib diisi' })
  if (!Array.isArray(buttons) || !buttons.length) {
    return res.status(400).json({ success: false, error: '"buttons[]" wajib diisi (min 1)' })
  }
  const jid = toJid(to)
  const b = new MB.ButtonV2(sock)
  if (title) b.setTitle(title)
  if (subtitle) b.setSubtitle(subtitle)
  b.setBody(body)
  if (footer) b.setFooter(footer)
  for (const btn of buttons) b.addButton(btn.text || '', btn.id)
  const sent = await b.send(jid)
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'buttonv2' })
  ok(res, r)
}))

// ---------- Message management ----------

// POST /sessions/:session/react  { to, messageId, emoji }
messageRoutes.post('/react', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, messageId, emoji } = req.body || {}
  if (!to || !messageId) return res.status(400).json({ success: false, error: '"to" dan "messageId" wajib diisi' })
  const jid = toJid(to)
  await sock.sendMessage(jid, { react: { text: emoji || '', key: { remoteJid: jid, id: messageId, fromMe: false } } })
  ok(res, { messageId, reaction: emoji || null })
}))

// POST /sessions/:session/delete  { to, messageId }
messageRoutes.post('/delete', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, messageId } = req.body || {}
  if (!to || !messageId) return res.status(400).json({ success: false, error: '"to" dan "messageId" wajib diisi' })
  const jid = toJid(to)
  await sock.sendMessage(jid, { delete: { remoteJid: jid, id: messageId, fromMe: true } })
  ok(res, { deleted: messageId })
}))

// POST /sessions/:session/edit  { to, messageId, text }
messageRoutes.post('/edit', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, messageId, text } = req.body || {}
  if (!to || !messageId || !text) {
    return res.status(400).json({ success: false, error: '"to", "messageId", "text" wajib diisi' })
  }
  const jid = toJid(to)
  await sock.sendMessage(jid, {
    text,
    edit: { remoteJid: jid, id: messageId, fromMe: true },
  })
  ok(res, { edited: messageId })
}))

// POST /sessions/:session/forward  { to, messageId, source?, force? }
messageRoutes.post('/forward', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const s = getSession(id)
  const { to, messageId, source, force } = req.body || {}
  if (!to || !messageId) return res.status(400).json({ success: false, error: '"to" dan "messageId" wajib diisi' })
  const jid = toJid(to)
  const fromJid = source ? toJid(source) : jid
  // NOTE: forward by id needs the original message content; the store keeps recent ones.
  // For reliability, client should pass full content OR we fetch via relay of a minimal forward.
  // Here: fetch the source chat history is not available, so require content passthrough:
  const { content } = req.body || {}
  if (!content || typeof content !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'Forward butuh "content" (isi pesan asli dari webhook/store). Kirim { to, messageId, content }',
    })
  }
  const sent = await sock.sendMessage(jid, { forward: content, force: !!force })
  void messageId; void fromJid; void s
  const r = resultOf(sent, jid)
  await logMessage(id, 'out', { ...r, type: 'forward' })
  ok(res, r)
}))

// POST /sessions/:session/read  { to, messageIds: [] }
messageRoutes.post('/read', asyncH(async (req, res) => {
  const id = sid(req)
  const sock = getSock(id)
  const { to, messageIds } = req.body || {}
  if (!to || !Array.isArray(messageIds) || !messageIds.length) {
    return res.status(400).json({ success: false, error: '"to" dan "messageIds[]" wajib diisi' })
  }
  const jid = toJid(to)
  await sock.readMessages(messageIds.map((mid) => ({ remoteJid: jid, id: mid })))
  ok(res, { read: messageIds.length })
}))

// GET /sessions/:session/messages/incoming?limit=
messageRoutes.get('/messages/incoming', asyncH(async (req, res) => {
  const id = sid(req)
  ok(res, { messages: await recentFromDb(id, 'in', req.query.limit) })
}))

// GET /sessions/:session/messages/outgoing?limit=
messageRoutes.get('/messages/outgoing', asyncH(async (req, res) => {
  const id = sid(req)
  ok(res, { messages: await recentFromDb(id, 'out', req.query.limit) })
}))
