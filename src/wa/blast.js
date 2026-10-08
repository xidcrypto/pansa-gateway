/**
 * Blast engine: antrian campaign pengiriman massal.
 * - 1 campaign = 1 pesan (text + optional image + optional buttons) ke N nomor
 * - Worker jalan di background, delay acak antar kirim (anti-ban), concurrency 1 per worker
 * - Variabel personalisasi: {{nama}}, {{nomor}} dari kolom recipients[i].vars
 */
import { getSock } from './session.js'
import { MB } from '@rexxhayanasi/elaina-baileys'
import { toJid, normalizePhone } from '../jid.js'
import { resolveMedia } from './media.js'
import { logMessage } from './persist.js'
import { dbQuery } from '../db.js'
import { logger } from '../logger.js'
import { emitSessionEvent } from './persist.js'

const workers = new Map() // campaignId -> { stop: boolean, running: boolean }

function renderVars(text, vars = {}) {
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => vars[k] ?? m)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function parseRecipients(input) {
  // Terima: array string/array object, atau string dipisah koma/newline
  let list = []
  if (Array.isArray(input)) list = input
  else if (typeof input === 'string') list = input.split(/[\n,;]+/)
  else throw new Error('"recipients" harus array atau string (pisah koma/baris baru)')

  const seen = new Set()
  const out = []
  for (const item of list) {
    let phone = ''
    let vars = {}
    if (typeof item === 'string') {
      phone = normalizePhone(item)
    } else if (item && typeof item === 'object') {
      phone = normalizePhone(item.phone || item.nomor || item.number || '')
      vars = item.vars || item.data || {}
      if (item.nama && !vars.nama) vars = { ...vars, nama: item.nama }
      if (item.name && !vars.nama) vars = { ...vars, nama: item.name }
    }
    if (phone.length < 9 || phone.length > 15) continue // skip yang jelas invalid
    if (seen.has(phone)) continue
    seen.add(phone)
    out.push({ phone, vars })
  }
  return out
}

