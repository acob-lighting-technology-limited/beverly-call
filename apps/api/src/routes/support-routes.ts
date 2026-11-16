import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { supportMessageInputSchema, supportPatchSchema, supportPrioritySchema, supportStatusSchema, type SupportTicket } from '@beverly-call/shared'
import type { AppDeps } from '../app.js'
import { requireRole } from '../auth/guards.js'
import { auditAs } from '../audit/audit-request.js'
import { BeverlyError } from '../beverly/beverly-api.js'
import { getSupportTicket, listSupportTickets, patchSupportTicket, postSupportMessage, supportStats } from '../beverly/beverly-support.js'

const fail = (reply: FastifyReply, e: unknown) => {
  if (e instanceof BeverlyError) return reply.code(e.status === 404 ? 404 : e.status === 401 || e.status === 403 ? e.status : e.status === 400 ? 400 : 502).send({ error: e.message })
  throw e
}
const uuid = z.string().uuid()

/**
 * Beverly's customer support tickets inside the call desk. Reads and changes go through Beverly's admin API with the
 * staff member's own token, so Beverly's permission (wallet.support.manage), customer notices and logging all apply.
 * Beverly Call adds its own audit entry for every change.
 */
export const supportRoutes = ({ env, pool, fetchImpl }: AppDeps): FastifyPluginAsync => async (app) => {
  const staff = requireRole('agent', 'supervisor', 'admin')

  /** Beverly support tickets raised by or for one customer (read from the shared database). Open one for the conversation. */
  app.get<{ Params: { id: string } }>('/customers/:id/support-tickets', { preHandler: staff }, async (req, reply): Promise<SupportTicket[] | void> => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: 'Customer not found' })
    if (env.BEVERLY_READ_MODE !== 'db') return []
    const r = await pool.query<{ id: string; reference: string; customer_id: string | null; requester_name: string | null; requester_type: string | null; category: string | null; subject: string; priority: string; status: string; assigned_to_user_id: string | null; last_message_at: Date | null; created_at: Date; meter_context: unknown }>(
      `select id, reference, customer_id, requester_name, requester_type, category, subject, priority, status, assigned_to_user_id, last_message_at, created_at, meter_context
       from call_centre_read.support_tickets where customer_id = $1 order by coalesce(last_message_at, created_at) desc limit 50`, [req.params.id])
    const meter = (c: unknown): string | null => {
      if (typeof c === 'string') return c || null
      const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {}
      const v = o.meter_id ?? o.meterId ?? o.meterNumber ?? o.meter
      return typeof v === 'string' || typeof v === 'number' ? String(v) : null
    }
    return r.rows.map((t) => ({
      id: t.id, reference: t.reference, subject: t.subject, category: t.category ?? 'general', priority: supportPrioritySchema.catch('normal').parse(t.priority), status: supportStatusSchema.catch('open').parse(t.status),
      requesterType: t.requester_type ?? 'customer', requesterName: t.requester_name ?? 'Customer', customerId: t.customer_id, assignedTo: t.assigned_to_user_id,
      lastMessageAt: (t.last_message_at ?? t.created_at).toISOString(), createdAt: t.created_at.toISOString(), meterContext: meter(t.meter_context),
    }))
  })

  app.get<{ Querystring: { status?: string; search?: string; mine?: string } }>('/support/tickets', { preHandler: staff }, async (req, reply) => {
    const status = req.query.status ? supportStatusSchema.safeParse(req.query.status) : null
    if (status && !status.success) return reply.code(400).send({ error: 'Unknown status' })
    try { return await listSupportTickets(env, req.session!.beverlyToken, { status: status?.data, search: req.query.search, mine: req.query.mine === '1' }, fetchImpl) }
    catch (e) { return fail(reply, e) }
  })

  app.get('/support/stats', { preHandler: staff }, async (req, reply) => {
    try { return await supportStats(env, req.session!.beverlyToken, fetchImpl) } catch (e) { return fail(reply, e) }
  })

  app.get<{ Params: { id: string } }>('/support/tickets/:id', { preHandler: staff }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: 'Ticket not found' })
    try { return await getSupportTicket(env, req.session!.beverlyToken, req.params.id, fetchImpl) } catch (e) { return fail(reply, e) }
  })

  app.patch<{ Params: { id: string } }>('/support/tickets/:id', { preHandler: staff }, async (req, reply) => {
    const body = supportPatchSchema.safeParse(req.body)
    if (!uuid.safeParse(req.params.id).success || !body.success) return reply.code(400).send({ error: 'Invalid change' })
    if (body.data.assignToMe && body.data.unassign) return reply.code(400).send({ error: 'Choose assign or unassign, not both' })
    try {
      await patchSupportTicket(env, req.session!.beverlyToken, req.params.id, body.data, fetchImpl)
      await auditAs(pool, req, body.data.status ? `support.ticket.${body.data.status}` : 'support.ticket.update', 'support_ticket', req.params.id, { ...body.data })
      return await getSupportTicket(env, req.session!.beverlyToken, req.params.id, fetchImpl)
    } catch (e) { return fail(reply, e) }
  })

  app.post<{ Params: { id: string } }>('/support/tickets/:id/messages', { preHandler: staff, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = supportMessageInputSchema.safeParse(req.body)
    if (!uuid.safeParse(req.params.id).success || !body.success) return reply.code(400).send({ error: 'A message is required (max 4000 characters)' })
    try {
      await postSupportMessage(env, req.session!.beverlyToken, req.params.id, body.data, fetchImpl)
      // Public replies reach the customer, so they are audited as such. Internal notes stay inside the team.
      await auditAs(pool, req, body.data.internal ? 'support.ticket.note' : 'support.ticket.reply', 'support_ticket', req.params.id)
      return await getSupportTicket(env, req.session!.beverlyToken, req.params.id, fetchImpl)
    } catch (e) { return fail(reply, e) }
  })
}
