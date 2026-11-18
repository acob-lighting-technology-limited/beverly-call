import type { Pool } from 'pg'
import type { Assignee } from '@beverly-call/shared'
import type { Env } from '../config/env.js'
import type { VerifiedSession } from '../auth/session-token.js'
import type { FetchLike } from '../beverly/beverly-auth.js'
import { beverlyData } from '../beverly/beverly-data.js'

export type DeskRole = 'agent' | 'supervisor' | 'admin'
export interface Staffer { id: string; name: string; role: DeskRole }

/**
 * The desk role of a Beverly staff member who has call-centre access. The fixed Beverly roles map directly; any other role that was
 * granted access (operations managers and the like) leads the desk when its name says so, and works as an agent otherwise, the same
 * rule sign-on uses.
 */
export const deskRoleOf = (roleKey: string | null | undefined): DeskRole =>
  roleKey === 'super-admin' ? 'admin' : roleKey === 'custom-call-centre-supervisor' || /manager|supervisor/i.test(roleKey ?? '') ? 'supervisor' : 'agent'

interface Deps { env: Env; pool: Pool; fetchImpl?: FetchLike }

/**
 * Everyone with call-centre access. Read from Beverly's staff data; when Beverly will not show the directory to this person (API mode,
 * a role without access management), fall back to people Beverly Call has seen sign in, who are all agents or supervisors.
 */
export async function callStaff(deps: Deps, session: VerifiedSession): Promise<Staffer[]> {
  const rows = await beverlyData(deps, session).staff().catch(() => [])
  const out = new Map<string, Staffer>()
  for (const s of rows) {
    if (!s.portal_access?.includes('call')) continue
    const id = s.auth_user_id ?? s.id
    if (!id) continue
    out.set(id, { id, name: s.user_name ?? s.email ?? 'Staff', role: deskRoleOf(s.role_key) })
  }
  // Beverly's API only shows its staff directory to people who manage access, so in API mode (and when the database directory is empty)
  // anyone who has signed in to Beverly Call also counts. Admins are marked on their presence row and never hold cases.
  if (!out.size || deps.env.BEVERLY_READ_MODE !== 'db') {
    const seen = await deps.pool.query<{ agent_crm_id: string; name: string; skills: string[] | null }>('select agent_crm_id, name, skills from call_centre.agent_presence')
    for (const p of seen.rows) if (!out.has(p.agent_crm_id)) out.set(p.agent_crm_id, { id: p.agent_crm_id, name: p.name, role: p.skills?.includes('role:admin') ? 'admin' : p.skills?.includes('role:supervisor') ? 'supervisor' : 'agent' })
  }
  // Whoever is signed in right now is always known, even if the directory has not caught up.
  const me = session.user
  if (!out.has(me.id)) out.set(me.id, { id: me.id, name: me.name, role: me.role })
  return [...out.values()]
}

/** People a case can be given to: agents and supervisors. Admins run the desk but do not hold cases. */
export const assignablesOf = (staff: Staffer[]): Staffer[] => staff.filter((s) => s.role !== 'admin')

/** Supervisors and admins, who see the whole queue and are told about new and overdue cases. */
export const leadsOf = (staff: Staffer[]): Staffer[] => staff.filter((s) => s.role !== 'agent')

/** The picker list: who they are, whether they are around, and how many cases they already hold. */
export async function assigneeList(pool: Pool, staff: Staffer[]): Promise<Assignee[]> {
  const [presence, load] = await Promise.all([
    pool.query<{ agent_crm_id: string; status: string; fresh: boolean }>(
      `select agent_crm_id, status, last_seen > now() - interval '90 seconds' as fresh from call_centre.agent_presence`),
    pool.query<{ agent_crm_id: string; n: string }>(
      `select agent_crm_id, count(*) n from call_centre.tickets where status in ('OPEN','INVESTIGATING') and agent_crm_id is not null group by agent_crm_id`),
  ])
  const p = new Map(presence.rows.map((r) => [r.agent_crm_id, r.fresh ? r.status : 'offline']))
  const n = new Map(load.rows.map((r) => [r.agent_crm_id, Number(r.n)]))
  const order: Record<string, number> = { available: 0, busy: 1, acw: 2, break: 3, away: 4, offline: 5 }
  return assignablesOf(staff)
    .map((s): Assignee => ({ id: s.id, name: s.name, role: s.role as 'agent' | 'supervisor', presence: (p.get(s.id) ?? 'offline') as Assignee['presence'], openCases: n.get(s.id) ?? 0 }))
    .sort((a, b) => (order[a.presence]! - order[b.presence]!) || (a.openCases - b.openCases) || a.name.localeCompare(b.name))
}

/** For jobs that only have a pool: the supervisors and admins to tell about a case nobody holds. Null when Beverly's staff data cannot be read. */
export async function leadIdsFromDb(pool: Pool): Promise<string[] | null> {
  try {
    const r = await pool.query<{ id: string | null; role_key: string | null }>(`select auth_user_id::text as id, role_key from call_centre_read.staff where 'call' = any(portal_access)`)
    const ids = r.rows.filter((s) => s.id && (s.role_key === 'super-admin' || s.role_key === 'custom-call-centre-supervisor' || /manager|supervisor/i.test(s.role_key ?? ''))).map((s) => s.id!)
    return ids.length ? ids : null
  } catch { return null }
}
