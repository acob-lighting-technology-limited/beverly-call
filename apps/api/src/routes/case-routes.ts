import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { Assignee, CaseComment, CaseEvent, CaseState, SupportCase } from '@beverly-call/shared'
import { CASE_SLA_MINUTES, addCommentSchema, assignCaseSchema, createCaseSchema, releaseCaseSchema, resolveCaseSchema } from '@beverly-call/shared'
import type { AppDeps } from '../app.js'
import { requireRole } from '../auth/guards.js'
import { auditAs } from '../audit/audit-request.js'
import { staffNames } from '../beverly/staff-directory.js'
import { africasTalking } from '../telephony/provider.js'
import { resolvedSms, sendLoggedSms } from '../notify/sms.js'
import { notify, webPushSender, type PushSender } from '../notify/notify.js'
import { assigneeList, assignablesOf, callStaff, leadsOf, type Staffer } from '../cases/case-staff.js'
import { hm } from '../time.js'

interface TicketRow {
  id: string; ticket_ref: string; category: string; priority: string; agent_crm_id: string | null; sla_due_at: Date; status: string
  customer_ref: string; amount_ngn: string | null; customer_phone: string | null; sms_on_resolve: boolean; sms_rating: boolean
  created_by_crm_id: string | null; assigned_by_crm_id: string | null; assigned_at: Date | null; accepted_at: Date | null
}
interface CommentRow { id?: string; ticket_id: string; author_name: string; body: string; created_at: Date }
interface EventRow { ticket_id: string; kind: CaseEvent['kind']; actor_name: string; from_crm_id: string | null; to_crm_id: string | null; note: string | null; created_at: Date }

const COLS = `id, ticket_ref, category, priority, agent_crm_id, sla_due_at, status, customer_ref, amount_ngn, customer_phone, sms_on_resolve, sms_rating,
  created_by_crm_id, assigned_by_crm_id, assigned_at, accepted_at`
const OPEN_STATES = `('OPEN','INVESTIGATING')`

const stateOf = (status: string, due: Date): CaseState =>
  status === 'RESOLVED' || status === 'CLOSED' ? 'Done' : due.getTime() < Date.now() ? 'Overdue' : status === 'INVESTIGATING' ? 'Working' : 'New'

const toComment = (c: CommentRow): CaseComment => ({ by: c.author_name, text: c.body, at: hm(c.created_at), ts: c.created_at.toISOString() })

/** One line a person can read for each step in a case's life. */
function eventText(e: EventRow, names: Map<string, string>): string {
  const who = (id: string | null): string => (id ? names.get(id) ?? 'someone' : 'the queue')
  const note = e.note ? ` (${e.note})` : ''
  switch (e.kind) {
    case 'opened': return e.to_crm_id === null ? `Opened by ${e.actor_name} and put in the queue` : e.to_crm_id === e.from_crm_id ? `Opened and taken by ${e.actor_name}` : `Opened by ${e.actor_name} and given to ${who(e.to_crm_id)}`
    case 'assigned': return `${e.actor_name} gave it to ${who(e.to_crm_id)}${note}`
    case 'reassigned': return `${e.actor_name} moved it from ${who(e.from_crm_id)} to ${who(e.to_crm_id)}${note}`
    case 'claimed': return `${e.actor_name} took it from the queue and started`
    case 'accepted': return `${e.actor_name} started working on it`
    case 'released': return `${e.actor_name} put it back in the queue${note}`
  }
}

const toCase = (r: TicketRow, comments: CommentRow[], events: EventRow[], names: Map<string, string>): SupportCase => ({
  id: r.ticket_ref, issue: r.category.replaceAll('_', ' '),
  by: r.agent_crm_id ? names.get(r.agent_crm_id) ?? r.agent_crm_id : 'Unassigned', agentId: r.agent_crm_id,
  slaMinutes: Math.round((r.sla_due_at.getTime() - Date.now()) / 60000), state: stateOf(r.status, r.sla_due_at),
  customer: r.customer_ref, amount: Number(r.amount_ngn ?? 0), comments: comments.filter((c) => c.ticket_id === r.id).map(toComment),
  raisedById: r.created_by_crm_id, raisedBy: r.created_by_crm_id ? names.get(r.created_by_crm_id) ?? '' : '',
  priority: r.priority, accepted: r.accepted_at !== null || r.status === 'INVESTIGATING', assignedAt: r.assigned_at ? r.assigned_at.toISOString() : null,
  events: events.filter((e) => e.ticket_id === r.id).map((e) => ({ kind: e.kind, by: e.actor_name, text: eventText(e, names), at: hm(e.created_at), ts: e.created_at.toISOString() })),
})

