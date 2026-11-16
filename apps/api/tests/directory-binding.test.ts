import { beforeAll, describe, expect, it } from 'vitest'
import { boot, uid, type Harness } from './helpers.js'

/** The cross-station directory and binding calling numbers to customers, meters and accounts. */
let h: Harness
const C1 = uid('dir-oem-only')    // no CRM phone, the OEM has one; Kano
const C2 = uid('dir-crm')         // CRM phone; Ikeja; two meters on one account
const C3 = uid('dir-nophone')     // no phone anywhere
const ACC = uid('acct-2')
const CHECKS = { meter: true, name: true, lastPurchase: false, address: false }

beforeAll(async () => {
  h = await boot({ BEVERLY_READ_MODE: 'db' })   // CALL_STATION_SCOPE defaults to off
  const q = (s: string, p: unknown[] = []) => h.pool.query(s, p)
  await q(`insert into public.customers (id, full_name, phone, upstream_id, site_code) values ($1,'Halima Sani',null,'ext-1','kano'), ($2,'Tope Bello','08025550121','ext-2','ikeja'), ($3,'Ngozi Eze',null,'ext-3',null)`, [C1, C2, C3])
  await q(`insert into public.oem_inventory_customers (external_id, phone) values ('ext-1','+2348035550101')`)
  await q(`insert into public.accounts (id, customer_id, account_no, account_type) values ($1,$2,'ACC-77','prepaid')`, [ACC, C2])
  await q(`insert into public.meters (meter_sn, customer_id, account_id, site_code, tariff_id, status) values
    ('KN-0001',$1,null,'kano','RESIDENTIAL','active'), ('IK-0001',$2,$4,'ikeja','COMMERCIAL','active'), ('IK-0002',$2,$4,'ikeja','COMMERCIAL','active'), ('NG-0001',$3,null,'ikeja','PUBLIC','active')`, [C1, C2, C3, ACC])
  await q(`insert into public.account_bindings (customer_id, meter_id, tariff_id, station_id) values ('x','IK-0001','COMMERCIAL','IKEJA-MAIN')`)
  await q(`insert into public.tariff_rate_history (station_scope, tariff_id, tariff_name, effective_price_ngn, effective_from) values ('*','RESIDENTIAL','Residential',350,'2026-01-01'), ('*','COMMERCIAL','Commercial',350,'2026-01-01')`)
})

describe('directory across every station', () => {
  it('finds customers by name, meter, account, station and any phone format, including the OEM-only phone', async () => {
    const a = await h.as('agent1@x.test')   // no station is needed: the call centre serves every station
    for (const [q, id] of [['halima', C1], ['IK-0002', C2], ['ACC-77', C2], ['08035550101', C1], ['+234 803 555 0101', C1], ['tope', C2]] as const) {
      expect((await h.get(`/api/customers?q=${encodeURIComponent(q)}`, a)).json.map((c: { id: string }) => c.id), q).toEqual([id])
    }
    expect((await h.get('/api/customers?q=kano', a)).json.map((c: { id: string }) => c.id)).toEqual([C1])
  })

  it('shows account, stations and tariff name from the CRM', async () => {
    const a = await h.as('agent1@x.test')
    const c = (await h.get('/api/customers?q=tope', a)).json[0]
    expect(c).toMatchObject({ phone: '08025550121', accountNo: 'ACC-77', tariff: 'Commercial', area: 'IKEJA, IKEJA-MAIN' })
    expect((await h.get('/api/customers?q=halima', a)).json[0]).toMatchObject({ tariff: 'Residential', area: 'KANO', meter: 'KN-0001' })
  })

  it('lists every meter of a customer, with tariff and station on the profile', async () => {
    const a = await h.as('agent1@x.test')
    const p = (await h.get(`/api/customers/${C2}/profile`, a)).json
    expect(p.meters.map((m: { meterId: string }) => m.meterId).sort()).toEqual(['IK-0001', 'IK-0002'])
    expect(p.meters.find((m: { meterId: string }) => m.meterId === 'IK-0001').tariff).toMatchObject({ id: 'COMMERCIAL', name: 'Commercial', pricePerKwh: 350 })
  })
})

