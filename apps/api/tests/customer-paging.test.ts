import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A1, boot, uid, type Harness } from './helpers.js'

/**
 * The customer directory is large, so it is paged, filtered and counted by the database. These tests build more customers than one
 * page holds (the live directory has thousands; the screen used to stop at 50) and check that nobody is skipped, repeated or hidden.
 */
interface Row { id: string; name: string; phone: string; balance: number | null; area: string }
interface Page { customers: Row[]; total: number; offset: number; limit: number }

const N = 130
const cid = (i: number): string => uid(`pg-${String(i).padStart(3, '0')}`).replace(/^(.{9}).{3}/, (_, a: string) => a + String(i).padStart(3, '0'))
const SITES = ['kano', 'ikeja', 'abuja']

describe('customer directory paging (every station)', () => {
  let h: Harness
  let agent: { cookie: string; headers: Record<string, string> }
  const page = async (qs: string): Promise<Page> => (await h.get(`/api/customers/page${qs}`, agent)).json as Page

  beforeAll(async () => {
    h = await boot({ BEVERLY_READ_MODE: 'db' })   // CALL_STATION_SCOPE defaults to off
    const q = (s: string, p: unknown[] = []) => h.pool.query(s, p)
    // 130 customers: every 5th has a phone, three stations, names Customer 001..130, one meter each.
    for (let i = 1; i <= N; i++) {
      await q(`insert into public.customers (id, full_name, phone, upstream_id, site_code) values ($1,$2,$3,$4,$5)`,
        [cid(i), `Customer ${String(i).padStart(3, '0')}`, i % 5 === 0 ? `0803555${String(i).padStart(4, '0')}` : null, `ext-${i}`, SITES[i % 3]])
      await q(`insert into public.meters (meter_sn, customer_id, site_code, tariff_id, status) values ($1,$2,$3,'RESIDENTIAL','active')`, [`MT-${String(i).padStart(4, '0')}`, cid(i), SITES[i % 3]])
    }
    // Ten customers own a wallet: 1-4 are low (below NGN 1,500, the last one by a kobo), 5 sits exactly on the line (not low), 6-10 are fine.
    const balances = [40_000, 80_000, 120_000, 149_999, 150_000, 400_000, 400_000, 400_000, 400_000, 400_000]
    for (let i = 1; i <= 10; i++) {
      const w = uid(`pgw-${i}`)
      await q(`insert into public.wallets (id, owner_type, owner_id) values ($1,'customer',$2)`, [w, cid(i)])
      await q(`insert into public.wallet_balances_stub values ($1, $2, 0, $2)`, [w, balances[i - 1]])
    }
    agent = await h.as('agent1@x.test')
  })
  afterAll(async () => { await h.app.close() })

  it('the first page is 50 customers, and the total says how many there really are', async () => {
    const p = await page('')
    expect(p.customers).toHaveLength(50)
    expect(p).toMatchObject({ total: N, offset: 0, limit: 50 })
  })

  it('walking every page returns each customer exactly once, in the same order every time', async () => {
    const walk = async (): Promise<string[]> => {
      const ids: string[] = []
      for (let offset = 0; offset < N + 50; offset += 50) ids.push(...(await page(`?limit=50&offset=${offset}`)).customers.map((c) => c.id))
      return ids
    }
    const first = await walk()
    expect(first).toHaveLength(N)
    expect(new Set(first).size).toBe(N)
    expect(await walk()).toEqual(first)
    // Different page sizes agree with each other: no row is lost at a page boundary.
    const by30: string[] = []
    for (let offset = 0; offset < N; offset += 30) by30.push(...(await page(`?limit=30&offset=${offset}`)).customers.map((c) => c.id))
    expect(by30).toEqual(first)
  })

  it('lists customers with a phone first, then by name', async () => {
    const all = (await page('?limit=100')).customers
    const withPhone = all.filter((c) => c.phone)
    expect(withPhone).toHaveLength(26)                    // every 5th of 130
    expect(all.slice(0, 26).every((c) => c.phone)).toBe(true)
    const names = (rows: Row[]): string[] => rows.map((c) => c.name)
    expect(names(all.slice(0, 26))).toEqual([...names(all.slice(0, 26))].sort())
  })

  it('past the last page there are no rows, but the total is still right', async () => {
    expect(await page('?offset=500')).toMatchObject({ customers: [], total: N, offset: 500 })
    expect((await page('?offset=100&limit=50')).customers).toHaveLength(30)
  })

  it('filters run over the whole directory: prepaid, postpaid and low wallet', async () => {
    const prepaid = await page('?kind=prepaid&limit=100')
    expect(prepaid.total).toBe(10)
    expect(prepaid.customers.every((c) => c.balance !== null)).toBe(true)
    const low = await page('?kind=low&limit=100')
    expect(low.total).toBe(4)
    expect(low.customers.every((c) => c.balance !== null && c.balance < 1500)).toBe(true)
    const postpaid = await page('?kind=postpaid&limit=100')
    expect(postpaid.total).toBe(N - 10)
    expect(postpaid.customers.every((c) => c.balance === null)).toBe(true)
    expect(prepaid.total + postpaid.total).toBe(N)
  })

  it('filters by station, together with search and paging', async () => {
    const kano = await page('?area=KANO&limit=100')
    expect(kano.total).toBe(Array.from({ length: N }, (_, i) => i + 1).filter((i) => SITES[i % 3] === 'kano').length)
    expect(kano.customers.every((c) => c.area.includes('KANO'))).toBe(true)
    const two = await page('?area=KANO,ikeja&limit=100')
    expect(two.total).toBeGreaterThan(kano.total)
    const narrowed = await page('?q=Customer%200&kind=postpaid&area=KANO&limit=100')
    expect(narrowed.total).toBeGreaterThan(0)
    expect(narrowed.total).toBeLessThan(kano.total)
  })

  it('search counts every match, not just the first page', async () => {
    expect((await page('?q=customer')).total).toBe(N)
    const one = await page('?q=Customer%20077')
    expect(one.total).toBe(1)
    expect(one.customers[0]!.name).toBe('Customer 077')
    expect((await page('?q=0803555')).total).toBe(26)
    expect((await page('?q=zzz-no-such')).total).toBe(0)
    expect((await page('?q=%25')).total).toBe(0)   // a % is text, not a wildcard
  })

  it('the summary describes the whole directory, not the page that was loaded', async () => {
    const s = (await h.get('/api/customers/summary', agent)).json
    expect(s).toMatchObject({ total: N, prepaid: 10, postpaid: N - 10, low: 4 })
    expect(s.areas).toEqual(expect.arrayContaining(['KANO', 'IKEJA', 'ABUJA']))
  })

  it('opens any customer by id, wherever they sit in the list, and refuses ids that are not customers', async () => {
    const deep = (await page('?offset=120&limit=1')).customers[0]!
    const r = await h.get(`/api/customers/${deep.id}`, agent)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ id: deep.id, name: deep.name })
    expect((await h.get(`/api/customers/${uid('nobody')}`, agent)).status).toBe(404)
    expect((await h.get('/api/customers/not-a-uuid', agent)).status).toBe(404)
  })

  it('rejects nonsense paging instead of guessing', async () => {
    for (const bad of ['?limit=0', '?limit=101', '?limit=abc', '?offset=-1', '?kind=gold', '?q=' + 'x'.repeat(65)]) {
      expect((await h.get(`/api/customers/page${bad}`, agent)).status, bad).toBe(400)
    }
  })

  it('the quick search used by the pickers still returns a plain list', async () => {
    const r = await h.get('/api/customers?q=customer', agent)
    expect(Array.isArray(r.json)).toBe(true)
    expect(r.json).toHaveLength(50)
  })
})