/**
 * Escalation cases (Tier 2) and the pipeline around them. A case is raised by one person and held by another: it can be opened straight
 * onto an agent or supervisor or into the queue, handed on by a lead or by whoever holds it, taken from the queue, accepted ("start
 * working"), returned to the queue, commented on and resolved. Every step is recorded, audited and tells the right people.
 */
export const caseRoutes = ({ env, pool, fetchImpl, provider, push }: AppDeps): FastifyPluginAsync => async (app) => {
  const staff = requireRole('agent', 'supervisor', 'admin')
  const lead = requireRole('supervisor', 'admin')
  const carrier = provider ?? africasTalking(env, fetchImpl)
  const send: PushSender | null = push === undefined ? webPushSender(env) : push

  async function load(rows: TicketRow[], token: string): Promise<SupportCase[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const [c, e, names] = await Promise.all([
      pool.query<CommentRow>('select ticket_id, author_name, body, created_at from call_centre.ticket_comments where ticket_id = any($1::uuid[]) order by created_at', [ids]),
      pool.query<EventRow>('select ticket_id, kind, actor_name, from_crm_id, to_crm_id, note, created_at from call_centre.ticket_events where ticket_id = any($1::uuid[]) order by created_at', [ids]),
      staffNames(env, token, fetchImpl, pool),
    ])
    return rows.map((r) => toCase(r, c.rows, e.rows, names))
  }
  const one = async (ref: string): Promise<TicketRow | undefined> =>
    (await pool.query<TicketRow>(`select ${COLS} from call_centre.tickets where ticket_ref = $1`, [ref])).rows[0]
  const link = (ref: string): string => `/cases?open=${encodeURIComponent(ref)}`
  const issue = (r: TicketRow): string => r.category.replaceAll('_', ' ')
  const closed = (r: TicketRow): boolean => r.status === 'RESOLVED' || r.status === 'CLOSED'
  const event = (ticketId: string, kind: CaseEvent['kind'], actor: { id: string; name: string }, from: string | null, to: string | null, note?: string | null) =>
    pool.query('insert into call_centre.ticket_events (ticket_id, kind, actor_crm_id, actor_name, from_crm_id, to_crm_id, note) values ($1,$2,$3,$4,$5,$6,$7)', [ticketId, kind, actor.id, actor.name, from, to, note ?? null])
  /** Tell one person, once per event (the key includes who and what, so a repeat of the same step is not announced twice). */
  const tell = async (userId: string | null | undefined, key: string, n: { title: string; body?: string; ref: string; tone?: 'bad' | 'ye' | 'ok' | 'vi' }): Promise<void> => {
    if (!userId) return
    await notify(pool, send, { userId, category: 'esc', tone: n.tone ?? 'ye', title: n.title, body: n.body ?? '', link: link(n.ref), dedupeKey: `${key}:${userId}` })
  }
  const nameOf = (people: Staffer[], id: string | null): string => (id ? people.find((p) => p.id === id)?.name ?? 'someone' : 'the queue')
  const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error })

  /* ---------------- reading ---------------- */
  app.get('/cases', { preHandler: lead }, async (req) => {
    const r = await pool.query<TicketRow>(`select ${COLS} from call_centre.tickets order by (status in ('RESOLVED','CLOSED')), sla_due_at asc limit 200`)
    return load(r.rows, req.session!.beverlyToken)
  })

  /** Cases the person holds or raised, so whoever opened a case can still follow it after it is handed on. */
  app.get('/cases/mine', { preHandler: staff }, async (req) => {
    const r = await pool.query<TicketRow>(`select ${COLS} from call_centre.tickets where agent_crm_id = $1 or created_by_crm_id = $1 order by (status in ('RESOLVED','CLOSED')), sla_due_at asc limit 100`, [req.session!.user.id])
    return load(r.rows, req.session!.beverlyToken)
  })

  /** Open cases nobody holds yet. Anyone on the desk can take one. */
  app.get('/cases/queue', { preHandler: staff }, async (req) => {
    const r = await pool.query<TicketRow>(`select ${COLS} from call_centre.tickets where agent_crm_id is null and status = 'OPEN' order by sla_due_at asc limit 100`)
    return load(r.rows, req.session!.beverlyToken)
  })

  /** Who a case can be given to, with presence and how much each already holds. */
  app.get('/cases/assignees', { preHandler: staff }, async (req): Promise<Assignee[]> =>
    assigneeList(pool, await callStaff({ env, pool, fetchImpl }, req.session!)))

  /** Every escalation raised for one customer, newest first, so their profile shows what is open and what was fixed. */
  app.get<{ Params: { id: string } }>('/customers/:id/cases', { preHandler: staff }, async (req) => {
    const r = await pool.query<TicketRow>(`select ${COLS} from call_centre.tickets where customer_ref = $1 order by created_at desc limit 50`, [req.params.id])
    return load(r.rows, req.session!.beverlyToken)
  })

  /** One case, for a link in an alert. Agents can open cases they hold, raised, or that are waiting in the queue. */
  app.get<{ Params: { id: string } }>('/cases/:id', { preHandler: staff }, async (req, reply) => {
    const row = await one(req.params.id)
    if (!row) return fail(reply, 404, 'Case not found')
    const me = req.session!.user
    if (me.role === 'agent' && row.agent_crm_id !== me.id && row.created_by_crm_id !== me.id && row.agent_crm_id !== null) return fail(reply, 403, 'This case is not yours')
    return (await load([row], req.session!.beverlyToken))[0]
  })

  /* ---------------- opening ---------------- */
  app.post('/cases', { preHandler: staff }, async (req, reply) => {
    const body = createCaseSchema.safeParse(req.body)
    if (!body.success) return fail(reply, 400, 'Invalid case')
    const me = req.session!.user
    const d = body.data
    const people = await callStaff({ env, pool, fetchImpl }, req.session!)
    // Omitted = the person opening it (admins do not hold cases, so theirs goes to the queue); null = the queue.
    const assignee = d.assigneeId === undefined ? (me.role === 'admin' ? null : me.id) : d.assigneeId
    if (assignee && !assignablesOf(people).some((p) => p.id === assignee)) return fail(reply, 400, 'That person cannot hold cases. Choose an agent, a supervisor or the queue.')
    const minutes = CASE_SLA_MINUTES[d.category]
    const r = await pool.query<TicketRow>(
      `insert into call_centre.tickets (ticket_ref, call_id, customer_ref, meter_number, category, priority, agent_crm_id, notes, sla_minutes, sla_due_at, amount_ngn, customer_phone,
                                        created_by_crm_id, assigned_by_crm_id, assigned_at, accepted_at)
       values ('EX-' || nextval('call_centre.ticket_ref_seq'), $1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $8::int), $9, $10,
               $11, $12, $13, $14) returning ${COLS}`,
      [d.callId ?? null, d.customerRef, d.meterNumber ?? null, d.category, d.priority, assignee, d.notes ?? null, minutes, d.amountNgn, d.customerPhone ?? null,
        me.id, assignee ? me.id : null, assignee ? new Date() : null, assignee === me.id ? new Date() : null])
    const row = r.rows[0]!
    // A case the opener keeps is already being worked on; one given to someone else waits for them to accept it.
    if (assignee === me.id) await pool.query(`update call_centre.tickets set status = 'INVESTIGATING' where id = $1`, [row.id]).then(() => { row.status = 'INVESTIGATING' })
    await event(row.id, 'opened', me, me.id, assignee, d.notes ?? null)
    if (d.callId) await pool.query(`update call_centre.calls set disposition = coalesce(disposition, 'escalated') where id = $1 and agent_crm_id = $2`, [d.callId, me.id])
    await auditAs(pool, req, 'case.create', 'ticket', row.ticket_ref, { category: d.category, assignee })

    const tone = d.priority === 'CRITICAL' || d.priority === 'HIGH' ? 'bad' : 'ye'
    if (assignee && assignee !== me.id) await tell(assignee, `assign:${row.ticket_ref}`, { title: `${row.ticket_ref} assigned to you`, body: `${me.name}: ${issue(row)}`, ref: row.ticket_ref, tone })
    // Supervisors and admins hear about new cases, and about any case nobody holds. (When the directory is unknown, everyone does.)
    const leads = leadsOf(people).filter((l) => l.id !== me.id && l.id !== assignee)
    const headline = assignee === null ? `${row.ticket_ref} is waiting in the queue` : `${row.ticket_ref} escalated`
    if (leadsOf(people).length) for (const l of leads) await tell(l.id, `new:${row.ticket_ref}`, { title: headline, body: issue(row), ref: row.ticket_ref, tone })
    else await notify(pool, send, { category: 'esc', tone, title: headline, body: issue(row), link: link(row.ticket_ref), dedupeKey: `new:${row.ticket_ref}` })
    return reply.code(201).send((await load([row], req.session!.beverlyToken))[0])
  })

  /* ---------------- moving a case between people ---------------- */
  app.post<{ Params: { id: string } }>('/cases/:id/assign', { preHandler: staff }, async (req, reply) => {
    const body = assignCaseSchema.safeParse(req.body)
    if (!body.success) return fail(reply, 400, 'Invalid assignee')
    const me = req.session!.user
    const row = await one(req.params.id)
    if (!row || closed(row)) return fail(reply, 404, 'Case not found or already closed')
    const isLead = me.role === 'supervisor' || me.role === 'admin'
    if (!isLead && row.agent_crm_id !== me.id) return fail(reply, 403, 'Only a supervisor, or the person holding this case, can hand it on')
    const people = await callStaff({ env, pool, fetchImpl }, req.session!)
    const target = assignablesOf(people).find((p) => p.id === body.data.agentId)
    if (!target) return fail(reply, 400, 'That person cannot hold cases. Choose an agent or a supervisor.')
    if (row.agent_crm_id === target.id) return fail(reply, 409, `${target.name} already holds this case`)
    const prev = row.agent_crm_id
    // Only moves the case if it still has the holder we looked at, so two people moving it at once cannot both win silently.
    const r = await pool.query<TicketRow>(
      `update call_centre.tickets set agent_crm_id = $2, assigned_by_crm_id = $3, assigned_at = now(), accepted_at = null, status = 'OPEN'
       where ticket_ref = $1 and status in ${OPEN_STATES} and agent_crm_id is not distinct from $4 returning ${COLS}`, [row.ticket_ref, target.id, me.id, prev])
    const updated = r.rows[0]
    if (!updated) return fail(reply, 409, 'This case just changed. Reload it and try again.')
    await event(updated.id, prev ? 'reassigned' : 'assigned', me, prev, target.id, body.data.note)
    await auditAs(pool, req, 'case.assign', 'ticket', updated.ticket_ref, { from: prev, to: target.id, note: body.data.note ?? null })

    const mine = (id: string | null | undefined): boolean => id === me.id
    if (!mine(target.id)) await tell(target.id, `assign:${updated.ticket_ref}:${Date.now()}`, { title: `${updated.ticket_ref} assigned to you`, body: `${me.name}: ${issue(updated)}`, ref: updated.ticket_ref })
    if (prev && !mine(prev) && prev !== target.id) await tell(prev, `moved:${updated.ticket_ref}:${Date.now()}`, { title: `${updated.ticket_ref} was moved to ${target.name}`, body: issue(updated), ref: updated.ticket_ref, tone: 'vi' })
    if (updated.created_by_crm_id && ![me.id, target.id, prev].includes(updated.created_by_crm_id)) {
      await tell(updated.created_by_crm_id, `with:${updated.ticket_ref}:${Date.now()}`, { title: `${updated.ticket_ref} is now with ${target.name}`, body: issue(updated), ref: updated.ticket_ref, tone: 'vi' })
    }
    return (await load([updated], req.session!.beverlyToken))[0]
  })

  /** Take a case from the queue. Taking it also means starting work on it. */
  app.post<{ Params: { id: string } }>('/cases/:id/claim', { preHandler: staff }, async (req, reply) => {
    const me = req.session!.user
    if (me.role === 'admin') return fail(reply, 403, 'Admins do not hold cases. Give it to an agent or a supervisor.')
    const r = await pool.query<TicketRow>(
      `update call_centre.tickets set agent_crm_id = $2, assigned_by_crm_id = $2, assigned_at = now(), accepted_at = now(), status = 'INVESTIGATING'
       where ticket_ref = $1 and agent_crm_id is null and status = 'OPEN' returning ${COLS}`, [req.params.id, me.id])
    const row = r.rows[0]
    if (!row) {
      const now = await one(req.params.id)
      if (!now) return fail(reply, 404, 'Case not found')
      return fail(reply, 409, closed(now) ? 'This case is already closed' : 'Someone already took this case')
    }
    await event(row.id, 'claimed', me, null, me.id)
    await auditAs(pool, req, 'case.claim', 'ticket', row.ticket_ref)
    if (row.created_by_crm_id && row.created_by_crm_id !== me.id) await tell(row.created_by_crm_id, `took:${row.ticket_ref}`, { title: `${me.name} took ${row.ticket_ref}`, body: issue(row), ref: row.ticket_ref, tone: 'ok' })
    return (await load([row], req.session!.beverlyToken))[0]
  })

  /** The holder starts working on a case that was given to them. */
  app.post<{ Params: { id: string } }>('/cases/:id/accept', { preHandler: staff }, async (req, reply) => {
    const me = req.session!.user
    const row = await one(req.params.id)
    if (!row || closed(row)) return fail(reply, 404, 'Case not found or already closed')
    if (row.agent_crm_id !== me.id) return fail(reply, 403, 'Only the person holding this case can start it')
    if (row.status === 'INVESTIGATING') return (await load([row], req.session!.beverlyToken))[0]   // already started: nothing to do
    const r = await pool.query<TicketRow>(
      `update call_centre.tickets set status = 'INVESTIGATING', accepted_at = now() where ticket_ref = $1 and agent_crm_id = $2 and status = 'OPEN' returning ${COLS}`, [row.ticket_ref, me.id])
    const updated = r.rows[0] ?? row
    if (r.rows[0]) {
      await event(updated.id, 'accepted', me, null, me.id)
      await auditAs(pool, req, 'case.accept', 'ticket', updated.ticket_ref)
      for (const who of new Set([updated.assigned_by_crm_id, updated.created_by_crm_id])) if (who && who !== me.id) await tell(who, `started:${updated.ticket_ref}`, { title: `${me.name} started ${updated.ticket_ref}`, body: issue(updated), ref: updated.ticket_ref, tone: 'ok' })
    }
    return (await load([updated], req.session!.beverlyToken))[0]
  })

  /** Put a case back in the queue (the holder cannot take it, or a supervisor is rebalancing work). */
  app.post<{ Params: { id: string } }>('/cases/:id/release', { preHandler: staff }, async (req, reply) => {
    const body = releaseCaseSchema.safeParse(req.body ?? {})
    if (!body.success) return fail(reply, 400, 'Invalid request')
    const me = req.session!.user
    const row = await one(req.params.id)
    if (!row || closed(row)) return fail(reply, 404, 'Case not found or already closed')
    const isLead = me.role === 'supervisor' || me.role === 'admin'
    if (!isLead && row.agent_crm_id !== me.id) return fail(reply, 403, 'Only a supervisor, or the person holding this case, can put it back')
    if (row.agent_crm_id === null) return fail(reply, 409, 'This case is already in the queue')
    const prev = row.agent_crm_id
    const r = await pool.query<TicketRow>(
      `update call_centre.tickets set agent_crm_id = null, assigned_by_crm_id = null, assigned_at = null, accepted_at = null, status = 'OPEN'
       where ticket_ref = $1 and status in ${OPEN_STATES} and agent_crm_id = $2 returning ${COLS}`, [row.ticket_ref, prev])
    const updated = r.rows[0]
    if (!updated) return fail(reply, 409, 'This case just changed. Reload it and try again.')
    await event(updated.id, 'released', me, prev, null, body.data.note)
    await auditAs(pool, req, 'case.release', 'ticket', updated.ticket_ref, { from: prev, note: body.data.note ?? null })
    const people = await callStaff({ env, pool, fetchImpl }, req.session!)
    for (const l of leadsOf(people)) if (l.id !== me.id) await tell(l.id, `back:${updated.ticket_ref}:${Date.now()}`, { title: `${updated.ticket_ref} is back in the queue`, body: `${nameOf(people, prev)} could not keep it${body.data.note ? `: ${body.data.note}` : ''}`, ref: updated.ticket_ref, tone: 'bad' })
    if (prev !== me.id) await tell(prev, `released:${updated.ticket_ref}:${Date.now()}`, { title: `${updated.ticket_ref} was taken off you`, body: `${me.name} put it back in the queue`, ref: updated.ticket_ref, tone: 'vi' })
    return (await load([updated], req.session!.beverlyToken))[0]
  })

  /* ---------------- working a case ---------------- */
  app.post<{ Params: { id: string } }>('/cases/:id/resolve', { preHandler: staff }, async (req, reply) => {
    const body = resolveCaseSchema.safeParse(req.body)
    if (!body.success) return fail(reply, 400, 'A resolution note is required')
    const me = req.session!.user
    const existing = await one(req.params.id)
    if (existing && me.role === 'agent' && existing.agent_crm_id !== me.id) return fail(reply, 403, 'This case is not yours')
    const r = await pool.query<TicketRow>(
      `update call_centre.tickets set status='RESOLVED', resolution_note=$2, resolved_at=now()
       where ticket_ref=$1 and status not in ('RESOLVED','CLOSED') returning ${COLS}`, [req.params.id, body.data.note])
    const row = r.rows[0]
    if (!row) return fail(reply, 404, 'Case not found or already closed')
    await pool.query('insert into call_centre.ticket_comments (ticket_id, author_crm_id, author_name, body) values ($1,$2,$3,$4)', [row.id, me.id, me.name, `Resolved: ${body.data.note}`])
    if (row.sms_on_resolve && row.customer_phone) await sendLoggedSms(pool, carrier, row.customer_phone, resolvedSms(row.ticket_ref, row.sms_rating), 'case_resolved', me.id)
    await auditAs(pool, req, 'case.resolve', 'ticket', row.ticket_ref)
    for (const who of new Set([row.created_by_crm_id, row.agent_crm_id])) if (who && who !== me.id) await tell(who, `resolved:${row.ticket_ref}`, { title: `${row.ticket_ref} was resolved`, body: `${me.name}: ${body.data.note}`.slice(0, 160), ref: row.ticket_ref, tone: 'ok' })
    return (await load([row], req.session!.beverlyToken))[0]
  })

  app.post<{ Params: { id: string } }>('/cases/:id/comments', { preHandler: staff }, async (req, reply) => {
    const body = addCommentSchema.safeParse(req.body)
    if (!body.success) return fail(reply, 400, 'A comment is required (max 1000 characters)')
    const me = req.session!.user
    const row = await one(req.params.id)
    if (!row) return fail(reply, 404, 'Case not found')
    // The holder and whoever raised the case can both talk about it; other agents cannot.
    if (me.role === 'agent' && row.agent_crm_id !== me.id && row.created_by_crm_id !== me.id) return fail(reply, 403, 'This case is not yours')
    const c = await pool.query<{ id: string }>('insert into call_centre.ticket_comments (ticket_id, author_crm_id, author_name, body) values ($1,$2,$3,$4) returning id', [row.id, me.id, me.name, body.data.text])
    await auditAs(pool, req, 'case.comment', 'ticket', row.ticket_ref)
    for (const who of new Set([row.agent_crm_id, row.created_by_crm_id])) if (who && who !== me.id) await tell(who, `comment:${c.rows[0]!.id}`, { title: `${me.name} commented on ${row.ticket_ref}`, body: body.data.text.slice(0, 160), ref: row.ticket_ref, tone: 'vi' })
    return (await load([row], req.session!.beverlyToken))[0]
  })
}
