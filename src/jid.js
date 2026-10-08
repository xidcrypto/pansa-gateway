/**
 * Phone number / group / channel -> JID helpers
 */

/** Normalize a phone number to digits-only international format */
export function normalizePhone(input) {
  if (!input) return ''
  return String(input).replace(/[^0-9]/g, '')
}

/**
 * Convert user input to a WhatsApp JID.
 * - already contains '@' -> returned as-is
 * - >15 digits -> group (@g.us), E.164 phones max out at 15 digits
 * - otherwise -> personal chat (@s.whatsapp.net)
 */
export function toJid(to) {
  const raw = String(to || '').trim()
  if (!raw) throw new Error('Parameter "to" wajib diisi')
  if (raw.includes('@')) return raw
  const digits = normalizePhone(raw)
  if (!digits) throw new Error(`Nomor/JID "${to}" tidak valid`)
  if (digits.length > 15) return `${digits}@g.us`
  return `${digits}@s.whatsapp.net`
}

/** JID -> short display (628x / group id) */
export function shortJid(jid) {
  return String(jid || '').split('@')[0]
}
