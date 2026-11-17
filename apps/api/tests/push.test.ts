import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { notify, NORMAL_PUSH, URGENT_PUSH, type PushOptions } from '../src/notify/notify.js'
import { A1, A2, boot, hook, type Harness } from './helpers.js'

interface Sent { endpoint: string; payload: Record<string, unknown>; options: PushOptions | undefined }

describe('push while the app is closed', () => {
  let h: Harness
  const sent: Sent[] = []
  const sender = async (s: { endpoint: string }, payload: string, options?: PushOptions): Promise<void> => { sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) as Record<string, unknown>, options }) }
  const sub = (endpoint: string, userId: string, prefs: { esc?: boolean; cb?: boolean; sys?: boolean; sounds?: boolean } = {}) =>
    h.pool.query(
      `insert into call_centre.push_subscriptions (user_crm_id, endpoint, p256dh, auth, mute_esc, mute_cb, mute_sys, sounds) values ($1,$2,'p','a',$3,$4,$5,$6)`,
      [userId, endpoint, prefs.esc ?? false, prefs.cb ?? false, prefs.sys ?? false, prefs.sounds ?? true])

  beforeAll(async () => { h = await boot() })
  beforeEach(async () => { await h.reset(); sent.length = 0 })
  afterAll(async () => { await h.app.close() })

  it('subscribing stores this device\'s preferences and updating them changes only that device and user', async () => {
    const a = await h.as('agent1@x.test'); const b = await h.as('agent2@x.test')
    const body = { endpoint: 'https://push.test/a1', keys: { p256dh: 'p', auth: 'a' }, prefs: { mute: { esc: true, cb: false, sys: false }, sounds: false } }
    expect((await h.send('POST', '/api/push/subscribe', a, body)).status).toBe(204)
    const row = () => h.pool.query('select mute_esc, mute_cb, mute_sys, sounds from call_centre.push_subscriptions where endpoint = $1', ['https://push.test/a1'])
    expect((await row()).rows[0]).toEqual({ mute_esc: true, mute_cb: false, mute_sys: false, sounds: false })

    expect((await h.send('PUT', '/api/push/prefs', a, { endpoint: 'https://push.test/a1', mute: { esc: false, cb: true, sys: true }, sounds: true })).status).toBe(204)
    expect((await row()).rows[0]).toEqual({ mute_esc: false, mute_cb: true, mute_sys: true, sounds: true })

    // Someone else cannot change a device that is not theirs.
    expect((await h.send('PUT', '/api/push/prefs', b, { endpoint: 'https://push.test/a1', mute: { esc: true, cb: true, sys: true }, sounds: false })).status).toBe(404)
    expect((await row()).rows[0]).toEqual({ mute_esc: false, mute_cb: true, mute_sys: true, sounds: true })
    expect((await h.send('PUT', '/api/push/prefs', a, { endpoint: 'not a url', mute: {}, sounds: 'yes' })).status).toBe(400)
  })

  it('a subscription without preferences defaults to nothing muted and sounds on', async () => {
    const a = await h.as('agent1@x.test')
    await h.send('POST', '/api/push/subscribe', a, { endpoint: 'https://push.test/plain', keys: { p256dh: 'p', auth: 'a' } })
    expect((await h.pool.query('select mute_esc, mute_cb, mute_sys, sounds from call_centre.push_subscriptions')).rows[0]).toEqual({ mute_esc: false, mute_cb: false, mute_sys: false, sounds: true })
  })

  it('does not push a category the device muted, but still pushes the others, and honours silent devices', async () => {
    await sub('https://push.test/muted', A1, { sys: true })
    await sub('https://push.test/quiet', A1, { sounds: false })
    await notify(h.pool, sender, { userId: A1, category: 'sys', title: 'Coaching', link: '/call', dedupeKey: 'k1' })
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.test/quiet'])
    expect(sent[0]!.payload).toMatchObject({ title: 'Coaching', category: 'sys', urgent: false, silent: true, link: '/call' })
    expect(sent[0]!.options).toEqual(NORMAL_PUSH)
    sent.length = 0
    await notify(h.pool, sender, { userId: A1, category: 'esc', title: 'Escalated', dedupeKey: 'k2' })
    expect(sent.map((s) => s.endpoint).sort()).toEqual(['https://push.test/muted', 'https://push.test/quiet'])
  })

  it('a ringing call is always pushed, even to a device that muted system alerts, with a 30 second life and high urgency', async () => {
    await sub('https://push.test/muted', A1, { sys: true, sounds: true })
    await notify(h.pool, sender, { userId: A1, category: 'sys', tone: 'ok', title: 'Incoming call', body: '0803', link: '/call', urgent: true })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.options).toEqual(URGENT_PUSH)
    expect(URGENT_PUSH).toEqual({ ttlSeconds: 30, urgency: 'high' })
    expect(sent[0]!.payload).toMatchObject({ urgent: true, tag: 'incoming-call', silent: false })
  })

  it('a push goes only to the person it is for', async () => {
    await sub('https://push.test/a1', A1)
    await sub('https://push.test/a2', A2)
    await notify(h.pool, sender, { userId: A2, category: 'sys', title: 'For agent 2', dedupeKey: 'k3' })
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.test/a2'])
  })

  it('an incoming call from the carrier pushes an urgent alert to the agent who was routed the call', async () => {
    const a = await h.as('agent1@x.test')
    await h.send('PUT', '/api/presence', a, { status: 'available', languages: ['en'] })
    await h.send('POST', '/api/push/subscribe', a, { endpoint: 'https://push.test/agent1', keys: { p256dh: 'p', auth: 'a' } })
    await hook(h, '/api/webhooks/at/voice', { sessionId: 'PUSH1', isActive: '1', callerNumber: '+2348035550142', direction: 'inbound' })
    await hook(h, '/api/webhooks/at/voice', { sessionId: 'PUSH1', isActive: '1', callerNumber: '+2348035550142', direction: 'inbound', dtmfDigits: '1' })
    const call = h.fakes.pushed.map((p) => JSON.parse(p) as Record<string, unknown>).find((p) => p.title === 'Incoming call')
    expect(call).toMatchObject({ urgent: true, tag: 'incoming-call', link: '/call', body: '+2348035550142' })
  })
})
