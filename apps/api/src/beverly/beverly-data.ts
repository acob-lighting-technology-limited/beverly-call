import type { Pool } from 'pg'
import { LOW_WALLET_NAIRA, type Customer, type CustomerPage, type CustomerProfile, type CustomerSummary, type RoleSummary, type WalletInfo } from '@beverly-call/shared'
import type { Env } from '../config/env.js'
import type { VerifiedSession } from '../auth/session-token.js'
import { fetchCustomers, fetchMeters, fetchPurchases, fetchWallet } from './beverly-api.js'
import type { FetchLike } from './beverly-auth.js'
import { fetchCustomersDb, fetchMetersDb, fetchPurchasesDb, fetchRolesDb, fetchWalletDb, revealTokenDb } from './beverly-db.js'
import { fetchStaff, type BeverlyStaff } from './staff-directory.js'
import { fetchStaffDb, fetchProfileDb } from './beverly-db.js'
import { fetchCustomerByIdDb, fetchCustomerPageDb, fetchCustomerSummaryDb, type CustomerPageOptions } from './customer-directory.js'

/** Beverly data the call desk reads, independent of where it comes from (database views or Beverly's admin API). */
export interface BeverlyData {
  customers(q: string, limit?: number): Promise<Customer[]>
  /** One page of the directory with the total that matches the filters. */
  customerPage(o: CustomerPageOptions): Promise<CustomerPage>
  /** Totals over the whole directory for the summary tiles and the area filter. */
  customerSummary(): Promise<CustomerSummary>
  /** One customer by id, or null. */
  customerById(id: string): Promise<Customer | null>
  meters(customerId: string): Promise<string[]>
  /** Recent purchases. Rows carry `token_last4` (database) or `token` (API); callers mask either. */
  purchases(customerId: string): Promise<Record<string, unknown>[]>
  revealToken(customerId: string, purchaseId: string): Promise<string | null>
  staff(): Promise<(BeverlyStaff & { role_label?: string | null })[]>
  wallet(customerId: string): Promise<WalletInfo | null>
  /** Account, stations, meters and tariffs. Only the database source has them. */
  profile(customerId: string): Promise<CustomerProfile | null>
  /** Roles with people and permission counts. Only the database source has them. */
  roles(): Promise<RoleSummary[]>
}

interface Deps { env: Env; pool: Pool; fetchImpl?: FetchLike }

/**
 * `BEVERLY_READ_MODE=db` (default) reads the call_centre_read views as the restricted database role.
 * `BEVERLY_READ_MODE=api` calls Beverly's admin API with the agent's own token instead.
 */
export function beverlyData({ env, pool, fetchImpl }: Deps, session: VerifiedSession): BeverlyData {
  const actor = { id: session.user.id, role: session.user.role, scoped: env.CALL_STATION_SCOPE === 'on' }
  if (env.BEVERLY_READ_MODE === 'db') {
    return {
      customers: (q, limit) => fetchCustomersDb(pool, actor, q, limit),
      customerPage: (o) => fetchCustomerPageDb(pool, actor, o),
      customerSummary: () => fetchCustomerSummaryDb(pool, actor),
      customerById: (id) => fetchCustomerByIdDb(pool, actor, id),
      meters: (id) => fetchMetersDb(pool, actor, id),
      purchases: (id) => fetchPurchasesDb(pool, actor, id),
      revealToken: (customerId, purchaseId) => revealTokenDb(pool, actor, customerId, purchaseId),
      staff: () => fetchStaffDb(pool),
      wallet: (id) => fetchWalletDb(pool, actor, id),
      profile: (id) => fetchProfileDb(pool, actor, id),
      roles: () => fetchRolesDb(pool),
    }
  }
  // API mode: Beverly's admin API returns at most 200 customers per call, so paging and totals here are limited to that window.
  // The database mode (the default) pages the whole directory.
  const apiWindow = (q: string): Promise<Customer[]> => fetchCustomers(env, session.beverlyToken, q, fetchImpl, 200)
  const matches = (c: Customer, o: CustomerPageOptions): boolean =>
    (o.kind === undefined || o.kind === 'all' || (o.kind === 'prepaid' && c.balance !== null) || (o.kind === 'postpaid' && c.balance === null) || (o.kind === 'low' && c.balance !== null && c.balance < LOW_WALLET_NAIRA)) &&
    (!o.areas?.length || o.areas.some((a) => c.area.toUpperCase().includes(a)))
  return {
    customers: (q, limit) => fetchCustomers(env, session.beverlyToken, q, fetchImpl, limit),
    customerPage: async (o) => {
      const limit = Math.min(Math.max(o.limit ?? 50, 1), 100), offset = Math.max(o.offset ?? 0, 0)
      const all = (await apiWindow(o.q)).filter((c) => matches(c, o))
      return { customers: all.slice(offset, offset + limit), total: all.length, offset, limit }
    },
    customerSummary: async () => {
      const all = await apiWindow('')
      const prepaid = all.filter((c) => c.balance !== null).length
      return { total: all.length, prepaid, postpaid: all.length - prepaid, low: all.filter((c) => c.balance !== null && c.balance < LOW_WALLET_NAIRA).length, areas: [...new Set(all.flatMap((c) => c.area.split(',').map((a) => a.trim().toUpperCase()).filter(Boolean)))].sort() }
    },
    customerById: async (id) => (await apiWindow('')).find((c) => c.id === id) ?? null,
    meters: (id) => fetchMeters(env, session.beverlyToken, id, fetchImpl),
    purchases: (id) => fetchPurchases(env, session.beverlyToken, id, fetchImpl),
    revealToken: async (_customerId, purchaseId) => {
      const p = (await fetchPurchases(env, session.beverlyToken, _customerId, fetchImpl)).find((x) => String(x.id) === purchaseId)
      return p && typeof p.token === 'string' ? p.token : null
    },
    staff: () => fetchStaff(env, session.beverlyToken, fetchImpl),
    wallet: (id) => fetchWallet(env, session.beverlyToken, id, fetchImpl),
    roles: async () => [],
    profile: async () => null,
  }
}
