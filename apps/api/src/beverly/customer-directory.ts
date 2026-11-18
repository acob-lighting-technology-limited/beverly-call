import type { Pool } from 'pg'
import { CUSTOMER_PAGE_SIZE, LOW_WALLET_NAIRA, type Customer, type CustomerKind, type CustomerPage, type CustomerSummary } from '@beverly-call/shared'
import { UUID, WALLET_CTE, escapeLike, stationScope, wcMatch, type Actor } from './beverly-db.js'

/**
 * Paged, filtered and counted views of the customer directory (thousands of customers in the live data).
 * Filters run in the database over the whole directory; `total` is the number of customers matching the filters, not the page size.
 * Order is stable (phone on file first, then name, then id) so pages never skip or repeat a customer.
 */
export interface CustomerPageOptions {
  q: string
  limit?: number
  offset?: number
  kind?: CustomerKind
  /** Upper-case station names */
  areas?: string[]
  /** Fetch exactly this customer (used to open a customer by id). */
  id?: string
}

const LOW_MINOR = LOW_WALLET_NAIRA * 100

interface Row {
  id: string; full_name: string | null; phone: string | null; meter: string | null; account_no: string | null; account_type: string | null
  stations: string[] | null; tariff: string | null; ledger_balance_minor: string | null; total: string | null
}

const toCustomer = (x: Row): Customer => ({
  id: x.id, name: x.full_name ?? '', meter: x.meter ?? '', phone: x.phone ?? '', area: (x.stations ?? []).join(', '),
  accountType: x.account_type ?? 'Prepaid', balance: x.ledger_balance_minor === null ? null : Number(x.ledger_balance_minor) / 100,
  accountNo: x.account_no ?? undefined, tariff: x.tariff ?? undefined,
})

/** Last ten digits of a phone number, for matching numbers written in different formats. */
const TAIL_X = `right(regexp_replace(coalesce(x.phone, ''), '\\D', '', 'g'), 10)`

/**
 * Which customers own a wallet (and its balance), found with plain equality joins so the database can hash them: by id, by email, by phone tail,
 * or by a number bound to the customer in Beverly Call. Same rules as wcMatch(), which is still used to work out the balance of the few rows on a page.
 */
const cwOf = (rel: string, id: string, email: string, tail: string): string => `cw as (
  select customer_id, max(bal) as bal from (
    select ${id} as customer_id, wc.bal from ${rel} x join wc on wc.id = ${id}
    union all select ${id}, wc.bal from ${rel} x join wc on wc.email is not null and wc.email = lower(btrim(${email}))
    union all select ${id}, wc.bal from ${rel} x join wc on wc.tail is not null and wc.tail = ${tail}
    union all select b.customer_id, wc.bal from call_centre.phone_bindings b join wc on b.status = 'applied' and b.phone_tail = wc.tail
  ) m group by customer_id)`

export async function fetchCustomerPageDb(pool: Pool, actor: Actor, o: CustomerPageOptions): Promise<CustomerPage> {
  const limit = Math.min(Math.max(o.limit ?? CUSTOMER_PAGE_SIZE, 1), 100)
  const offset = Math.max(o.offset ?? 0, 0)
  const run = async (off: number, lim: number): Promise<Row[]> => (actor.scoped === false ? directory(pool, o, lim, off) : scoped(pool, actor, o, lim, off))
  const rows = await run(offset, limit)
  let total = Number(rows[0]?.total ?? 0)
  // Past the last page there are no rows to carry the total, so ask for the first row of the filtered set.
  if (!rows.length && offset > 0) total = Number((await run(0, 1))[0]?.total ?? 0)
  return { customers: rows.slice(0, limit).map(toCustomer), total, offset, limit }
}

/** One customer by id, or null. Opening a customer must not depend on them being in the first page of a search. */
export async function fetchCustomerByIdDb(pool: Pool, actor: Actor, id: string): Promise<Customer | null> {
  if (!UUID.test(id)) return null
  const page = await fetchCustomerPageDb(pool, actor, { q: '', limit: 1, id })
  return page.customers[0] ?? null
}

