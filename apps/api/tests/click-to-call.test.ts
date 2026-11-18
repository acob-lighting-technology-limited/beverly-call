import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { notifySweep, STALE_OUTBOUND_HOURS } from '../src/jobs/notify-sweep.js'
import { A1, boot, uid, type Harness } from './helpers.js'

/** Click to call: the agent dials from their own phone, and Beverly Call runs the call around it. */
let h: Harness
let a1: { cookie: string; headers: Record<string, string> }
const rows = async () => (await h.pool.query<{ id: string; direction: string; queue: string; agent_crm_id: string; customer_ref: string; customer_name: string; caller_number: string; answered: boolean; ended: boolean; disposition: string | null }>(
  `select id, direction, queue, agent_crm_id, customer_ref, customer_name, caller_number, answered_at is not null as answered, ended_at is not null as ended, disposition from call_centre.calls order by started_at`)).rows
const presenceOf = async (id: string) => (await h.pool.query<{ status: string }>('select status from call_centre.agent_presence where agent_crm_id = $1', [id])).rows[0]?.status

beforeAll(async () => { h = await boot() })
beforeEach(async () => {
  await h.reset()
  a1 = await h.as('agent1@x.test')
  await h.send('PUT', '/api/presence', a1, { status: 'available', languages: ['en'] })
})
afterAll(async () => { await h.app.close() })

describe('placing a call', () => {
  it('opens an outbound call on the agent\'s call screen with the customer already known, and marks the agent busy', async () => {
    const r = await h.send('POST', '/api/customers/c1/call', a1)
    expect(r.status).toBe(201)
    expect(r.json).toMatchObject({ phone: '08035550142', name: 'Musa Garba' })
    const [call] = await rows()
    expect(call).toMatchObject({ id: r.json.callId, direction: 'outbound', queue: 'outbound', agent_crm_id: A1, customer_ref: 'c1', customer_name: 'Musa Garba', caller_number: '08035550142', answered: true, ended: false })
    expect(await presenceOf(A1)).toBe('busy')
    const active = (await h.get('/api/calls/active', a1)).json
    expect(active).toMatchObject({ id: r.json.callId, direction: 'outbound', name: 'Musa Garba', customer: { id: 'c1', name: 'Musa Garba' } })
    expect((await h.pool.query(`select 1 from call_centre.audit_log where action = 'customer.call'`)).rowCount).toBe(1)
  })

  it('an inbound call still reads as inbound on the call screen', async () => {
    await h.pool.query(`insert into call_centre.calls (at_session_id, direction, caller_number, queue, agent_crm_id, answered_at) values ('S-IN','inbound','0803 555 0142','general',$1, now())`, [A1])
    expect((await h.get('/api/calls/active', a1)).json).toMatchObject({ direction: 'inbound' })
  })

  it('refuses a second call while one is open, even from two quick clicks', async () => {
    const both = await Promise.all([h.send('POST', '/api/customers/c1/call', a1), h.send('POST', '/api/customers/c2/call', a1)])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
    expect((await rows()).filter((c) => !c.ended)).toHaveLength(1)
    const again = await h.send('POST', '/api/customers/c1/call', a1)
    expect(again.status).toBe(409)
    expect(again.json.error).toBe('You are already on a call. Wrap it up first.')
  })

  it('wrapping up ends the call, frees the agent, and the next call can start', async () => {
    const first = await h.send('POST', '/api/customers/c1/call', a1)
    expect((await h.send('POST', `/api/calls/${first.json.callId}/wrap-up`, a1, { outcome: 'Resolved on the call', notes: 'Checked the token' })).status).toBe(204)
    expect((await rows())[0]).toMatchObject({ ended: true, disposition: 'Resolved on the call' })
    expect(await presenceOf(A1)).toBe('available')
    expect((await h.send('POST', '/api/customers/c2/call', a1)).status).toBe(201)
  })

  it('"callback needed" books a callback to the number that was dialled', async () => {
    const first = await h.send('POST', '/api/customers/c1/call', a1)
    await h.send('POST', `/api/calls/${first.json.callId}/wrap-up`, a1, { outcome: 'Callback needed', notes: 'No answer' })
    expect((await h.pool.query('select phone_number, customer_ref from call_centre.callbacks')).rows).toEqual([{ phone_number: '08035550142', customer_ref: 'c1' }])
  })

  it('is only for agents and supervisors, and says so plainly for a customer that does not exist', async () => {
    const adm = await h.as('admin1@x.test')
    expect((await h.send('POST', '/api/customers/c1/call', adm)).status).toBe(403)
    expect((await h.send('POST', '/api/customers/nobody/call', a1)).status).toBe(404)
    expect((await rows())).toHaveLength(0)
  })

  it('takes the number from Beverly, not from the browser', async () => {
    const r = await h.send('POST', '/api/customers/c1/call', a1, { phone: '0999 000 0000' })
    expect(r.json.phone).toBe('08035550142')
    expect((await rows())[0]!.caller_number).toBe('08035550142')
  })

  it('does not ring the carrier (the call is on the agent\'s own phone)', async () => {
    await h.send('POST', '/api/customers/c1/call', a1)
    expect(h.fakes.provider.calls).toEqual([])
  })
})

