import type { Pool } from 'pg'
import type { Customer, CustomerProfile, Role, RoleSummary, WalletInfo } from '@beverly-call/shared'
import { BeverlyError } from './beverly-api.js'
import type { BeverlyStaff } from './staff-directory.js'

/**
 * Reads Beverly's data straight from the shared database through the read-only views in `call_centre_read`
 * (migration 20261116120000). Only an explicit column list is exposed; the raw STS token is reachable one purchase at a
 * time through reveal_purchase_token(). Beverly's API enforces station scoping on these reads, so this does too:
 * admins see everything; everyone else sees only customers with a meter at one of their assigned stations.
 */
export interface Actor { id: string; role: Role; /** false = the call centre serves every station (CALL_STATION_SCOPE=off, the default) */ scoped?: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Stations the actor may read, or null for no restriction. No assigned station is refused, as Beverly's own routes do. */
export async function stationScope(pool: Pool, actor: Actor): Promise<string[] | null> {
  if (actor.role === 'admin' || actor.scoped === false) return null
  if (!UUID.test(actor.id)) throw new BeverlyError(403, 'No station is assigned to you in Beverly')
  const r = await pool.query<{ station_id: string | null; station_ids: string[] | null }>(
    'select station_id, station_ids from call_centre_read.staff where auth_user_id = $1 limit 1', [actor.id])
  const row = r.rows[0]
  const set = new Set<string>()
  for (const s of [row?.station_id, ...(row?.station_ids ?? [])]) if (s && s.trim()) set.add(s.trim().toUpperCase())
  if (!set.size) throw new BeverlyError(403, 'No station is assigned to you in Beverly')
  return [...set]
}

/**
 * Wallet owners for one customer: the customer themselves, plus any Beverly customer account (the wallet app's sign-ups) that shares their
 * email or phone, or a number bound to them in Beverly Call. A CRM customer is often a different row from the person who signed up in the wallet.
 */
const walletOwners = (id: string): string => `(
  select ${id}::uuid
  union select c2.id from call_centre_read.customers me join call_centre_read.customers c2 on c2.id <> me.id
    where me.id = ${id}::uuid and (
      (nullif(btrim(me.email), '') is not null and lower(btrim(c2.email)) = lower(btrim(me.email)))
      or (length(right(regexp_replace(coalesce(me.phone, ''), '\\D', '', 'g'), 10)) = 10
          and right(regexp_replace(coalesce(c2.phone, ''), '\\D', '', 'g'), 10) = right(regexp_replace(coalesce(me.phone, ''), '\\D', '', 'g'), 10)))
  union select c3.id from call_centre_read.directory_phones dp join call_centre_read.customers c3
    on right(regexp_replace(coalesce(c3.phone, ''), '\\D', '', 'g'), 10) = dp.phone_tail where dp.customer_id = ${id}::uuid)`
/**
 * For lists: the few customers who own a wallet are found once, then each listed customer is matched to them by id, email, phone, or a bound number.
 * (Matching per listed row against all customers took a minute on the live data; against the wallet owners it is instant.)
 */
const WALLET_CTE = `with wc as (
  select c.id, lower(nullif(btrim(c.email), '')) as email, nullif(right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10), '') as tail, w.ledger_balance_minor as bal
  from call_centre_read.wallets w join call_centre_read.customers c on c.id = w.owner_id where w.owner_type = 'customer')`
const wcMatch = (id: string, email: string, tail: string): string => `(wc.id = ${id}
  or (wc.email is not null and wc.email = lower(btrim(${email})))
  or (wc.tail is not null and wc.tail = ${tail})
  or exists (select 1 from call_centre.phone_bindings b where b.customer_id = ${id} and b.status = 'applied' and b.phone_tail = wc.tail))`

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

interface CustomerRow { id: string; full_name: string | null; phone: string | null; ledger_balance_minor: string | null; stations: string[] | null; meter: string | null }

export async function fetchCustomersDb(pool: Pool, actor: Actor, q: string, limit = 50): Promise<Customer[]> {
  const scope = await stationScope(pool, actor)
  const term = q.trim().slice(0, 64)
  const like = term ? `%${escapeLike(term)}%` : null
  const digits = term.replace(/\D/g, '')
  const digitLike = digits.length >= 7 ? `%${digits.slice(-10)}%` : null
  if (actor.scoped === false) return fetchDirectoryDb(pool, like, digits.length >= 7 ? digits.slice(-10) : null, limit)
  const r = await pool.query<CustomerRow>(
    `${WALLET_CTE}
     select c.id, c.full_name, c.phone,
            (select max(wc.bal) from wc where ${wcMatch('c.id', 'c.email', "right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10)")}) as ledger_balance_minor,
            (select array_agg(distinct upper(m.station_id)) filter (where m.station_id is not null) from call_centre_read.customer_meters m where m.customer_id = c.id) as stations,
            (select m.meter_id from call_centre_read.customer_meters m where m.customer_id = c.id order by (m.status = 'approved') desc, m.created_at limit 1) as meter
     from call_centre_read.customers c
     where ($1::text is null
            or c.full_name ilike $1 or c.phone ilike $1 or c.email ilike $1
            or ($2::text is not null and regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like $2)
            or exists (select 1 from call_centre_read.customer_meters m where m.customer_id = c.id and m.meter_id ilike $1))
       and ($3::text[] is null or exists (select 1 from call_centre_read.customer_meters m where m.customer_id = c.id and upper(m.station_id) = any($3)))
     order by c.created_at desc
     limit $4`, [like, digitLike, scope, Math.min(limit, 200)])
  return r.rows.map((x) => ({
    id: x.id, name: x.full_name ?? '', meter: x.meter ?? '', phone: x.phone ?? '', area: (x.stations ?? []).join(', '),
    // TODO(debt): postpaid accounts are not modelled in Beverly yet; every customer has a prepaid wallet.
    accountType: 'Prepaid', balance: x.ledger_balance_minor === null ? null : Number(x.ledger_balance_minor) / 100,
  }))
}

interface DirRow { id: string; full_name: string | null; phone: string | null; meter: string | null; account_no: string | null; account_type: string | null; stations: string[] | null; tariff: string | null; ledger_balance_minor: string | null }

/**
 * The cross-station directory: every CRM customer Beverly knows, whatever the station. A customer is found by name, email,
 * phone in any format (CRM phone, OEM phone or a number bound through Beverly Call), meter, account number or station.
 */
export async function fetchDirectoryDb(pool: Pool, like: string | null, tail: string | null, limit = 50): Promise<Customer[]> {
  const r = await pool.query<DirRow>(
    `${WALLET_CTE},
     -- choose the page of customers first, so meters, tariffs and wallets are only worked out for them
     pick as (select d.customer_id from call_centre_read.directory d
      where ($1::text is null
             or d.full_name ilike $1 or d.phone ilike $1 or d.email ilike $1 or d.meter_sn ilike $1 or d.account_no ilike $1 or d.station_id ilike $1
             or ($2::text is not null and exists (select 1 from call_centre_read.directory_phones p where p.customer_id = d.customer_id and p.phone_tail = $2)))
      group by d.customer_id order by (max(d.phone) is not null) desc, max(d.full_name) nulls last limit $3)
     select d.customer_id as id, max(d.full_name) as full_name,
            coalesce(max(d.phone), (select '0' || p.phone_tail from call_centre_read.directory_phones p where p.customer_id = d.customer_id limit 1)) as phone,
            coalesce((array_agg(d.meter_sn order by (d.meter_status = 'active') desc, d.meter_sn) filter (where d.meter_sn is not null))[1],
                     (select m.meter_id from call_centre_read.customer_meters m where m.customer_id = d.customer_id order by (m.status = 'approved') desc, m.created_at limit 1)) as meter,
            max(d.account_no) as account_no, max(d.account_type) as account_type,
            coalesce(array_agg(distinct d.station_id) filter (where d.station_id is not null),
                     (select array_agg(distinct upper(m.station_id)) filter (where m.station_id is not null) from call_centre_read.customer_meters m where m.customer_id = d.customer_id),
                     case when max(d.meter_address) is null then null else array[max(d.meter_address)] end) as stations,
            (array_agg(coalesce(t.tariff_name, d.tariff_name, d.tariff_id)) filter (where d.tariff_id is not null or d.tariff_name is not null))[1] as tariff,
            max(wc.bal) as ledger_balance_minor
     from call_centre_read.directory d
     join pick on pick.customer_id = d.customer_id
     left join wc on ${wcMatch('d.customer_id', 'd.email', 'd.phone_tail')}
     left join call_centre_read.tariffs t on t.tariff_id = d.tariff_id and t.station_scope = '*'
     group by d.customer_id
     order by (max(d.phone) is not null) desc, max(d.full_name) nulls last`, [like, tail, Math.min(limit, 200)])
  return r.rows.map((x) => ({
    id: x.id, name: x.full_name ?? '', meter: x.meter ?? '', phone: x.phone ?? '', area: (x.stations ?? []).join(', '),
    accountType: x.account_type ?? 'Prepaid', balance: x.ledger_balance_minor === null ? null : Number(x.ledger_balance_minor) / 100,
    accountNo: x.account_no ?? undefined, tariff: x.tariff ?? undefined,
  }))
}

/** The customer's meter numbers inside the actor's stations, approved links first. Unscoped, the CRM directory's meters are included too. */
export async function fetchMetersDb(pool: Pool, actor: Actor, customerId: string): Promise<string[]> {
  if (!UUID.test(customerId)) return []
  const scope = await stationScope(pool, actor)
  if (actor.scoped === false) {
    const d = await pool.query<{ meter: string }>(
      `select meter from (
         select meter_id as meter, 0 as rank, created_at as at from call_centre_read.customer_meters where customer_id = $1 and meter_id is not null
         union all select meter_sn, 1, created_at from call_centre_read.directory where customer_id = $1 and meter_sn is not null) x
       order by rank, at`, [customerId])
    return [...new Set(d.rows.map((x) => x.meter))]
  }
  const r = await pool.query<{ meter_id: string }>(
    `select meter_id from call_centre_read.customer_meters
     where customer_id = $1 and meter_id is not null and ($2::text[] is null or upper(station_id) = any($2))
     order by (status = 'approved') desc, created_at`, [customerId, scope])
  return r.rows.map((x) => x.meter_id)
}

/** Recent purchases for a customer. The token is never selected here; only its last four digits. */
export async function fetchPurchasesDb(pool: Pool, actor: Actor, customerId: string, limit = 10): Promise<Record<string, unknown>[]> {
  if (!UUID.test(customerId)) return []
  const scope = await stationScope(pool, actor)
  const r = await pool.query(
    `select id, created_at, amount_minor, status, token_last4, meter_id
     from call_centre_read.purchases
     where actor_type = 'customer' and actor_id = $1 and ($2::text[] is null or upper(station_id) = any($2))
     order by created_at desc, id desc limit $3`, [customerId, scope, Math.min(limit, 50)])
  return r.rows as Record<string, unknown>[]
}

/** One purchase's raw token, only if it belongs to this customer and sits inside the actor's stations. */
export async function revealTokenDb(pool: Pool, actor: Actor, customerId: string, purchaseId: string): Promise<string | null> {
  if (!UUID.test(customerId) || !UUID.test(purchaseId)) return null
  const scope = await stationScope(pool, actor)
  const own = await pool.query(
    `select 1 from call_centre_read.purchases
     where id = $1 and actor_type = 'customer' and actor_id = $2 and has_token and ($3::text[] is null or upper(station_id) = any($3))`, [purchaseId, customerId, scope])
  if (!own.rowCount) return null
  const r = await pool.query<{ t: string | null }>('select call_centre_read.reveal_purchase_token($1) as t', [purchaseId])
  return r.rows[0]?.t ?? null
}

/** Wallet balances for a customer the actor may see (same station scope as meters). Money in naira. */
export async function fetchWalletDb(pool: Pool, actor: Actor, customerId: string): Promise<WalletInfo | null> {
  if (!UUID.test(customerId)) return null
  const scope = await stationScope(pool, actor)
  if (scope) {
    const seen = await pool.query('select 1 from call_centre_read.customer_meters where customer_id = $1 and upper(station_id) = any($2) limit 1', [customerId, scope])
    if (!seen.rowCount) return null
  }
  const r = await pool.query<{ status: string; currency: string; ledger_balance_minor: string | null; active_holds_minor: string | null; available_balance_minor: string | null }>(
    `select status, currency, ledger_balance_minor, active_holds_minor, available_balance_minor from call_centre_read.wallets where owner_type = 'customer' and owner_id in ${walletOwners('$1')} order by (status = 'active') desc, ledger_balance_minor desc nulls last limit 1`, [customerId])
  const w = r.rows[0]
  if (!w) return null
  return { status: w.status, currency: w.currency, balance: Number(w.ledger_balance_minor ?? 0) / 100, holds: Number(w.active_holds_minor ?? 0) / 100, available: Number(w.available_balance_minor ?? 0) / 100 }
}

/**
 * Account, station, meter and tariff details for one customer the actor may see (same station scope as meters).
 * Tariffs come from the optional call_centre_read.tariffs view; when it is not installed yet, meters show their tariff id only.
 */
export async function fetchProfileDb(pool: Pool, actor: Actor, customerId: string): Promise<CustomerProfile | null> {
  if (!UUID.test(customerId)) return null
  const scope = await stationScope(pool, actor)
  const c = await pool.query<{ account_no: string | null; site_id: string | null; status: string | null; kyc_tier: number | null; kyc_status: string | null; email: string | null; phone: string | null; created_at: Date | null }>(
    'select account_no, site_id, status, kyc_tier, kyc_status, email, phone, created_at from call_centre_read.customers where id = $1', [customerId])
  const row = c.rows[0]
  if (!row) return null
  const directoryAccountNo = (await pool.query<{ a: string | null }>('select max(account_no) as a from call_centre_read.directory where customer_id = $1', [customerId])).rows[0]?.a ?? null
  const m = await pool.query<{ meter_id: string; meter_type: string | null; station_id: string | null; tariff_id: string | null; status: string | null; label: string | null; oem_name?: string | null; oem_price?: string | null }>(
    actor.scoped === false
      ? `select meter_id, meter_type, station_id, tariff_id, status, label, oem_name, oem_price from (
           select meter_id, meter_type, station_id, tariff_id, status, coalesce(nickname, alias, meter_name) as label, null::text as oem_name, null::numeric as oem_price, 0 as rank, created_at as at
           from call_centre_read.customer_meters where customer_id = $1 and meter_id is not null
           union all
           select d.meter_sn, d.meter_type, coalesce(d.station_id, d.meter_address), d.tariff_id, d.meter_status, null, d.tariff_name, d.tariff_rate_ngn, 1, d.created_at
           from call_centre_read.directory d where d.customer_id = $1 and d.meter_sn is not null
             and not exists (select 1 from call_centre_read.customer_meters cm where cm.customer_id = $1 and cm.meter_id = d.meter_sn)) x
         order by rank, at`
      : `select meter_id, meter_type, station_id, tariff_id, status, coalesce(nickname, alias, meter_name) as label
         from call_centre_read.customer_meters
         where customer_id = $1 and meter_id is not null and ($2::text[] is null or upper(station_id) = any($2))
         order by (status = 'approved') desc, created_at`, actor.scoped === false ? [customerId] : [customerId, scope])
  if (scope && !m.rowCount) return null
  const ids = [...new Set(m.rows.map((x) => x.tariff_id).filter((x): x is string => !!x))]
  const rates = new Map<string, { name: string | null; price: number | null }>()
  if (ids.length) {
    try {
      const t = await pool.query<{ station_scope: string; tariff_id: string; tariff_name: string | null; effective_price_ngn: string | null; unit_price_ngn: string | null }>(
        'select station_scope, tariff_id, tariff_name, effective_price_ngn, unit_price_ngn from call_centre_read.tariffs where tariff_id = any($1)', [ids])
      for (const x of t.rows) {
        const p = x.effective_price_ngn ?? x.unit_price_ngn
        rates.set(`${x.station_scope.toUpperCase()}|${x.tariff_id}`, { name: x.tariff_name || null, price: p === null ? null : Number(p) })
      }
    } catch { /* tariffs view not installed yet: show ids only */ }
  }
  const rateFor = (station: string | null, id: string) => rates.get(`${(station ?? '').toUpperCase()}|${id}`) ?? rates.get(`*|${id}`)
  return {
    account: { accountNo: row.account_no ?? directoryAccountNo, siteId: row.site_id, status: row.status, kycTier: row.kyc_tier, kycStatus: row.kyc_status, email: row.email, phone: row.phone, since: row.created_at ? row.created_at.toISOString() : null },
    meters: m.rows.map((x) => {
      const r = x.tariff_id ? rateFor(x.station_id, x.tariff_id) : undefined
      const name = r?.name ?? x.oem_name ?? null
      const price = r?.price ?? (x.oem_price == null ? null : Number(x.oem_price))
      return { meterId: x.meter_id, type: x.meter_type, stationId: x.station_id ? x.station_id.toUpperCase() : null, status: x.status, label: x.label, tariff: x.tariff_id ? { id: x.tariff_id, name, pricePerKwh: price } : null }
    }),
  }
}

/** Every role with how many staff hold it and how many permissions it carries. */
export async function fetchRolesDb(pool: Pool): Promise<RoleSummary[]> {
  const r = await pool.query<{ role_key: string; label: string | null; role_name: string | null; description: string | null; people: string; permissions: string }>(
    `select r.role_key, r.label, r.role_name, r.description,
            (select count(*) from call_centre_read.staff s where s.role_key = r.role_key) as people,
            (select count(*) from call_centre_read.role_permissions p where p.role_key = r.role_key) as permissions
     from call_centre_read.roles r order by coalesce(r.label, r.role_name, r.role_key)`)
  return r.rows.map((x) => ({ roleKey: x.role_key, label: x.label ?? x.role_name ?? x.role_key, description: x.description, people: Number(x.people), permissions: Number(x.permissions) }))
}

/** Staff with their role label, in the shape the staff directory uses. */
export async function fetchStaffDb(pool: Pool): Promise<(BeverlyStaff & { role_label: string | null })[]> {
  const r = await pool.query<{ id: string; auth_user_id: string | null; user_name: string | null; email: string | null; role_key: string | null; portal_access: string[] | null; role_label: string | null }>(
    `select s.id, s.auth_user_id, s.user_name, s.email, s.role_key, s.portal_access, coalesce(r.label, r.role_name) as role_label
     from call_centre_read.staff s left join call_centre_read.roles r on r.role_key = s.role_key order by s.user_name`)
  return r.rows.map((x) => ({ id: x.id, auth_user_id: x.auth_user_id, user_name: x.user_name, email: x.email, role_key: x.role_key, portal_access: x.portal_access, role_label: x.role_label, last_sign_in_at: null, suspended: false }))
}
