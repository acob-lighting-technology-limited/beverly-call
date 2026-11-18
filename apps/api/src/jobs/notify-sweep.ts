import type { Pool } from 'pg'
import { notify, type PushSender } from '../notify/notify.js'
import { leadIdsFromDb } from '../cases/case-staff.js'

/** An outbound (click to call) call has no carrier event to end it. One left open this long was abandoned, so it is closed and the agent freed. */
export const STALE_OUTBOUND_HOURS = 4

export async function closeStaleOutboundCalls(pool: Pool): Promise<number> {
  const r = await pool.query<{ agent_crm_id: string }>(
    `update call_centre.calls set ended_at = now(), disposition = coalesce(disposition, 'No outcome recorded')
     where direction = 'outbound' and ended_at is null and started_at < now() - ($1 || ' hours')::interval returning agent_crm_id`, [STALE_OUTBOUND_HOURS])
  const agents = [...new Set(r.rows.map((x) => x.agent_crm_id).filter(Boolean))]
  if (agents.length) await pool.query(`update call_centre.agent_presence set status = 'available', idle_since = now() where agent_crm_id = any($1::text[]) and status in ('busy','acw')`, [agents])
  return r.rowCount ?? 0
}

/**
 * Creates alerts for newly overdue cases, callbacks due soon and recordings waiting too long to ingest, and closes abandoned click-to-call calls.
 * Idempotent: dedupe keys mean each event alerts once, so the job can run every minute.
 */
export async function notifySweep(pool: Pool, send: PushSender | null): Promise<number> {
  let created = 0
  await closeStaleOutboundCalls(pool)
  const over = await pool.query<{ ticket_ref: string; category: string; agent_crm_id: string | null }>(
    `select ticket_ref, category, agent_crm_id from call_centre.tickets
     where status in ('OPEN','INVESTIGATING') and sla_due_at < now()`)
  for (const t of over.rows) {
    const body = t.category.replaceAll('_', ' ')
    if (t.agent_crm_id) {
      if (await notify(pool, send, { userId: t.agent_crm_id, category: 'esc', tone: 'bad', title: `${t.ticket_ref} is past its deadline`, body, link: `/cases?open=${t.ticket_ref}`, dedupeKey: `overdue:${t.ticket_ref}` })) created++
    } else {
      // Nobody holds it: the supervisors and admins are told (everyone is, only if Beverly's staff data cannot be read).
      const leads = await leadIdsFromDb(pool)
      for (const id of leads ?? [null]) {
        if (await notify(pool, send, { userId: id, category: 'esc', tone: 'bad', title: `${t.ticket_ref} is past its deadline and nobody holds it`, body, link: `/cases?open=${t.ticket_ref}`, dedupeKey: `overdue:${t.ticket_ref}${id ? `:${id}` : ''}` })) created++
      }
    }
  }
  const due = await pool.query<{ callback_ref: string; phone_number: string; assigned_to_crm_id: string | null }>(
    `select callback_ref, phone_number, assigned_to_crm_id from call_centre.callbacks
     where status in ('pending','assigned') and scheduled_for <= now() + interval '15 minutes'`)
  for (const c of due.rows) {
    if (await notify(pool, send, { userId: c.assigned_to_crm_id, category: 'cb', tone: 'ye', title: 'Callback due soon', body: c.phone_number, link: '/cb', dedupeKey: `cbdue:${c.callback_ref}` })) created++
  }
  const stuck = await pool.query<{ n: string }>(
    `select count(*) n from call_centre.recordings where ingested_at is null and deleted_at is null and source_url is not null and created_at < now() - interval '1 hour'`)
  if (Number(stuck.rows[0]?.n ?? 0) > 0) {
    const hour = new Date().toISOString().slice(0, 13)
    if (await notify(pool, send, { category: 'sys', tone: 'ye', title: 'Recordings are not being saved', body: `${stuck.rows[0]!.n} waiting more than an hour`, link: '/rec', dedupeKey: `ingest-stuck:${hour}` })) created++
  }
  return created
}
