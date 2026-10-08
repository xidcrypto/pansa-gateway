import { config } from './config.js'
import { logger } from './logger.js'

/**
 * Fire-and-forget webhook delivery.
 * Payload: { event, session, ts, data }
 */
export async function emitWebhook(sessionId, event, data = {}) {
  if (!config.webhookUrl) return
  const payload = { event, session: sessionId, ts: new Date().toISOString(), data }
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (config.webhookSecret) headers['x-webhook-secret'] = config.webhookSecret
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) logger.warn({ sessionId, event, status: res.status }, 'Webhook delivery failed')
  } catch (err) {
    logger.warn({ sessionId, event, err: err.message }, 'Webhook delivery error')
  }
}