export async function createCampaign({ sessionId, ownerId, label, text, media, buttons, recipients, delayMin = 3000, delayMax = 8000 }) {
  const parsed = parseRecipients(recipients)
  if (!parsed.length) {
    const err = new Error('Tidak ada nomor valid di recipients (min 1)')
    err.status = 400
    throw err
  }
  if (parsed.length > 50000) {
    const err = new Error('Maksimal 50.000 nomor per campaign')
    err.status = 400
    throw err
  }
  const result = await dbQuery(
    `INSERT INTO blasts (session_id, owner_id, label, text_body, media_json, buttons_json, total, delay_min, delay_max, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
    [
      sessionId, ownerId, label || null, text,
      media ? JSON.stringify(media) : null,
      buttons?.length ? JSON.stringify(buttons) : null,
      parsed.length,
      Math.max(500, Number(delayMin) || 3000),
      Math.max(Number(delayMax) || 8000, Math.max(500, Number(delayMin) || 3000)),
    ],
  )
  const campaignId = result.insertId
  const values = parsed.map((r) => [campaignId, r.phone, JSON.stringify(r.vars || {})])
  // insert batch 1000
  for (let i = 0; i < values.length; i += 1000) {
    const chunk = values.slice(i, i + 1000)
    await dbQuery(
      `INSERT INTO blast_recipients (campaign_id, phone, vars) VALUES ${chunk.map(() => '(?, ?, ?)').join(',')}`,
      chunk.flat(),
    )
  }
  // jalan otomatis
  runWorker(campaignId).catch((e) => logger.error({ campaignId, e: e.message }, 'Blast worker error'))
  return { campaignId, total: parsed.length }
}

export async function getCampaign(campaignId, ownerId, isAdmin) {
  const rows = await dbQuery(
    `SELECT b.*, u.username AS owner_name FROM blasts b LEFT JOIN users u ON u.id = b.owner_id WHERE b.id = ? LIMIT 1`,
    [campaignId],
  )
  const c = rows[0]
  if (!c) {
    const err = new Error('Campaign tidak ditemukan')
    err.status = 404
    throw err
  }
  if (!isAdmin && c.owner_id !== ownerId) {
    const err = new Error('Bukan campaign milikmu')
    err.status = 403
    throw err
  }
  return c
}

export async function campaignStats(campaignId) {
  const rows = await dbQuery(
    `SELECT status, COUNT(*) AS c FROM blast_recipients WHERE campaign_id = ? GROUP BY status`,
    [campaignId],
  )
  const stats = { pending: 0, sent: 0, failed: 0 }
  for (const r of rows) stats[r.status] = r.c
  return stats
}

function publicCampaign(row, stats) {
  return {
    id: row.id,
    sessionId: row.session_id,
    ownerId: row.owner_id,
    ownerName: row.owner_name || null,
    label: row.label,
    status: row.status,
    total: row.total,
    ...stats,
    delayMin: row.delay_min,
    delayMax: row.delay_max,
    error: row.error || null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

export async function campaignDetail(campaignId, ownerId, isAdmin) {
  const c = await getCampaign(campaignId, ownerId, isAdmin)
  const stats = await campaignStats(campaignId)
  return publicCampaign(c, stats)
}

export async function listCampaigns(ownerId, isAdmin, limit = 20) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const rows = isAdmin
    ? await dbQuery(
        `SELECT b.*, u.username AS owner_name FROM blasts b LEFT JOIN users u ON u.id = b.owner_id ORDER BY b.id DESC LIMIT ${lim}`,
      )
    : await dbQuery(`SELECT * FROM blasts WHERE owner_id = ? ORDER BY id DESC LIMIT ${lim}`, [ownerId])
  const out = []
  for (const r of rows) {
    out.push(publicCampaign(r, await campaignStats(r.id)))
  }
  return out
}

export async function pauseCampaign(campaignId, ownerId, isAdmin) {
  await getCampaign(campaignId, ownerId, isAdmin) // cek akses
  const w = workers.get(campaignId)
  if (w) w.stop = true
  await dbQuery(`UPDATE blasts SET status = 'paused' WHERE id = ? AND status IN ('queued','running')`, [campaignId])
  return { paused: campaignId }
}

export async function resumeCampaign(campaignId, ownerId, isAdmin) {
  const c = await getCampaign(campaignId, ownerId, isAdmin)
  if (!['paused', 'failed'].includes(c.status)) {
    const err = new Error(`Campaign status "${c.status}" tidak bisa di-resume`)
    err.status = 400
    throw err
  }
  await dbQuery(`UPDATE blasts SET status = 'queued', error = NULL WHERE id = ?`, [campaignId])
  runWorker(campaignId).catch((e) => logger.error({ campaignId, e: e.message }, 'Blast resume error'))
  return { resumed: campaignId }
}

export async function cancelCampaign(campaignId, ownerId, isAdmin) {
  await getCampaign(campaignId, ownerId, isAdmin)
  const w = workers.get(campaignId)
  if (w) w.stop = true
  await dbQuery(`UPDATE blasts SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id = ?`, [campaignId])
  await dbQuery(`UPDATE blast_recipients SET status = 'failed', error = 'cancelled' WHERE campaign_id = ? AND status = 'pending'`, [campaignId])
  return { cancelled: campaignId }
}

function asVars(v) {
  if (!v) return {}
  if (typeof v === 'object') return v
  try {
    return JSON.parse(v)
  } catch {
    return {}
  }
}

function asJson(v) {
  if (!v) return null
  if (typeof v === 'object') return v
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

async function buildAndSend(sock, sessionId, recipient, campaign) {
  const vars = { nomor: recipient.phone, ...asVars(recipient.vars) }
  const text = renderVars(campaign.text_body, vars)
  const jid = toJid(recipient.phone)
  const media = asJson(campaign.media_json)
  const hasMedia = !!media
  const buttons = asJson(campaign.buttons_json) || []

  // 4 mode:
  // A. text only       -> sendMessage text
  // B. text + image    -> sendMessage image+caption
  // C. text + buttons  -> MB.Button text (+header image optional)
  // D. text + image + buttons -> MB.Button + setImage
  let sent
  let type = 'blast-text'

  if (!buttons.length && !hasMedia) {
    sent = await sock.sendMessage(jid, { text })
  } else if (!buttons.length && hasMedia) {
    const { buffer, mimetype } = await resolveMedia(media)
    sent = await sock.sendMessage(jid, { image: buffer, mimetype, caption: text })
    type = 'blast-image'
  } else {
    const b = new MB.Button(sock).setBody(text)
    if (hasMedia) {
      if (media.url || media.path) {
        // Button.setImage terima URL/path langsung (di-upload builder)
        b.setImage(media.url || media.path)
        type = 'blast-image-button'
      } else if (media.base64 || media.dataUri) {
        // base64 -> buffer dulu. Builder setImage butuh url/buffer; buffer OK
        const { buffer } = await resolveMedia(media)
        b.setImage(buffer)
        type = 'blast-image-button'
      }
    } else {
      type = 'blast-button'
    }
    for (const btn of buttons) {
      const kind = btn.kind || 'reply'
      if (kind === 'url') b.addUrl(btn.text || '', btn.url || '')
      else if (kind === 'copy') b.addCopy(btn.text || '', btn.code || '')
      else if (kind === 'call') b.addCall(btn.text || '', btn.id || '')
      else b.addReply(btn.text || '', renderVars(btn.id || '', vars))
    }
    sent = await b.send(jid)
  }

  const r = { messageId: sent?.key?.id || null, to: jid }
  await logMessage(sessionId, 'out', { ...r, type, campaignId: campaign.id })
  return r
}

async function runWorker(campaignId) {
  if (workers.get(campaignId)?.running) return // sudah jalan
  const worker = { stop: false, running: true }
  workers.set(campaignId, worker)

  try {
    const rows = await dbQuery(`SELECT * FROM blasts WHERE id = ? LIMIT 1`, [campaignId])
    const campaign = rows[0]
    if (!campaign || !['queued', 'running'].includes(campaign.status)) {
      workers.delete(campaignId)
      return
    }
    await dbQuery(`UPDATE blasts SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?`, [campaignId])
    emitSessionEvent(campaign.session_id, 'blast.started', { campaignId }).catch(() => {})

    const sock = getSock(campaign.session_id)
    const delayMin = campaign.delay_min || 3000
    const delayMax = campaign.delay_max || 8000

    for (;;) {
      if (worker.stop) break
      const recs = await dbQuery(
        `SELECT * FROM blast_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1`,
        [campaignId],
      )
      if (!recs.length) break
      const rec = recs[0]
      try {
        await buildAndSend(sock, campaign.session_id, rec, campaign)
        await dbQuery(`UPDATE blast_recipients SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`, [rec.id])
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 500)
        logger.warn({ campaignId, phone: rec.phone, e: msg }, 'Blast send failed')
        await dbQuery(`UPDATE blast_recipients SET status = 'failed', error = ? WHERE id = ?`, [msg, rec.id])
        // 429 / rate-limit dari WA -> istirahat lebih lama sebelum lanjut
        if (/429|rate|limit|banned/i.test(msg)) {
          await dbQuery(`UPDATE blasts SET status = 'paused', error = ? WHERE id = ?`, [`Auto-pause: ${msg}`, campaignId])
          emitSessionEvent(campaign.session_id, 'blast.paused', { campaignId, reason: msg }).catch(() => {})
          break
        }
      }
      // delay acak biar pola kirim natural
      const wait = delayMin + Math.random() * Math.max(0, delayMax - delayMin)
      await sleep(wait)
    }

    const stats = await campaignStats(campaignId)
    const done = stats.pending === 0
    if (!worker.stop && done) {
      await dbQuery(`UPDATE blasts SET status = 'done', finished_at = CURRENT_TIMESTAMP WHERE id = ?`, [campaignId])
      emitSessionEvent(campaign.session_id, 'blast.done', { campaignId, ...stats }).catch(() => {})
    } else if (worker.stop) {
      await dbQuery(`UPDATE blasts SET status = 'paused' WHERE id = ? AND status = 'running'`, [campaignId])
    }
  } catch (e) {
    await dbQuery(`UPDATE blasts SET status = 'failed', error = ? WHERE id = ?`, [String(e?.message || e).slice(0, 500), campaignId]).catch(() => {})
    logger.error({ campaignId, e: e.message }, 'Blast worker fatal')
  } finally {
    workers.delete(campaignId)
  }
}

// Resume campaign yang masih queued/running saat server restart
export async function resumeInterrupted() {
  try {
    const rows = await dbQuery(`SELECT id FROM blasts WHERE status IN ('queued','running')`)
    for (const [i, r] of rows.entries()) {
      setTimeout(() => runWorker(r.id).catch(() => {}), i * 3000)
    }
    if (rows.length) logger.info({ count: rows.length }, 'Resuming interrupted blasts...')
  } catch (e) {
    logger.warn({ e: e.message }, 'resumeInterrupted gagal (tabel blast belum ada?)')
  }
}
