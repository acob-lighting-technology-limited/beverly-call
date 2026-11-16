import type { FastifyPluginAsync } from 'fastify'
import { bindingStatusSchema, createBindingSchema, decideBindingSchema, type PhoneBinding } from '@beverly-call/shared'
import type { AppDeps } from '../app.js'
import { requireRole } from '../auth/guards.js'
import { auditAs } from '../audit/audit-request.js'
import { BeverlyError, phoneTail } from '../beverly/beverly-api.js'
import { beverlyData } from '../beverly/beverly-data.js'
import { africasTalking } from '../telephony/provider.js'
import { sendLoggedSms } from '../notify/sms.js'

interface Row {
  id: string; phone: string; customer_id: string; meter_sn: string; label: string | null; status: PhoneBinding['status']; checks: PhoneBinding['checks']
  requested_by: string; requested_by_name: string; created_at: Date; decided_by: string | null; decision_note: string | null; crm_result: string | null; customer_name: string | null
}

const SELECT = `select b.id, b.phone, b.customer_id, b.meter_sn, b.label, b.status, b.checks, b.requested_by, b.requested_by_name, b.created_at, b.decided_by, b.decision_note, b.crm_result,
  (select max(d.full_name) from call_centre_read.directory d where d.customer_id = b.customer_id) as customer_name
  from call_centre.phone_bindings b`

const toBinding = (r: Row, decider: string | null): PhoneBinding => ({
  id: r.id, phone: r.phone, customerId: r.customer_id, customerName: r.customer_name, meter: r.meter_sn, label: r.label, status: r.status, checks: r.checks,
  requestedBy: r.requested_by, requestedByName: r.requested_by_name, createdAt: r.created_at.toISOString(), decidedByName: decider, decisionNote: r.decision_note, crmResult: r.crm_result,
})

/**
 * Binding calling numbers to customers. Any number of numbers may be bound to one customer, meter or account (spouse, tenant,
 * caretaker), and one number may cover several meters of the same customer, but a number never belongs to two customers.
 * Agents request after verifying the caller; a different supervisor approves; approval writes the number into Beverly's CRM
 * (only when it has no phone for the customer) and from then on the number identifies the caller on every call.
 */
