import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { A1, boot, hook, ORIGIN, type Harness } from './helpers.js'

/** Availability for everyone who signs in: agents, supervisors and admins. Break and Away are real, persisted and never routed. */
let h: Harness
beforeAll(async () => { h = await boot() })
beforeEach(async () => { await h.reset() })

const VOICE = '/api/webhooks/at/voice'
const set = async (who: Awaited<ReturnType<Harness['as']>>, status: string) => h.send('PUT', '/api/presence', who, { status, languages: ['en'] })

describe('self-service status', () => {
  it('lets agents, supervisors and admins each set Available, Break and Away', async () => {
    for (const email of ['agent1@x.test', 'sup@x.test', 'admin@x.test']) {
      const who = await h.as(email)
      for (const status of ['available', 'break', 'away']) expect((await set(who, status)).status, `${email} ${status}`).toBe(204)
    }
  })

  it('refuses statuses only the server may set (busy, wrap-up) and unknown ones', async () => {
    const a = await h.as('agent1@x.test')
    for (const status of ['busy', 'acw', 'flying']) expect((await set(a, status)).status, status).toBe(400)
  })

  it('restores my own status after a reload, and answers 204 when I have none', async () => {
    const a = await h.as('agent1@x.test')
    expect((await h.get('/api/presence/me', a)).status).toBe(204)
    await set(a, 'break')
    const me = await h.get('/api/presence/me', a)
    expect(me.status).toBe(200)
    expect(me.json).toMatchObject({ status: 'break' })
  })

  it('reports the status that actually applies: a person on a live call stays busy', async () => {
    const a = await h.as('agent1@x.test')
    await set(a, 'available')
    await h.pool.query("update call_centre.agent_presence set status = 'busy' where agent_crm_id = $1", [A1])
    const r = await h.app.inject({ method: 'PUT', url: '/api/presence', headers: a.headers, payload: { status: 'available', languages: ['en'] } })
    expect(r.statusCode).toBe(204)
    expect(r.headers['x-presence-status']).toBe('busy')
  })

  it('removes my row when I sign out, for admins too', async () => {
    const adm = await h.as('admin@x.test')
    await set(adm, 'away')
    expect((await h.send('DELETE', '/api/presence', adm)).status).toBe(204)
    expect((await h.get('/api/presence/me', adm)).status).toBe(204)
  })
})

describe('Break and Away are not available for calls', () => {
  it('routes only to Available: Break and Away agents leave the caller with a callback', async () => {
    for (const status of ['break', 'away']) {
      await h.reset()
      const a = await h.as('agent1@x.test')
      await set(a, status)
      const routed = await hook(h, VOICE, { sessionId: `S-${status}`, isActive: '1', callerNumber: '+2348035550142', direction: 'inbound', dtmfDigits: '1' })
      expect(routed.body, status).not.toContain('<Dial')
    }
  })

  it('never routes or transfers to an admin, even one set to Available', async () => {
    const adm = await h.as('admin@x.test')
    await set(adm, 'available')
    const other = await h.as('agent2@x.test')
    await set(other, 'available')
    // the admin row exists and is flagged, but is not a transfer target and not a routing candidate
    const roster = (await h.get('/api/presence', await h.as('sup@x.test'))).json as { name: string; admin: boolean }[]
    expect(roster.some((r) => r.admin)).toBe(true)
    const available = (await h.get('/api/presence/available', await h.as('agent1@x.test'))).json as { agentId: string }[]
    expect(available.map((x) => x.agentId)).not.toContain(roster.find((r) => r.admin)!.name)
    const routed = await hook(h, VOICE, { sessionId: 'S-adm', isActive: '1', callerNumber: '+2348035550142', direction: 'inbound', dtmfDigits: '1' })
    const dialled = /phoneNumbers="([^"]+)"/.exec(routed.body)?.[1] ?? ''
    expect(dialled).not.toContain('admin')
  })

  it('keeps admins out of the agent roster flags: the roster marks them so screens can exclude them', async () => {
    const adm = await h.as('admin@x.test')
    await set(adm, 'break')
    const roster = (await h.get('/api/presence', await h.as('sup@x.test'))).json as { admin: boolean; status: string }[]
    expect(roster.find((r) => r.admin)).toMatchObject({ status: 'break', admin: true })
  })
})

describe('origin protection still applies', () => {
  it('refuses a status change from another origin', async () => {
    const a = await h.as('agent1@x.test')
    const r = await h.app.inject({ method: 'PUT', url: '/api/presence', headers: { ...a.headers, origin: 'https://evil.example' }, payload: { status: 'available', languages: ['en'] } })
    expect(r.statusCode).toBe(403)
    expect(ORIGIN).not.toBe('https://evil.example')
  })
})