const textFilter = (alias: 'd' | 'c'): string => alias === 'd'
  ? `($1::text is null or d.full_name ilike $1 or d.phone ilike $1 or d.email ilike $1 or d.meter_sn ilike $1 or d.account_no ilike $1 or d.station_id ilike $1
      or ($2::text is not null and exists (select 1 from call_centre_read.directory_phones p where p.customer_id = d.customer_id and p.phone_tail = $2)))`
  : `($1::text is null or c.full_name ilike $1 or c.phone ilike $1 or c.email ilike $1
      or ($2::text is not null and regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like $2)
      or exists (select 1 from call_centre_read.customer_meters m where m.customer_id = c.id and m.meter_id ilike $1))`

const kindFilter = `($4::text = 'all' or ($4::text = 'prepaid' and cw.customer_id is not null) or ($4::text = 'postpaid' and cw.customer_id is null) or ($4::text = 'low' and cw.bal < $5))`

function terms(o: CustomerPageOptions): { like: string | null; tail: string | null; digitLike: string | null } {
  const term = o.q.trim().slice(0, 64)
  const digits = term.replace(/\D/g, '')
  return { like: term ? `%${escapeLike(term)}%` : null, tail: digits.length >= 7 ? digits.slice(-10) : null, digitLike: digits.length >= 7 ? `%${digits.slice(-10)}%` : null }
}

/** The cross-station directory (default): every CRM customer, whatever the station. */
async function directory(pool: Pool, o: CustomerPageOptions, limit: number, offset: number): Promise<Row[]> {
  const t = terms(o)
  const r = await pool.query<Row>(
    `${WALLET_CTE},
     ${cwOf('call_centre_read.directory', 'x.customer_id', 'x.email', 'x.phone_tail')},
     -- choose the page of customers first, so meters, tariffs and wallets are only worked out for them
     pick as (select d.customer_id, count(*) over () as total
      from call_centre_read.directory d left join cw on cw.customer_id = d.customer_id
      where ${textFilter('d')} and ${kindFilter}
        and ($6::text[] is null or exists (select 1 from call_centre_read.directory a where a.customer_id = d.customer_id and upper(a.station_id) = any($6)))
        and ($8::uuid is null or d.customer_id = $8::uuid)
      group by d.customer_id, cw.bal
      order by (max(d.phone) is not null) desc, max(d.full_name) nulls last, d.customer_id
      limit $3 offset $7)
     select d.customer_id as id, max(d.full_name) as full_name,
            coalesce(max(d.phone), (select '0' || p.phone_tail from call_centre_read.directory_phones p where p.customer_id = d.customer_id limit 1)) as phone,
            coalesce((array_agg(d.meter_sn order by (d.meter_status = 'active') desc, d.meter_sn) filter (where d.meter_sn is not null))[1],
                     (select m.meter_id from call_centre_read.customer_meters m where m.customer_id = d.customer_id order by (m.status = 'approved') desc, m.created_at limit 1)) as meter,
            max(d.account_no) as account_no, max(d.account_type) as account_type,
            coalesce(array_agg(distinct d.station_id) filter (where d.station_id is not null),
                     (select array_agg(distinct upper(m.station_id)) filter (where m.station_id is not null) from call_centre_read.customer_meters m where m.customer_id = d.customer_id),
                     case when max(d.meter_address) is null then null else array[max(d.meter_address)] end) as stations,
            (array_agg(coalesce(t.tariff_name, d.tariff_name, d.tariff_id)) filter (where d.tariff_id is not null or d.tariff_name is not null))[1] as tariff,
            max(wc.bal) as ledger_balance_minor, max(pick.total) as total
     from call_centre_read.directory d
     join pick on pick.customer_id = d.customer_id
     left join wc on ${wcMatch('d.customer_id', 'd.email', 'd.phone_tail')}
     left join call_centre_read.tariffs t on t.tariff_id = d.tariff_id and t.station_scope = '*'
     group by d.customer_id
     order by (max(d.phone) is not null) desc, max(d.full_name) nulls last, d.customer_id`,
    [t.like, t.tail, limit, o.kind ?? 'all', LOW_MINOR, o.areas?.length ? o.areas : null, offset, o.id ?? null])
  return r.rows
}

