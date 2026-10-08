import { Router } from 'express'
import { asyncH, ok } from './_helpers.js'
import { authRequired, sessionOwner } from '../middleware/auth.js'
import {
  createCampaign, campaignDetail, listCampaigns,
  pauseCampaign, resumeCampaign, cancelCampaign,
} from '../wa/blast.js'
import { dbQuery } from '../db.js'

export const blastRoutes = Router({ mergeParams: true })

const sid = (req) => req.params.session

// POST /sessions/:session/blast — bikin campaign (auto-jalan)
// { label?, text, media?, buttons?, recipients, delayMin?, delayMax? }
blastRoutes.post('/', authRequired, sessionOwner, asyncH(async (req, res) => {
  const id = sid(req)
  // pastikan session live & open (getSock throw kalau belum)
  const { getSock } = await import('../wa/session.js')
  getSock(id)
  const { label, text, media, buttons, recipients, delayMin, delayMax } = req.body || {}
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ success: false, error: '"text" wajib diisi' })
  }
  if (media != null && typeof media !== 'object') {
    return res.status(400).json({ success: false, error: '"media" harus object { url|base64|dataUri|path }' })
  }
  if (buttons != null && !Array.isArray(buttons)) {
    return res.status(400).json({ success: false, error: '"buttons" harus array' })
  }
  if (Array.isArray(buttons) && buttons.length > 10) {
    return res.status(400).json({ success: false, error: 'Maksimal 10 button' })
  }
  const ownerId = req.sessionRow?.owner_id ?? (req.user.role === 'admin' ? null : req.user.id)
  const result = await createCampaign({
    sessionId: id,
    ownerId,
    label,
    text,
    media: media || null,
    buttons: buttons || [],
    recipients,
    delayMin,
    delayMax,
  })
  ok(res, { ...result, sessionId: id, status: 'running' }, 201)
}))

// GET /sessions/:session/blast — list campaign session ini
blastRoutes.get('/', authRequired, sessionOwner, asyncH(async (req, res) => {
  const isAdmin = req.user.role === 'admin'
  const lim = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
  const rows = isAdmin
    ? await dbQuery(
        `SELECT b.*, u.username AS owner_name FROM blasts b LEFT JOIN users u ON u.id = b.owner_id WHERE b.session_id = ? ORDER BY b.id DESC LIMIT ${lim}`,
        [sid(req)],
      )
    : await dbQuery(`SELECT * FROM blasts WHERE session_id = ? AND owner_id = ? ORDER BY id DESC LIMIT ${lim}`, [sid(req), req.user.id])
  const { campaignStats } = await import('../wa/blast.js')
  const out = []
  for (const r of rows) {
    const stats = await campaignStats(r.id)
    out.push({ id: r.id, label: r.label, status: r.status, total: r.total, ...stats, createdAt: r.created_at, finishedAt: r.finished_at })
  }
  ok(res, { campaigns: out })
}))

// GET /sessions/:session/blast/:cid — detail + statistik
blastRoutes.get('/:cid', authRequired, sessionOwner, asyncH(async (req, res) => {
  ok(res, { campaign: await campaignDetail(Number(req.params.cid), req.user.id, req.user.role === 'admin') })
}))

// GET /sessions/:session/blast/:cid/recipients?status=&limit= — daftar nomor + status
blastRoutes.get('/:cid/recipients', authRequired, sessionOwner, asyncH(async (req, res) => {
  const { getCampaign } = await import('../wa/blast.js')
  await getCampaign(Number(req.params.cid), req.user.id, req.user.role === 'admin')
  const status = req.query.status
  const lim = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  const rows = ['pending', 'sent', 'failed'].includes(status)
    ? await dbQuery(`SELECT id, phone, status, error, sent_at FROM blast_recipients WHERE campaign_id = ? AND status = ? ORDER BY id ASC LIMIT ${lim}`, [req.params.cid, status])
    : await dbQuery(`SELECT id, phone, status, error, sent_at FROM blast_recipients WHERE campaign_id = ? ORDER BY id ASC LIMIT ${lim}`, [req.params.cid])
  ok(res, { recipients: rows })
}))

// POST /sessions/:session/blast/:cid/pause | /resume | /cancel
for (const [action, fn] of [['pause', pauseCampaign], ['resume', resumeCampaign], ['cancel', cancelCampaign]]) {
  blastRoutes.post(`/:cid/${action}`, authRequired, sessionOwner, asyncH(async (req, res) => {
    ok(res, await fn(Number(req.params.cid), req.user.id, req.user.role === 'admin'))
  }))
}

export { listCampaigns }
