import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { DEFAULT_SAVED_REPLIES, handoverSchema, outagesSchema, pushPrefsUpdateSchema, pushSubscriptionSchema, savedRepliesSchema, type AppNotification, type HandoverView, type Outage } from '@beverly-call/shared'
import type { AppDeps } from '../app.js'
import { requireRole } from '../auth/guards.js'
import { auditAs } from '../audit/audit-request.js'
import { notifySweep } from '../jobs/notify-sweep.js'
import { webPushSender } from '../notify/notify.js'

interface NotifRow { id: string; category: 'esc' | 'cb' | 'sys'; tone: 'bad' | 'ye' | 'ok' | 'vi'; title: string; body: string; link: string | null; created_at: Date; read_at: Date | null }

let lastSweep = 0   // opportunistic sweep at most once a minute, so alerts appear even if the scheduler is late

/** Everything a signed-in staff member reads for themselves: alerts, handover, saved replies, outages and push. */
export const inboxRoutes = ({ env, pool, push }: AppDeps): FastifyPluginAsync => async (app) => {
  const staff = requireRole('agent', 'supervisor', 'admin')
  const send = push === undefined ? webPushSender(env) : push

  app.get('/notifications', { preHandler: staff }, async (req): Promise<AppNotification[]> => {
    if (Date.now() - lastSweep > 60_000) { lastSweep = Date.now(); await notifySweep(pool, send).catch(() => 0) }
    const me = req.session!.user
    const r = await pool.query<NotifRow>(
      `select n.id, n.category, n.tone, n.title, n.body, n.link, n.created_at, r.read_at
       from call_centre.notifications n left join call_centre.notification_reads r on r.user_crm_id = $1 and r.key = 'n:' || n.id::text
       where n.user_crm_id is null or n.user_crm_id = $1 order by n.created_at desc limit 40`, [me.id])
    return r.rows.map((x) => ({ key: `n:${x.id}`, category: x.category, tone: x.tone, title: x.title, body: x.body, link: x.link, at: x.created_at.toISOString(), unread: !x.read_at }))
  })

  app.post('/notifications/read', { preHandler: staff }, async (req, reply) => {
    const keys = z.object({ keys: z.array(z.string().max(80)).max(100).optional() }).safeParse(req.body)
    if (!keys.success) return reply.code(400).send({ error: 'Invalid request' })
    const me = req.session!.user.id
    await pool.query(
      `insert into call_centre.notification_reads (user_crm_id, key)
       select $1, 'n:' || id::text from call_centre.notifications
       where (user_crm_id is null or user_crm_id = $1) and ($2::text[] is null or 'n:' || id::text = any($2::text[]))
       on conflict do nothing`, [me, keys.data.keys ?? null])
    return reply.code(204).send()
  })

  app.get('/handover', { preHandler: staff }, async (): Promise<HandoverView> => {
    const r = await pool.query<{ author_name: string; body: string; created_at: Date }>('select author_name, body, created_at from call_centre.shift_handovers order by created_at desc limit 1')
    const x = r.rows[0]
    return { latest: x ? { by: x.author_name, body: x.body, at: x.created_at.toISOString() } : null }
  })

  app.post('/handover', { preHandler: staff }, async (req, reply) => {
    const body = handoverSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'A handover note is required (max 2000 characters)' })
    const me = req.session!.user
    await pool.query('insert into call_centre.shift_handovers (author_crm_id, author_name, body) values ($1,$2,$3)', [me.id, me.name, body.data.body])
    await pool.query(`insert into call_centre.notifications (category, tone, title, body, link) values ('sys','vi','Shift handover from ' || $1, $2, '/handover')`, [me.name, body.data.body.slice(0, 120)])
    await auditAs(pool, req, 'handover.save', 'handover', me.id)
    return reply.code(204).send()
  })

  app.get('/replies', { preHandler: staff }, async (): Promise<string[]> => {
    const r = await pool.query<{ value: unknown }>(`select value from call_centre.settings where key = 'saved_replies'`)
    const p = savedRepliesSchema.safeParse(r.rows[0]?.value)
    return p.success ? p.data : DEFAULT_SAVED_REPLIES
  })

  app.get('/outages', { preHandler: staff }, async (): Promise<Outage[]> => {
    const r = await pool.query<{ value: unknown }>(`select value from call_centre.settings where key = 'outages'`)
    const p = outagesSchema.safeParse(r.rows[0]?.value)
    return p.success ? p.data : []
  })

  /* ---- Web Push ---- */
  app.get('/push/key', { preHandler: staff }, async () => ({ publicKey: env.VAPID_PUBLIC_KEY ?? null }))

  app.post('/push/subscribe', { preHandler: staff }, async (req, reply) => {
    const body = pushSubscriptionSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid subscription' })
    await pool.query(
      `insert into call_centre.push_subscriptions (user_crm_id, endpoint, p256dh, auth, mute_esc, mute_cb, mute_sys, sounds) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (endpoint) do update set user_crm_id = excluded.user_crm_id, p256dh = excluded.p256dh, auth = excluded.auth,
         mute_esc = excluded.mute_esc, mute_cb = excluded.mute_cb, mute_sys = excluded.mute_sys, sounds = excluded.sounds`,
      [req.session!.user.id, body.data.endpoint, body.data.keys.p256dh, body.data.keys.auth,
        body.data.prefs?.mute.esc ?? false, body.data.prefs?.mute.cb ?? false, body.data.prefs?.mute.sys ?? false, body.data.prefs?.sounds ?? true])
    return reply.code(204).send()
  })

  /** Keeps this device's mute and sound choices in step with the app's Settings, for pushes that arrive while the app is closed. */
  app.put('/push/prefs', { preHandler: staff }, async (req, reply) => {
    const body = pushPrefsUpdateSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid preferences' })
    const r = await pool.query(
      'update call_centre.push_subscriptions set mute_esc = $3, mute_cb = $4, mute_sys = $5, sounds = $6 where endpoint = $1 and user_crm_id = $2',
      [body.data.endpoint, req.session!.user.id, body.data.mute.esc, body.data.mute.cb, body.data.mute.sys, body.data.sounds])
    return reply.code(r.rowCount ? 204 : 404).send()
  })

  app.post('/push/unsubscribe', { preHandler: staff }, async (req, reply) => {
    const body = z.object({ endpoint: z.string().url().max(600) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid request' })
    await pool.query('delete from call_centre.push_subscriptions where endpoint = $1 and user_crm_id = $2', [body.data.endpoint, req.session!.user.id])
    return reply.code(204).send()
  })
}