describe('placing a call in database mode', () => {
  it('refuses a customer with no phone number on file', async () => {
    const db = await boot({ BEVERLY_READ_MODE: 'db' })
    const id = uid('no-phone-customer')
    await db.pool.query(`insert into public.customers (id, full_name, phone, upstream_id, site_code) values ($1,'Nia Nophone',null,'ext-np','kano')`, [id])
    await db.pool.query(`insert into public.meters (meter_sn, customer_id, site_code, tariff_id, status) values ('NP-1',$1,'kano','RESIDENTIAL','active')`, [id])
    const who = await db.as('agent1@x.test')
    const r = await db.send('POST', `/api/customers/${id}/call`, who)
    expect(r.status).toBe(422)
    expect(r.json.error).toMatch(/no phone number/i)
    expect((await db.pool.query('select 1 from call_centre.calls')).rowCount).toBe(0)
    await db.app.close()
  })
})

describe('outbound calls and the inbound figures', () => {
  it('are left out of service level and abandon rate, which are about callers ringing in', async () => {
    // One caller rang in and gave up; the agent then called a customer. The abandon rate is still 100% of inbound calls.
    await h.pool.query(`insert into call_centre.calls (at_session_id, direction, caller_number, queue, started_at, ended_at) values ('S-ABN','inbound','0803','general', now() - interval '5 minutes', now() - interval '4 minutes')`)
    await h.send('POST', '/api/customers/c1/call', a1)
    const sup = await h.as('sup1@x.test')
    const wall = (await h.get('/api/wall', sup)).json
    expect(wall.abandonedPct).toBe(100)
    expect(wall.serviceLevelPct).toBe(0)
    const abandoned = (await h.get('/api/metrics/abandoned?period=24h', sup)).json
    expect(JSON.stringify(abandoned)).toMatch(/1/)
    const sl = (await h.get('/api/metrics/service_level?period=24h', sup)).json as { points?: { v: number }[] }
    expect(JSON.stringify(sl)).not.toMatch(/"v":100/)
  })
})

describe('a call nobody wrapped up', () => {
  it('is closed by the sweep after four hours, and the agent is freed; a recent call is left alone', async () => {
    const q = (s: string, p: unknown[] = []) => h.pool.query(s, p)
    await h.send('POST', '/api/customers/c1/call', a1)
    await q(`update call_centre.calls set started_at = now() - interval '1 hour'`)
    await notifySweep(h.pool, null)
    expect((await rows())[0]).toMatchObject({ ended: false })           // one hour is a normal long call
    expect(await presenceOf(A1)).toBe('busy')

    await q(`update call_centre.calls set started_at = now() - interval '${STALE_OUTBOUND_HOURS + 1} hours'`)
    await notifySweep(h.pool, null)
    expect((await rows())[0]).toMatchObject({ ended: true, disposition: 'No outcome recorded' })
    expect(await presenceOf(A1)).toBe('available')
    expect((await h.send('POST', '/api/customers/c1/call', a1)).status).toBe(201)   // not stuck any more
  })

  it('never touches an inbound call, however long it has been open', async () => {
    await h.pool.query(`insert into call_centre.calls (at_session_id, direction, caller_number, queue, agent_crm_id, started_at, answered_at) values ('S-LONG','inbound','0803','general',$1, now() - interval '9 hours', now() - interval '9 hours')`, [A1])
    await notifySweep(h.pool, null)
    expect((await rows())[0]).toMatchObject({ ended: false })
  })
})
