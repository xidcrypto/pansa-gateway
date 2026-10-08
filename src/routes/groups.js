import { Router } from 'express'
import { asyncH, ok } from './_helpers.js'
import { getSock } from '../wa/session.js'
import { toJid, normalizePhone } from '../jid.js'

export const groupRoutes = Router({ mergeParams: true })

const sid = (req) => req.params.session

// GET /sessions/:session/groups  (list participating)
groupRoutes.get('/', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const groups = await sock.groupFetchAllParticipating()
  ok(res, {
    groups: Object.values(groups || {}).map((g) => ({
      id: g.id, subject: g.subject, size: g.size,
      owner: g.owner, creation: g.creation, desc: g.desc || null,
    })),
  })
}))

// POST /sessions/:session/groups  { subject, participants: [phone...] }
groupRoutes.post('/', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const { subject, participants } = req.body || {}
  if (!subject) return res.status(400).json({ success: false, error: '"subject" wajib diisi' })
  const jids = (participants || []).map((p) => toJid(p))
  const g = await sock.groupCreate(subject, jids)
  ok(res, { group: { id: g.id, subject: g.subject, participants: g.participants } }, 201)
}))

// GET /sessions/:session/groups/:jid
groupRoutes.get('/:jid', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const jid = toJid(decodeURIComponent(req.params.jid))
  ok(res, { group: await sock.groupMetadata(jid) })
}))

// PATCH /sessions/:session/groups/:jid  { subject?, description? }
groupRoutes.patch('/:jid', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const jid = toJid(decodeURIComponent(req.params.jid))
  const { subject, description } = req.body || {}
  if (subject) await sock.groupUpdateSubject(jid, subject)
  if (description != null) await sock.groupUpdateDescription(jid, description)
  ok(res, { updated: jid })
}))

// POST /sessions/:session/groups/:jid/leave
groupRoutes.post('/:jid/leave', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  await sock.groupLeave(toJid(decodeURIComponent(req.params.jid)))
  ok(res, { left: true })
}))

// POST /sessions/:session/groups/:jid/participants  { action: add|remove|promote|demote, participants: [] }
groupRoutes.post('/:jid/participants', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const jid = toJid(decodeURIComponent(req.params.jid))
  const { action, participants } = req.body || {}
  if (!['add', 'remove', 'promote', 'demote'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action harus add|remove|promote|demote' })
  }
  const jids = (participants || []).map((p) => toJid(p))
  const result = await sock.groupParticipantsUpdate(jid, jids, action)
  ok(res, { result })
}))

// GET /sessions/:session/groups/:jid/invite  -> invite code + link
groupRoutes.get('/:jid/invite', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const jid = toJid(decodeURIComponent(req.params.jid))
  const code = await sock.groupInviteCode(jid)
  ok(res, { code, link: `https://chat.whatsapp.com/${code}` })
}))

// POST /sessions/:session/groups/:jid/invite/revoke
groupRoutes.post('/:jid/invite/revoke', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const jid = toJid(decodeURIComponent(req.params.jid))
  const code = await sock.groupRevokeInvite(jid)
  ok(res, { code, link: `https://chat.whatsapp.com/${code}` })
}))

// POST /sessions/:session/groups/join  { code | link }
groupRoutes.post('/join', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  let { code, link } = req.body || {}
  if (link && !code) code = String(link).split('/').pop()
  if (!code) return res.status(400).json({ success: false, error: '"code" atau "link" wajib diisi' })
  const jid = await sock.groupAcceptInvite(code)
  ok(res, { joined: jid })
}))

// GET /sessions/:session/groups/invite-info/:code
groupRoutes.get('/invite-info/:code', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  ok(res, { info: await sock.groupGetInviteInfo(req.params.code) })
}))

// POST /sessions/:session/groups/:jid/settings  { setting: announce|restrict|... }
groupRoutes.post('/:jid/settings', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const jid = toJid(decodeURIComponent(req.params.jid))
  const { setting } = req.body || {}
  if (!setting) return res.status(400).json({ success: false, error: '"setting" wajib diisi (cth: announce, restrict, not_announce, not_restrict)' })
  await sock.groupSettingUpdate(jid, setting)
  ok(res, { updated: jid, setting })
}))

// POST /sessions/:session/groups/:jid/ephemeral  { duration: 0|86400|604800|7776000 }
groupRoutes.post('/:jid/ephemeral', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const jid = toJid(decodeURIComponent(req.params.jid))
  await sock.groupToggleEphemeral(jid, Number(req.body?.duration || 0))
  ok(res, { updated: jid })
}))

// POST /sessions/:session/groups/:jid/requests  { action: list } | { action: approve|reject, participants: [] }
groupRoutes.post('/:jid/requests', asyncH(async (req, res) => {
  const sock = getSock(sid(req))
  const jid = toJid(decodeURIComponent(req.params.jid))
  const { action, participants } = req.body || {}
  if (action === 'list' || !action) {
    return ok(res, { requests: await sock.groupRequestParticipantsList(jid) })
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action harus list|approve|reject' })
  }
  const jids = (participants || []).map((p) => toJid(p))
  const result = await sock.groupRequestParticipantsUpdate(jid, jids, action)
  ok(res, { result })
}))

void normalizePhone
