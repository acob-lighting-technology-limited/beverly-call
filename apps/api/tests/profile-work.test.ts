import { beforeAll, describe, expect, it } from 'vitest'
import { A1, boot, uid, type Harness } from './helpers.js'

/** A customer's cases and Beverly support tickets on their profile, and agent profile and analytics. */
let h: Harness
const C = uid('pw-customer')

beforeAll(async () => {
  h = await boot({ BEVERLY_READ_MODE: 'db' })
  await h.pool.query(`insert into public.customers (id, full_name, phone) values ($1,'Halima Sani','08035550101')`, [C])
  await h.pool.query(`insert into public.support_tickets (reference, requester_actor_type, requester_actor_id, requester_name, customer_id, category, subject, priority, status, meter_context)
    values ('TKT-1','customer',$1,'Halima Sani',$1,'billing','No token after payment','high','open','{"meter_id":"47005346144"}'),
           ('TKT-2','customer',$1,'Halima Sani',null,'general','Link a second meter','normal','awaiting_customer',null),
           ('TKT-3','customer',$2,'Someone else',$2,'general','Other customer','normal','open',null)`, [C, uid('pw-other')])
})

describe('cases and tickets on the customer profile', () => {
  it('lists the customer’s Beverly support tickets, including ones linked only by requester', async () => {
    const a = await h.as('agent1@x.test')
    const r = (await h.get(`/api/customers/${C}/support-tickets`, a)).json
    expect(r.map((t: { reference: string }) => t.reference).sort()).toEqual(['TKT-1', 'TKT-2'])
    expect(r.find((t: { reference: string }) => t.reference === 'TKT-1')).toMatchObject({ priority: 'high', status: 'open', meterContext: '47005346144', requesterName: 'Halima Sani' })
    expect((await h.get('/api/customers/not-a-uuid/support-tickets', a)).status).toBe(404)
  })

  it('opens an escalation for the customer, lists it on their profile and resolves it', async () => {
    const a = await h.as('agent1@x.test')
    const made = await h.send('POST', '/api/cases', a, { category: 'token_not_received', priority: 'HIGH', customerRef: C, customerPhone: '08035550101', meterNumber: '47005346144', amountNgn: 5000, notes: 'Paid at 10:02' })
    expect(made.status).toBe(201)
    const list = (await h.get(`/api/customers/${C}/cases`, a)).json
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: made.json.id, customer: C, state: 'New' })
    const done = await h.send('POST', `/api/cases/${made.json.id}/resolve`, a, { note: 'Token resent' })
    expect(done.json.state).toBe('Done')
    expect((await h.get(`/api/customers/${C}/cases`, a)).json[0].state).toBe('Done')
  })
})

describe('agent profile and analytics', () => {
  it('shows an agent their own profile with today, week and month figures', async () => {
    await h.pool.query(`insert into call_centre.calls (at_session_id, direction, caller_number, queue, agent_crm_id, language, started_at, answered_at, ended_at, disposition, rating) values
      ('ap1','inbound','0803','general',$1,'en', now() - interval '20 minutes', now() - interval '19 minutes', now() - interval '15 minutes','Resolved',5),
      ('ap2','inbound','0804','general',$1,'en', now() - interval '10 minutes', now() - interval '9 minutes', now() - interval '3 minutes','escalated',3)`, [A1])
    const a = await h.as('agent1@x.test')
    const p = (await h.get('/api/agents/me/profile', a)).json
    expect(p.id).toBe(A1)
    expect(p.today).toMatchObject({ calls: 2, answered: 2, rating: 4, ratingCount: 2, firstCallResolvedPct: 50 })
    expect(p.today.avgHandleSeconds).toBe(300)
    expect(p.week.calls).toBeGreaterThanOrEqual(2); expect(p.month.calls).toBeGreaterThanOrEqual(2)
    expect(p.days).toHaveLength(14); expect(p.hours).toHaveLength(24)
    expect(p.hours.reduce((x: number, y: number) => x + y, 0)).toBe(2)
    expect(p.outcomes.map((o: { label: string }) => o.label).sort()).toEqual(['Resolved', 'escalated'])
  })

  it('lets supervisors open any agent, and stops agents opening each other', async () => {
    const sup = await h.as('sup1@x.test'); const a = await h.as('agent1@x.test')
    expect((await h.get(`/api/agents/${A1}/profile`, sup)).json.today.calls).toBe(2)
    expect((await h.get(`/api/agents/${uid('someone-else')}/profile`, a)).status).toBe(404)
    expect((await h.get(`/api/agents/${uid('nobody')}/profile`, sup)).status).toBe(404)
  })
})
