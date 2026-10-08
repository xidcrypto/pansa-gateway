/**
 * Resolve media input (url | base64 | data-uri | local path) into a Buffer + mimetype.
 * Input: { url?, base64?, dataUri?, path?, mimetype?, filename? }
 *
 * Security:
 * - url: hanya http/https publik — IP privat/loopback/link-local DITOLAK (anti-SSRF).
 * - path: hanya di dalam MEDIA_DIR (sandbox, anti path traversal). Matikan via MEDIA_ALLOW_PATH=0.
 * - ukuran dibatasi MAX_MEDIA_BYTES.
 */
import path from 'node:path'
import { isIP } from 'node:net'
import { config } from '../config.js'

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg; codecs=opus', wav: 'audio/wav',
  m4a: 'audio/mp4', pdf: 'application/pdf', zip: 'application/zip',
}

function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null
  const h = (n) => buffer.subarray(0, n).toString('hex')
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (h(4) === '89504e47') return 'image/png'
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (buffer.subarray(0, 3).toString() === 'GIF') return 'image/gif'
  if (buffer.subarray(4, 8).toString() === 'ftyp') return 'video/mp4'
  if (buffer.subarray(0, 4).toString() === '%PDF') return 'application/pdf'
  if (buffer.subarray(0, 3).toString() === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (buffer.subarray(0, 4).toString() === 'OggS') return 'audio/ogg'
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE') return 'audio/wav'
  return null
}

function extOf(name = '') {
  const m = String(name).split('?')[0].match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : ''
}

export async function resolveMedia(input = {}) {
  let buffer = null
  let headerMime = null
  let filename = input.filename || null

  if (input.dataUri) {
    const m = String(input.dataUri).match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
    if (!m) throw new Error('dataUri tidak valid')
    headerMime = m[1] || null
    buffer = Buffer.from(m[3], m[2] ? 'base64' : 'utf8')
  } else if (input.base64) {
    buffer = Buffer.from(String(input.base64), 'base64')
  } else if (input.url) {
    buffer = await fetchPublicUrl(input.url)
    headerMime = buffer.mime
    buffer = buffer.data
    if (!filename) filename = String(input.url).split('?')[0].split('/').pop() || null
  } else if (input.path) {
    buffer = await readSandboxed(input.path)
    if (!filename) filename = path.basename(input.path)
  } else {
    throw new Error('Media wajib salah satu: url, base64, dataUri, atau path')
  }

  if (!buffer?.length) throw new Error('Media kosong / gagal dibaca')
  if (buffer.length > config.maxMediaBytes) {
    const err = new Error(`Media kebesaran (maks ${Math.round(config.maxMediaBytes / 1048576)}MB)`)
    err.status = 413
    throw err
  }

  const mimetype =
    input.mimetype ||
    sniff(buffer) ||
    EXT_MIME[extOf(filename || input.url || '')] ||
    headerMime ||
    'application/octet-stream'

  return { buffer, mimetype, filename }
}

function badInput(msg, status = 400) {
  const err = new Error(msg)
  err.status = status
  return err
}

/** Blokir IP privat/loopback/link-local + hostname sensitif (anti-SSRF) */
async function assertPublicUrl(raw) {
  let u
  try {
    u = new URL(String(raw))
  } catch {
    throw badInput('URL media tidak valid')
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw badInput('URL media harus http/https')
  const host = u.hostname.toLowerCase()
  if (['localhost', 'metadata.google.internal'].includes(host) || host.endsWith('.internal') || host.endsWith('.local')) {
    throw badInput('URL media tidak diizinkan (host internal)', 403)
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw badInput('URL media tidak diizinkan (IP privat)', 403)
    return
  }
  // Resolve DNS, tolak kalau mengarah ke IP privat
  const { lookup } = await import('node:dns/promises')
  let addrs = []
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    throw badInput('Host media tidak bisa di-resolve')
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw badInput('URL media tidak diizinkan (resolve ke IP privat)', 403)
  }
}

function isPrivateIp(ip) {
  if (ip.includes(':')) {
    // IPv6: loopback, link-local, unique-local
    const low = ip.toLowerCase()
    return low === '::1' || low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd')
  }
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254) ||
    p[0] === 0
  )
}

async function fetchPublicUrl(raw) {
  await assertPublicUrl(raw)
  const res = await fetch(raw, {
    signal: AbortSignal.timeout(60_000),
    redirect: 'follow',
    headers: { 'User-Agent': 'BaileysGateway/1.0' },
  }).catch(() => {
    throw badInput('Gagal download media (network error)')
  })
  // Cek redirect terakhir tidak ke host internal
  if (res.url) {
    try {
      await assertPublicUrl(res.url)
    } catch (e) {
      throw badInput('Redirect URL media tidak diizinkan', 403)
    }
  }
  if (!res.ok) throw badInput(`Gagal download media: HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > config.maxMediaBytes) {
    res.body?.cancel?.()
    const err = new Error(`Media kebesaran (maks ${Math.round(config.maxMediaBytes / 1048576)}MB)`)
    err.status = 413
    throw err
  }
  const mime = res.headers.get('content-type')?.split(';')[0] || null
  const data = Buffer.from(await res.arrayBuffer())
  return { data, mime }
}

/** path hanya boleh di dalam MEDIA_DIR */
async function readSandboxed(p) {
  if (process.env.MEDIA_ALLOW_PATH === '0') {
    throw badInput('Akses file lokal dimatikan (MEDIA_ALLOW_PATH=0)', 403)
  }
  const base = path.resolve(config.mediaDir)
  const target = path.resolve(base, String(p))
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw badInput('Path media harus di dalam folder MEDIA_DIR', 403)
  }
  const { readFile, mkdir } = await import('node:fs/promises')
  await mkdir(base, { recursive: true }).catch(() => {})
  try {
    return await readFile(target)
  } catch {
    throw badInput('File media tidak ditemukan')
  }
}