export const bindingRoutes = ({ env, pool, fetchImpl, provider }: AppDeps): FastifyPluginAsync => async (app) => {
  const staff = requireRole('agent', 'supervisor', 'admin')
  const lead = requireRole('supervisor', 'admin')
  const carrier = provider ?? africasTalking(env, fetchImpl)

  app.post('/bindings', { preHandler: staff }, async (req, reply) => {
    const body = createBindingSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Invalid binding request' })
    if (env.BEVERLY_READ_MODE !== 'db') return reply.code(501).send({ error: 'Binding needs the shared database connection' })
    const me = req.session!.user
    const d = body.data
    const tail = phoneTail(d.phone)
    if (tail.length !== 10) return reply.code(400).send({ error: 'Enter a full Nigerian phone number' })
    let owned: string[]
    try { owned = await beverlyData({ env, pool, fetchImpl }, req.session!).meters(d.customerId) } catch (e) {
      if (e instanceof BeverlyError) return reply.code(e.status === 403 ? 403 : 404).send({ error: e.message })
      throw e
    }
    const norm = (m: string) => m.replace(/\s+/g, '')
    const ownedSet = new Set(owned.map(norm))
    if (d.meters.some((m) => !ownedSet.has(norm(m)))) return reply.code(400).send({ error: 'A meter does not belong to this customer' })
    const other = await pool.query('select 1 from call_centre_read.directory_phones where phone_tail = $1 and customer_id <> $2 limit 1', [tail, d.customerId])
    if (other.rowCount) return reply.code(409).send({ error: 'This number already belongs to another customer' })
    const ids: string[] = []
    for (const m of d.meters) {
      const r = await pool.query<{ id: string }>(
        `insert into call_centre.phone_bindings (phone, phone_tail, customer_id, meter_sn, label, checks, call_id, requested_by, requested_by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,
        [`0${tail}`, tail, d.customerId, m, d.label ?? null, JSON.stringify(d.checks), d.callId ?? null, me.id, me.name])
      if (r.rows[0]) ids.push(r.rows[0].id)
    }
    if (!ids.length) return reply.code(409).send({ error: 'This number is already bound or waiting for approval for those meters' })
    await auditAs(pool, req, 'binding.request', 'customer', d.customerId, { meters: d.meters.length, checks: d.checks })
    const rows = await pool.query<Row>(`${SELECT} where b.id = any($1::uuid[]) order by b.created_at`, [ids])
    return reply.code(201).send(rows.rows.map((r) => toBinding(r, null)))
  })

  /** Supervisors and admins see the queue; agents see what they requested. */
  app.get<{ Querystring: { status?: string } }>('/bindings', { preHandler: staff }, async (req, reply) => {
    const status = req.query.status === undefined ? null : bindingStatusSchema.safeParse(req.query.status)
    if (status && !status.success) return reply.code(400).send({ error: 'Invalid status' })
    const me = req.session!.user
    const r = await pool.query<Row>(
      `${SELECT} where ($1::text is null or b.status = $1) and ($2::boolean or b.requested_by = $3) order by b.created_at desc limit 200`,
      [status?.data ?? null, me.role !== 'agent', me.id])
    return r.rows.map((x) => toBinding(x, x.decided_by))
  })

  app.post<{ Params: { id: string } }>('/bindings/:id/decision', { preHandler: lead }, async (req, reply) => {
    const body = decideBindingSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid decision' })
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(404).send({ error: 'Binding not found' })
    const me = req.session!.user
    const cur = (await pool.query<Row>(`${SELECT} where b.id = $1`, [req.params.id])).rows[0]
    if (!cur) return reply.code(404).send({ error: 'Binding not found' })
    if (cur.requested_by === me.id) return reply.code(403).send({ error: 'Someone else must approve your request' })
    if (!body.data.approve) {
      const r = await pool.query(`update call_centre.phone_bindings set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1 and status = 'pending'`, [cur.id, me.id, body.data.note ?? null])
      if (!r.rowCount) return reply.code(409).send({ error: 'This request was already decided' })
      await auditAs(pool, req, 'binding.reject', 'customer', cur.customer_id, { meter: cur.meter_sn })
      return toBinding({ ...cur, status: 'rejected', decision_note: body.data.note ?? null }, me.name)
    }
    // Approve (or retry a half-finished approval), then write to the CRM through the one narrow database function.
    const ok = await pool.query(`update call_centre.phone_bindings set status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1 and status in ('pending','approved')`, [cur.id, me.id, body.data.note ?? null])
    if (!ok.rowCount) return reply.code(409).send({ error: 'This request was already decided' })
    const applied = await pool.query<{ r: { result: string } }>('select call_centre.apply_phone_binding($1, $2) as r', [cur.id, me.id])
    const result = applied.rows[0]?.r.result ?? null
    await auditAs(pool, req, 'binding.apply', 'customer', cur.customer_id, { meter: cur.meter_sn, crm: result })
    await sendLoggedSms(pool, carrier, cur.phone, 'Beverly: this number is now linked to your meter. Calls from it are recognised. If this was not you, reply STOP or call us.', 'agent', me.id).catch(() => undefined)
    return toBinding({ ...cur, status: 'applied', crm_result: result }, me.name)
  })

  /** Numbers that identify a customer: the CRM's and every bound one. */
  app.get<{ Params: { id: string } }>('/customers/:id/numbers', { preHandler: staff }, async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(404).send({ error: 'Customer not found' })
    const r = await pool.query<{ phone_tail: string; source: string }>('select phone_tail, source from call_centre_read.directory_phones where customer_id = $1 order by source, phone_tail', [req.params.id])
    return r.rows.map((x) => ({ phone: `0${x.phone_tail}`, source: x.source }))
  })
}