describe('binding numbers', () => {
  it('requires two confirmed details, a meter of the customer and a full number', async () => {
    const a = await h.as('agent1@x.test')
    const base = { phone: '0903 555 0199', customerId: C3, meters: ['NG-0001'], checks: CHECKS }
    expect((await h.send('POST', '/api/bindings', a, { ...base, checks: { ...CHECKS, name: false } })).status).toBe(400)
    expect((await h.send('POST', '/api/bindings', a, { ...base, meters: ['IK-0001'] })).status).toBe(400)
    expect((await h.send('POST', '/api/bindings', a, { ...base, phone: '0903' })).status).toBe(400)
  })

  it('refuses a number that already belongs to another customer', async () => {
    const a = await h.as('agent1@x.test')
    const r = await h.send('POST', '/api/bindings', a, { phone: '+2348025550121', customerId: C3, meters: ['NG-0001'], checks: CHECKS })
    expect(r.status).toBe(409)
  })

  it('needs a different supervisor to approve, then fills the CRM phone and recognises the caller', async () => {
    const a = await h.as('agent1@x.test'); const sup = await h.as('sup1@x.test')
    const made = await h.send('POST', '/api/bindings', a, { phone: '0903 555 0199', customerId: C3, meters: ['NG-0001'], label: 'Owner', checks: CHECKS })
    expect(made.status).toBe(201)
    const id = made.json[0].id
    expect(made.json[0]).toMatchObject({ status: 'pending', phone: '09035550199', customerName: 'Ngozi Eze', label: 'Owner' })
    expect((await h.send('POST', `/api/bindings/${id}/decision`, a, { approve: true })).status).toBe(403)   // agents cannot decide
    expect((await h.get('/api/bindings', a)).json).toHaveLength(1)
    const done = await h.send('POST', `/api/bindings/${id}/decision`, sup, { approve: true })
    expect(done.json).toMatchObject({ status: 'applied', crmResult: 'primary' })
    expect((await h.pool.query<{ phone: string }>('select phone from public.customers where id = $1', [C3])).rows[0]!.phone).toBe('09035550199')
    expect((await h.get('/api/customers?q=%2B2349035550199', a)).json.map((c: { id: string }) => c.id)).toEqual([C3])
    expect((await h.send('POST', `/api/bindings/${id}/decision`, sup, { approve: true })).status).toBe(409)
  })

  it('binds several numbers to one customer and one number to several meters, keeping the CRM primary', async () => {
    const a = await h.as('agent1@x.test'); const sup = await h.as('sup1@x.test')
    const two = await h.send('POST', '/api/bindings', a, { phone: '0814 555 0188', customerId: C2, meters: ['IK-0001', 'IK-0002'], label: 'Tenant', checks: CHECKS })
    expect(two.json).toHaveLength(2)
    for (const b of two.json) expect((await h.send('POST', `/api/bindings/${b.id}/decision`, sup, { approve: true })).json.crmResult).toBe('additional')
    const spouse = await h.send('POST', '/api/bindings', a, { phone: '0705 555 0177', customerId: C2, meters: ['IK-0001'], label: 'Spouse', checks: CHECKS })
    await h.send('POST', `/api/bindings/${spouse.json[0].id}/decision`, sup, { approve: true })
    expect((await h.pool.query<{ phone: string }>('select phone from public.customers where id = $1', [C2])).rows[0]!.phone).toBe('08025550121')
    const numbers = (await h.get(`/api/customers/${C2}/numbers`, a)).json.map((n: { phone: string }) => n.phone).sort()
    expect(numbers).toEqual(['07055550177', '08025550121', '08145550188'])
    for (const q of ['0814 555 0188', '07055550177']) expect((await h.get(`/api/customers?q=${encodeURIComponent(q)}`, a)).json.map((c: { id: string }) => c.id), q).toEqual([C2])
    expect((await h.send('POST', '/api/bindings', a, { phone: '0814 555 0188', customerId: C2, meters: ['IK-0001', 'IK-0002'], checks: CHECKS })).status).toBe(409)
  })

  it('lets a supervisor reject, never approve their own request, and audits each step', async () => {
    const sup = await h.as('sup1@x.test'); const adm = await h.as('admin1@x.test')
    const mine = await h.send('POST', '/api/bindings', sup, { phone: '0802 555 0166', customerId: C1, meters: ['KN-0001'], checks: CHECKS })
    expect((await h.send('POST', `/api/bindings/${mine.json[0].id}/decision`, sup, { approve: true })).status).toBe(403)
    const r = await h.send('POST', `/api/bindings/${mine.json[0].id}/decision`, adm, { approve: false, note: 'Caller could not confirm the meter' })
    expect(r.json).toMatchObject({ status: 'rejected', decisionNote: 'Caller could not confirm the meter' })
    const actions = (await h.pool.query<{ action: string }>(`select action from call_centre.audit_log where action like 'binding.%'`)).rows.map((x) => x.action)
    expect(actions).toContain('binding.request'); expect(actions).toContain('binding.apply'); expect(actions).toContain('binding.reject')
  })

  it('keeps the write path narrow: the app role cannot update customers directly', async () => {
    const r = await h.pool.query<{ ok: boolean }>(`select has_function_privilege('beverly_call_api','call_centre.apply_phone_binding(uuid,text)','execute') ok`)
    expect(r.rows[0]!.ok).toBe(true)
    expect((await h.pool.query<{ ok: boolean }>(`select has_table_privilege('beverly_call_api','public.customers','update') ok`)).rows[0]!.ok).toBe(false)
    expect((await h.pool.query<{ ok: boolean }>(`select has_table_privilege('beverly_call_api','call_centre_read.directory','insert') ok`)).rows[0]!.ok).toBe(false)
  })
})
