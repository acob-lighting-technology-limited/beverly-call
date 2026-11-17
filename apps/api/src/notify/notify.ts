import * as webpush from 'web-push'
import type { Pool } from 'pg'
import type { Env } from '../config/env.js'


export interface NewNotification {
  userId?: string | null            // null or undefined = everyone with the call portal
  category: 'esc' | 'cb' | 'sys'
  tone?: 'bad' | 'ye' | 'ok' | 'vi'
  title: string
  body?: string
  link?: string
  dedupeKey?: string
  /**
   * A call that is ringing right now. Always pushed (never muted), marked high urgency with a short time-to-live so a
   * missed ring is dropped instead of arriving minutes later, and shown as a persistent, vibrating alert.
   */
  urgent?: boolean
}

/** Sends a payload to every saved subscription for the user. Dead subscriptions (404 or 410) are removed. */
export interface PushOptions { ttlSeconds: number; urgency: 'very-low' | 'low' | 'normal' | 'high' }
export type PushSender = (sub: { endpoint: string; p256dh: string; auth: string }, payload: string, options?: PushOptions) => Promise<void>

/** How long a push may wait for an offline device: a ringing call is stale after 30 seconds, anything else after a day. */
export const URGENT_PUSH: PushOptions = { ttlSeconds: 30, urgency: 'high' }
export const NORMAL_PUSH: PushOptions = { ttlSeconds: 86_400, urgency: 'normal' }

export function webPushSender(env: Env): PushSender | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  return async (s, payload, o = NORMAL_PUSH) => { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: o.ttlSeconds, urgency: o.urgency }) }
}

/**
 * Stores a notification (once per dedupeKey) and, when push is configured, delivers it to the target's devices.
 * Returns true when a new notification was created.
 */
export async function notify(pool: Pool, send: PushSender | null, n: NewNotification): Promise<boolean> {
  const r = await pool.query(
    `insert into call_centre.notifications (user_crm_id, category, tone, title, body, link, dedupe_key)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (dedupe_key) do nothing returning id`,
    [n.userId ?? null, n.category, n.tone ?? 'vi', n.title, n.body ?? '', n.link ?? null, n.dedupeKey ?? null])
  if (!r.rowCount) return false
  if (send) {
    const subs = await pool.query<{ id: string; endpoint: string; p256dh: string; auth: string; mute_esc: boolean; mute_cb: boolean; mute_sys: boolean; sounds: boolean }>(
      `select id, endpoint, p256dh, auth, mute_esc, mute_cb, mute_sys, sounds from call_centre.push_subscriptions${n.userId ? ' where user_crm_id = $1' : ''}`,
      n.userId ? [n.userId] : [])
    for (const s of subs.rows) {
      // A device that muted this category is not pushed to (the browser cannot be asked while the app is closed). Ringing calls ignore mutes.
      if (!n.urgent && ({ esc: s.mute_esc, cb: s.mute_cb, sys: s.mute_sys })[n.category]) continue
      const payload = JSON.stringify({
        title: n.title, body: n.body ?? '', link: n.link ?? '/', category: n.category, urgent: Boolean(n.urgent), silent: !s.sounds,
        tag: n.urgent ? 'incoming-call' : (n.dedupeKey ?? `${n.category}:${n.title}`).slice(0, 120),
      })
      try { await send(s, payload, n.urgent ? URGENT_PUSH : NORMAL_PUSH) }
      catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) await pool.query('delete from call_centre.push_subscriptions where id = $1', [s.id])
      }
    }
  }
  return true
}