/** CALL_STATION_SCOPE=on: only customers with a meter at one of the actor's stations. */
async function scoped(pool: Pool, actor: Actor, o: CustomerPageOptions, limit: number, offset: number): Promise<Row[]> {
  const scope = await stationScope(pool, actor)
  const t = terms(o)
  const r = await pool.query<Row>(
    `${WALLET_CTE},
     ${cwOf('call_centre_read.customers', 'x.id', 'x.email', TAIL_X)}
     select c.id, c.full_name, c.phone, null::text as account_no, null::text as account_type, null::text as tariff,
            cw.bal as ledger_balance_minor,
            (select array_agg(distinct upper(m.station_id)) filter (where m.station_id is not null) from call_centre_read.customer_meters m where m.customer_id = c.id) as stations,
            (select m.meter_id from call_centre_read.customer_meters m where m.customer_id = c.id order by (m.status = 'approved') desc, m.created_at limit 1) as meter,
            count(*) over () as total
     from call_centre_read.customers c left join cw on cw.customer_id = c.id
     where ${textFilter('c')} and ${kindFilter}
       and ($6::text[] is null or exists (select 1 from call_centre_read.customer_meters m where m.customer_id = c.id and upper(m.station_id) = any($6)))
       and ($8::uuid is null or c.id = $8::uuid)
       and ($9::text[] is null or exists (select 1 from call_centre_read.customer_meters m where m.customer_id = c.id and upper(m.station_id) = any($9)))
     order by c.created_at desc, c.id
     limit $3 offset $7`,
    [t.like, t.digitLike, limit, o.kind ?? 'all', LOW_MINOR, o.areas?.length ? o.areas : null, offset, o.id ?? null, scope])
  return r.rows
}

interface SummaryRow { total: string; prepaid: string; low: string; areas: string[] | null }

/** Totals for the whole directory (or the actor's stations): the numbers behind the summary tiles and the area filter. */
export async function fetchCustomerSummaryDb(pool: Pool, actor: Actor): Promise<CustomerSummary> {
  if (actor.scoped === false) {
    const r = await pool.query<SummaryRow>(
      `${WALLET_CTE},
       ${cwOf('call_centre_read.directory', 'x.customer_id', 'x.email', 'x.phone_tail')}
       select (select count(distinct customer_id) from call_centre_read.directory) as total,
              (select count(*) from cw) as prepaid,
              (select count(*) from cw where bal < $1) as low,
              (select array_agg(a order by a) from (select distinct upper(btrim(station_id)) a from call_centre_read.directory where station_id is not null and btrim(station_id) <> '') x) as areas`, [LOW_MINOR])
    return shape(r.rows[0])
  }
  const scope = await stationScope(pool, actor)
  const r = await pool.query<SummaryRow>(
    `${WALLET_CTE},
     mine as (select c.id, c.email, c.phone from call_centre_read.customers c
              where $2::text[] is null or exists (select 1 from call_centre_read.customer_meters m where m.customer_id = c.id and upper(m.station_id) = any($2))),
     ${cwOf('mine', 'x.id', 'x.email', TAIL_X)}
     select (select count(*) from mine) as total, (select count(*) from cw) as prepaid, (select count(*) from cw where bal < $1) as low,
            (select array_agg(a order by a) from (select distinct upper(btrim(m.station_id)) a from call_centre_read.customer_meters m
               where m.station_id is not null and btrim(m.station_id) <> '' and ($2::text[] is null or upper(m.station_id) = any($2))) x) as areas`, [LOW_MINOR, scope])
  return shape(r.rows[0])
}

function shape(r: SummaryRow | undefined): CustomerSummary {
  const total = Number(r?.total ?? 0)
  const prepaid = Number(r?.prepaid ?? 0)
  return { total, prepaid, postpaid: Math.max(total - prepaid, 0), low: Number(r?.low ?? 0), areas: r?.areas ?? [] }
}
