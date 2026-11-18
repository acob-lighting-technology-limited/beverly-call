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
    expect(list[0]).toMatchObject({ id: made.json.id, customer: C, state: 'Working' })
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

describe('wallet shown only when a Beverly customer wallet is bound by email or phone', () => {
  const CRM_EMAIL = uid('wl-crm-email'); const APP_EMAIL = uid('wl-app-email')
  const CRM_PHONE = uid('wl-crm-phone'); const APP_PHONE = uid('wl-app-phone')
  const LONER = uid('wl-loner')

  beforeAll(async () => {
    const q = (s: string, p: unknown[] = []) => h.pool.query(s, p)
    await q(`insert into public.customers (id, full_name, email, phone) values
      ($1,'Crm Email Person','Ada@Example.test',null), ($2,'Ada (wallet app)','ada@example.test',null),
      ($3,'Crm Phone Person',null,'+234 803 111 3333'), ($4,'Phone (wallet app)',null,'08031113333'),
      ($5,'No Wallet Person','nobody@example.test','08099990000')`, [CRM_EMAIL, APP_EMAIL, CRM_PHONE, APP_PHONE, LONER])
    await q(`insert into public.wallets (id, owner_type, owner_id) values ($1,'customer',$2), ($3,'customer',$4)`, [uid('wl-w1'), APP_EMAIL, uid('wl-w2'), APP_PHONE])
    await q(`insert into public.wallet_balances_stub values ($1, 450000, 0, 450000), ($2, 120000, 20000, 100000)`, [uid('wl-w1'), uid('wl-w2')])
  })

  it('finds the wallet through a shared email, ignoring case', async () => {
    const a = await h.as('agent1@x.test')
    expect((await h.get(`/api/customers/${CRM_EMAIL}/wallet`, a)).json).toMatchObject({ balance: 4500, available: 4500 })
    expect((await h.get('/api/customers?q=Crm%20Email', a)).json[0].balance).toBe(4500)
  })

  it('finds the wallet through a shared phone number in any format', async () => {
    const a = await h.as('agent1@x.test')
    expect((await h.get(`/api/customers/${CRM_PHONE}/wallet`, a)).json).toMatchObject({ balance: 1200, holds: 200, available: 1000 })
    expect((await h.get('/api/customers?q=Crm%20Phone', a)).json[0].balance).toBe(1200)
  })

  it('finds the wallet through a number bound in Beverly Call', async () => {
    const a = await h.as('agent1@x.test'); const sup = await h.as('sup1@x.test')
    await h.pool.query(`insert into public.meters (meter_sn, customer_id, site_code) values ('LN-1',$1,'abuja')`, [LONER])
    await h.pool.query(`update public.customers set phone = '08031113333' where id = $1`, [APP_PHONE])   // the wallet app customer
    const b = await h.send('POST', '/api/bindings', a, { phone: '0803 111 3333', customerId: LONER, meters: ['LN-1'], checks: { meter: true, name: true, lastPurchase: false, address: false } })
    expect(b.status).toBe(409)   // that number already belongs to the wallet customer, so it cannot also be bound to someone else
    expect((await h.get(`/api/customers/${LONER}/wallet`, sup)).status).toBe(404)
  })

  it('shows nothing when no wallet is linked', async () => {
    const a = await h.as('agent1@x.test')
    expect((await h.get(`/api/customers/${LONER}/wallet`, a)).status).toBe(404)
    expect((await h.get('/api/customers?q=No%20Wallet', a)).json[0].balance).toBeNull()
  })
})