describe('customer paging with station scoping on', () => {
  let h: Harness
  let agent: { cookie: string; headers: Record<string, string> }
  const S = (i: number): string => uid(`sc-${String(i).padStart(3, '0')}`).replace(/^(.{9}).{3}/, (_, a: string) => a + String(i).padStart(3, '0'))

  beforeAll(async () => {
    h = await boot({ BEVERLY_READ_MODE: 'db', CALL_STATION_SCOPE: 'on' })
    const q = (s: string, p: unknown[] = []) => h.pool.query(s, p)
    // 60 customers at the agent's station, 15 at a station nobody here is assigned to.
    for (let i = 1; i <= 75; i++) {
      await q(`insert into public.customers (id, full_name, phone, email) values ($1,$2,$3,$4)`, [S(i), `Scoped ${String(i).padStart(3, '0')}`, `0805000${String(i).padStart(4, '0')}`, `sc${i}@x.test`])
      await q(`insert into public.customer_meters (customer_id, meter_id, station_id, status) values ($1,$2,$3,'approved')`, [S(i), `SM-${i}`, i <= 60 ? 'KANO NORTH' : 'LAGOS'])
    }
    for (let i = 1; i <= 3; i++) {
      const w = uid(`scw-${i}`)
      await q(`insert into public.wallets (id, owner_type, owner_id) values ($1,'customer',$2)`, [w, S(i)])
      await q(`insert into public.wallet_balances_stub values ($1, 90000, 0, 90000)`, [w])
    }
    await q(`insert into public.users (auth_user_id, user_name, email, role_key, station_ids, portal_access) values ($1,'Aisha Bello','aisha@x.test','custom-call-centre-agent','{kano north}','{call}')`, [A1])
    agent = await h.as('agent1@x.test')
  })
  afterAll(async () => { await h.app.close() })

  it('pages only the agent\'s own stations, with a total that matches', async () => {
    const first = (await h.get('/api/customers/page?limit=50', agent)).json as Page
    expect(first).toMatchObject({ total: 60, offset: 0, limit: 50 })
    expect(first.customers).toHaveLength(50)
    const second = (await h.get('/api/customers/page?limit=50&offset=50', agent)).json as Page
    expect(second.customers).toHaveLength(10)
    const ids = [...first.customers, ...second.customers].map((c) => c.id)
    expect(new Set(ids).size).toBe(60)
    expect(ids.every((id) => !Array.from({ length: 15 }, (_, k) => S(61 + k)).includes(id))).toBe(true)
  })

  it('filters and counts within the agent\'s stations, and the summary agrees', async () => {
    expect(((await h.get('/api/customers/page?kind=low', agent)).json as Page).total).toBe(3)
    expect(((await h.get('/api/customers/page?kind=postpaid&limit=100', agent)).json as Page).total).toBe(57)
    expect(((await h.get('/api/customers/page?area=LAGOS', agent)).json as Page).total).toBe(0)
    const s = (await h.get('/api/customers/summary', agent)).json
    expect(s).toMatchObject({ total: 60, prepaid: 3, postpaid: 57, low: 3, areas: ['KANO NORTH'] })
  })

  it('cannot open a customer from another station by id', async () => {
    expect((await h.get(`/api/customers/${S(70)}`, agent)).status).toBe(404)
    expect((await h.get(`/api/customers/${S(5)}`, agent)).status).toBe(200)
  })
})
