import type { FastifyPluginAsync } from 'fastify'
import {
  assignRotationSchema, overrideSchema, photoInputSchema, rotationInputSchema, shiftTemplateInputSchema,
  type Roster, type RosterCell, type RosterRow, type Rotation, type ShiftTemplate,
} from '@beverly-call/shared'
import type { AppDeps } from '../app.js'
import { requireRole } from '../auth/guards.js'
import { auditAs } from '../audit/audit-request.js'
import { beverlyData } from '../beverly/beverly-data.js'
import { staffNames } from '../beverly/staff-directory.js'
import { notify, webPushSender } from '../notify/notify.js'
import { addDays, isOvernight, lagosNow, mondayOf, weekday } from '../shifts/engine.js'
import { isOnShift, loadPolicy, loadShiftData, resolveDay } from '../shifts/store.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const hhmm = (t: string): string => t.slice(0, 5)

/**
 * Shifts and photos. Admins define shift templates and rotations, assign agents (with an offset so teams are staggered) and set
 * single-day overrides for swaps and leave. Supervisors read the roster; agents read their own. When the admin turns on enforcement
 * (setting `shift_policy`), call routing only offers calls to agents who are on shift.
 */
export const shiftRoutes = ({ env, pool, fetchImpl, push }: AppDeps): FastifyPluginAsync => async (app) => {
  const admin = requireRole('admin')
  const lead = requireRole('supervisor', 'admin')
  const staff = requireRole('agent', 'supervisor', 'admin')
  const send = push === undefined ? webPushSender(env) : push
  const today = (): string => lagosNow(new Date()).day

  /* ---- templates ---- */
  const toTemplate = (r: { id: string; name: string; start_time: string; end_time: string; color: string; active: boolean }): ShiftTemplate =>
    ({ id: r.id, name: r.name, start: hhmm(r.start_time), end: hhmm(r.end_time), color: r.color, active: r.active, overnight: isOvernight({ start: hhmm(r.start_time), end: hhmm(r.end_time) }) })
  const TCOLS = 'id, name, start_time::text, end_time::text, color, active'

  app.get('/admin/shifts/templates', { preHandler: lead }, async () => (await pool.query(`select ${TCOLS} from call_centre.shift_templates order by start_time, name`)).rows.map(toTemplate))

  app.post('/admin/shifts/templates', { preHandler: admin }, async (req, reply) => {
    const b = shiftTemplateInputSchema.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'Invalid shift' })
    try {
      const r = await pool.query(`insert into call_centre.shift_templates (name, start_time, end_time, color) values ($1,$2,$3,$4) returning ${TCOLS}`, [b.data.name, b.data.start, b.data.end, b.data.color])
      await auditAs(pool, req, 'shift.template.create', 'shift', b.data.name)
      return reply.code(201).send(toTemplate(r.rows[0]))
    } catch (e) { if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'A shift with that name exists' }); throw e }
  })

  app.put<{ Params: { id: string } }>('/admin/shifts/templates/:id', { preHandler: admin }, async (req, reply) => {
    const b = shiftTemplateInputSchema.safeParse(req.body)
    if (!b.success || !/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(400).send({ error: 'Invalid shift' })
    const r = await pool.query(`update call_centre.shift_templates set name=$2, start_time=$3, end_time=$4, color=$5 where id=$1 returning ${TCOLS}`, [req.params.id, b.data.name, b.data.start, b.data.end, b.data.color])
    if (!r.rows[0]) return reply.code(404).send({ error: 'Shift not found' })
    await auditAs(pool, req, 'shift.template.update', 'shift', req.params.id)
    return toTemplate(r.rows[0])
  })

  app.delete<{ Params: { id: string } }>('/admin/shifts/templates/:id', { preHandler: admin }, async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(404).send({ error: 'Shift not found' })
    const used = await pool.query('select 1 from call_centre.rotations where steps::text like $1 limit 1', [`%${req.params.id}%`])
    if (used.rowCount) return reply.code(409).send({ error: 'This shift is used by a rotation. Remove it from the rotation first.' })
    const r = await pool.query('delete from call_centre.shift_templates where id = $1', [req.params.id])
    if (!r.rowCount) return reply.code(404).send({ error: 'Shift not found' })
    await auditAs(pool, req, 'shift.template.delete', 'shift', req.params.id)
    return reply.code(204).send()
  })

  /* ---- rotations ---- */
  const RCOLS = `r.id, r.name, r.anchor_date::text as anchor_date, r.steps, (select count(*) from call_centre.agent_rotation a where a.rotation_id = r.id) as agents`
  const toRotation = (r: { id: string; name: string; anchor_date: string; steps: Rotation['steps']; agents: string }): Rotation => ({ id: r.id, name: r.name, anchorDate: r.anchor_date, steps: r.steps, agents: Number(r.agents) })
  const stepsOk = async (steps: Rotation['steps']): Promise<boolean> => {
    const ids = [...new Set(steps.map((s) => s.shiftId).filter((x): x is string => !!x))]
    if (!ids.length) return true
    return Number((await pool.query('select count(*) as n from call_centre.shift_templates where id = any($1::uuid[])', [ids])).rows[0].n) === ids.length
  }

  app.get('/admin/shifts/rotations', { preHandler: lead }, async () => (await pool.query(`select ${RCOLS} from call_centre.rotations r order by r.name`)).rows.map(toRotation))

  app.post('/admin/shifts/rotations', { preHandler: admin }, async (req, reply) => {
    const b = rotationInputSchema.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'Invalid rotation' })
    if (weekday(b.data.anchorDate) !== 0) return reply.code(400).send({ error: 'The first week must start on a Monday' })
    if (!(await stepsOk(b.data.steps))) return reply.code(400).send({ error: 'A week uses a shift that does not exist' })
    try {
      const r = await pool.query(`insert into call_centre.rotations (name, anchor_date, steps, updated_by) values ($1,$2,$3,$4) returning id`, [b.data.name, b.data.anchorDate, JSON.stringify(b.data.steps), req.session!.user.id])
      await auditAs(pool, req, 'shift.rotation.create', 'rotation', b.data.name)
      return reply.code(201).send(toRotation((await pool.query(`select ${RCOLS} from call_centre.rotations r where r.id = $1`, [r.rows[0].id])).rows[0]))
    } catch (e) { if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'A rotation with that name exists' }); throw e }
  })

  app.put<{ Params: { id: string } }>('/admin/shifts/rotations/:id', { preHandler: admin }, async (req, reply) => {
    const b = rotationInputSchema.safeParse(req.body)
    if (!b.success || !/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(400).send({ error: 'Invalid rotation' })
    if (weekday(b.data.anchorDate) !== 0) return reply.code(400).send({ error: 'The first week must start on a Monday' })
    if (!(await stepsOk(b.data.steps))) return reply.code(400).send({ error: 'A week uses a shift that does not exist' })
    const r = await pool.query('update call_centre.rotations set name=$2, anchor_date=$3, steps=$4, updated_by=$5 where id=$1', [req.params.id, b.data.name, b.data.anchorDate, JSON.stringify(b.data.steps), req.session!.user.id])
    if (!r.rowCount) return reply.code(404).send({ error: 'Rotation not found' })
    await auditAs(pool, req, 'shift.rotation.update', 'rotation', req.params.id)
    const people = await pool.query<{ agent_crm_id: string }>('select agent_crm_id from call_centre.agent_rotation where rotation_id = $1', [req.params.id])
    for (const p of people.rows) await notify(pool, send, { userId: p.agent_crm_id, category: 'sys', tone: 'ye', title: 'Your shift rotation changed', body: b.data.name, link: '/cb' })
    return toRotation((await pool.query(`select ${RCOLS} from call_centre.rotations r where r.id = $1`, [req.params.id])).rows[0])
  })

  app.delete<{ Params: { id: string } }>('/admin/shifts/rotations/:id', { preHandler: admin }, async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(404).send({ error: 'Rotation not found' })
    const n = await pool.query('select count(*) as n from call_centre.agent_rotation where rotation_id = $1', [req.params.id])
    if (Number(n.rows[0].n) > 0) return reply.code(409).send({ error: 'Agents are still on this rotation. Move them first.' })
    const r = await pool.query('delete from call_centre.rotations where id = $1', [req.params.id])
    if (!r.rowCount) return reply.code(404).send({ error: 'Rotation not found' })
    await auditAs(pool, req, 'shift.rotation.delete', 'rotation', req.params.id)
    return reply.code(204).send()
  })

  /* ---- assignments and overrides ---- */
  app.put<{ Params: { agentId: string } }>('/admin/shifts/assignments/:agentId', { preHandler: admin }, async (req, reply) => {
    const b = assignRotationSchema.safeParse(req.body)
    if (!b.success || req.params.agentId.length > 64) return reply.code(400).send({ error: 'Invalid assignment' })
    const agent = req.params.agentId
    if (b.data.rotationId === null) {
      await pool.query('delete from call_centre.agent_rotation where agent_crm_id = $1', [agent])
      await auditAs(pool, req, 'shift.assign', 'agent', agent, { rotation: null })
      return reply.code(204).send()
    }
    const rot = await pool.query<{ steps: unknown[]; name: string }>('select steps, name from call_centre.rotations where id = $1', [b.data.rotationId])
    if (!rot.rows[0]) return reply.code(404).send({ error: 'Rotation not found' })
    if (b.data.offsetWeeks >= rot.rows[0].steps.length) return reply.code(400).send({ error: `The offset must be less than the ${rot.rows[0].steps.length} weeks in this rotation` })
    await pool.query(
      `insert into call_centre.agent_rotation (agent_crm_id, rotation_id, offset_weeks, assigned_by) values ($1,$2,$3,$4)
       on conflict (agent_crm_id) do update set rotation_id = excluded.rotation_id, offset_weeks = excluded.offset_weeks, assigned_by = excluded.assigned_by, assigned_at = now()`,
      [agent, b.data.rotationId, b.data.offsetWeeks, req.session!.user.id])
    await auditAs(pool, req, 'shift.assign', 'agent', agent, { rotation: rot.rows[0].name, offsetWeeks: b.data.offsetWeeks })
    await notify(pool, send, { userId: agent, category: 'sys', tone: 'ye', title: 'You were put on a shift rotation', body: rot.rows[0].name, link: '/cb' })
    return reply.code(204).send()
  })

  app.put('/admin/shifts/overrides', { preHandler: admin }, async (req, reply) => {
    const b = overrideSchema.safeParse(req.body)
    if (!b.success || !DAY.test(b.data.day)) return reply.code(400).send({ error: 'Invalid override' })
    if (!b.data.off && !b.data.shiftId) return reply.code(400).send({ error: 'Pick a shift or mark the day off' })
    if (b.data.shiftId && !(await stepsOk([{ shiftId: b.data.shiftId, days: [] }]))) return reply.code(400).send({ error: 'That shift does not exist' })
    await pool.query(
      `insert into call_centre.shift_overrides (agent_crm_id, day, shift_id, off, reason, set_by) values ($1,$2,$3,$4,$5,$6)
       on conflict (agent_crm_id, day) do update set shift_id = excluded.shift_id, off = excluded.off, reason = excluded.reason, set_by = excluded.set_by`,
      [b.data.agentId, b.data.day, b.data.off ? null : b.data.shiftId, b.data.off, b.data.reason ?? null, req.session!.user.id])
    await auditAs(pool, req, 'shift.override', 'agent', b.data.agentId, { day: b.data.day, off: b.data.off })
    await notify(pool, send, { userId: b.data.agentId, category: 'sys', tone: 'ye', title: `Your shift on ${b.data.day} changed`, body: b.data.reason ?? (b.data.off ? 'Day off' : 'Different shift'), link: '/cb' })
    return reply.code(204).send()
  })

  app.delete<{ Querystring: { agentId?: string; day?: string } }>('/admin/shifts/overrides', { preHandler: admin }, async (req, reply) => {
    const { agentId, day } = req.query
    if (!agentId || !day || !DAY.test(day)) return reply.code(400).send({ error: 'agentId and day are required' })
    await pool.query('delete from call_centre.shift_overrides where agent_crm_id = $1 and day = $2', [agentId, day])
    await auditAs(pool, req, 'shift.override.clear', 'agent', agentId, { day })
    return reply.code(204).send()
  })

  /* ---- roster ---- */
  async function cellsFor(agentIds: string[], from: string, days: string[]): Promise<{ rows: Map<string, { cells: RosterCell[]; onNow: boolean }>; policy: Awaited<ReturnType<typeof loadPolicy>> }> {
    const [data, policy] = await Promise.all([loadShiftData(pool, addDays(from, -1), days[days.length - 1]!, agentIds), loadPolicy(pool)])
    const rows = new Map<string, { cells: RosterCell[]; onNow: boolean }>()
    for (const id of agentIds) {
      const cells = days.map((day): RosterCell => {
        const r = resolveDay(data, id, day)
        return { day, shiftId: r.shift?.id ?? null, name: r.shift?.name ?? null, start: r.shift?.start ?? null, end: r.shift?.end ?? null, color: r.shift?.color ?? null, source: r.source }
      })
      rows.set(id, { cells, onNow: isOnShift(data, id, new Date(), policy.graceMinutes) })
    }
    return { rows, policy }
  }
  const sevenDays = (from: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(from, i))

  app.get<{ Querystring: { from?: string } }>('/shifts/roster', { preHandler: lead }, async (req, reply): Promise<Roster | void> => {
    if (req.query.from && !DAY.test(req.query.from)) return reply.code(400).send({ error: 'from must be YYYY-MM-DD' })
    const from = mondayOf(req.query.from ?? today())
    const days = sevenDays(from)
    const people = new Map<string, { name: string; role: string | null }>()
    const staff = await beverlyData({ env, pool, fetchImpl }, req.session!).staff().catch(() => [])
    for (const s of staff) if (s.portal_access?.includes('call') && (s.auth_user_id ?? s.id)) people.set((s.auth_user_id ?? s.id)!, { name: s.user_name ?? s.email ?? 'Staff', role: s.role_label ?? s.role_key ?? null })
    const extra = await pool.query<{ id: string }>(`select agent_crm_id as id from call_centre.agent_rotation union select agent_crm_id from call_centre.agent_presence where not ('role:admin' = any(skills))`)
    const names = await staffNames(env, req.session!.beverlyToken, fetchImpl, pool).catch(() => new Map<string, string>())
    for (const e of extra.rows) if (!people.has(e.id)) people.set(e.id, { name: names.get(e.id) ?? 'Agent', role: null })
    const ids = [...people.keys()]
    const [{ rows, policy }, asg, photos, rots] = await Promise.all([
      cellsFor(ids, from, days),
      pool.query<{ agent_crm_id: string; rotation_id: string; offset_weeks: number }>('select agent_crm_id, rotation_id, offset_weeks from call_centre.agent_rotation'),
      pool.query<{ agent_crm_id: string }>("select auth_user_id::text as agent_crm_id from call_centre_read.staff where nullif(profile_picture_url, '') is not null").catch(() => ({ rows: [] as { agent_crm_id: string }[] })),
      pool.query<{ id: string; name: string }>('select id, name from call_centre.rotations'),
    ])
    const rotName = new Map(rots.rows.map((r) => [r.id, r.name]))
    const as = new Map(asg.rows.map((a) => [a.agent_crm_id, a]))
    const hasPhoto = new Set(photos.rows.map((p) => p.agent_crm_id))
    const out: RosterRow[] = ids.map((id) => {
      const p = people.get(id)!
      const a = as.get(id)
      return { agentId: id, name: p.name, role: p.role, rotationId: a?.rotation_id ?? null, rotationName: a ? rotName.get(a.rotation_id) ?? null : null, offsetWeeks: a?.offset_weeks ?? 0, hasPhoto: hasPhoto.has(id), onShiftNow: rows.get(id)!.onNow, cells: rows.get(id)!.cells }
    }).sort((x, y) => x.name.localeCompare(y.name))
    return { from, days, rows: out, policy }
  })

  app.get<{ Querystring: { from?: string } }>('/shifts/me', { preHandler: staff }, async (req) => {
    const me = req.session!.user.id
    const from = req.query.from && DAY.test(req.query.from) ? req.query.from : today()
    const days = Array.from({ length: 14 }, (_, i) => addDays(from, i))
    const { rows, policy } = await cellsFor([me], from, days)
    const r = rows.get(me)!
    return { days: r.cells, onShiftNow: r.onNow, enforced: policy.enforce }
  })

  /* ---- photos: Beverly's own staff photo, so wallet, CRM and Beverly Call all show the same picture ---- */
  const f = fetchImpl ?? fetch
  const beverlyUrl = (path: string): string => `${env.BEVERLY_API_URL}/api/v1/admin${path}`
  const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })
  const supabaseOrigin = (): string => { try { return new URL(env.BEVERLY_AUTH_URL).origin } catch { return '' } }

  /** Upload through Beverly's verified profile-picture flow (signed upload, scan on activate). Only the person themselves can change their own photo. */
  app.put<{ Params: { id: string } }>('/agents/:id/photo', { preHandler: staff, bodyLimit: 2_200_000 }, async (req, reply) => {
    const me = req.session!.user
    if (req.params.id !== 'me' && req.params.id !== me.id) return reply.code(404).send({ error: 'Agent not found' })   // it is the person's own Beverly profile photo; nobody else can change it
    const b = photoInputSchema.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: 'Send a JPEG, PNG or WebP image under 1 MB' })
    const bytes = Buffer.from(b.data.data, 'base64')
    const sig = bytes.subarray(0, 12)
    const okType = b.data.contentType === 'image/jpeg' ? sig[0] === 0xff && sig[1] === 0xd8
      : b.data.contentType === 'image/png' ? sig.subarray(0, 4).toString('hex') === '89504e47'
      : sig.subarray(0, 4).toString() === 'RIFF' && sig.subarray(8, 12).toString() === 'WEBP'
    if (!okType) return reply.code(400).send({ error: 'That file is not the image type it says' })
    if (bytes.length > 1_048_576) return reply.code(400).send({ error: 'The image is over 1 MB' })
    const ext = b.data.contentType === 'image/png' ? 'png' : b.data.contentType === 'image/webp' ? 'webp' : 'jpg'
    const token = req.session!.beverlyToken
    try {
      const up = await f(beverlyUrl('/profile-picture/upload-url'), { method: 'POST', headers: bearer(token), body: JSON.stringify({ file_name: `photo.${ext}`, content_type: b.data.contentType, size_bytes: bytes.length }) })
      if (!up.ok) return reply.code(up.status === 401 || up.status === 403 ? up.status : 502).send({ error: 'Beverly did not accept the photo' })
      const slot = (await up.json()) as { path?: string; signed_url?: string }
      if (!slot.path || !slot.signed_url) return reply.code(502).send({ error: 'Beverly did not return an upload slot' })
      const put = await f(slot.signed_url, { method: 'PUT', headers: { 'content-type': b.data.contentType }, body: bytes })
      if (!put.ok) return reply.code(502).send({ error: 'The photo could not be uploaded' })
      const act = await f(beverlyUrl('/profile-picture/activate'), { method: 'POST', headers: bearer(token), body: JSON.stringify({ path: slot.path }) })
      if (!act.ok) return reply.code(act.status === 422 ? 422 : 502).send({ error: act.status === 422 ? 'Beverly rejected the photo after its safety check' : 'Beverly could not activate the photo' })
    } catch { return reply.code(502).send({ error: 'Beverly is unreachable' }) }
    await auditAs(pool, req, 'agent.photo.set', 'agent', me.id)
    return reply.code(204).send()
  })

  /** The photo, read from Beverly's staff record (public bucket) and relayed so the page's image policy stays strict. */
  app.get<{ Params: { id: string } }>('/agents/:id/photo', { preHandler: staff }, async (req, reply) => {
    const id = req.params.id === 'me' ? req.session!.user.id : req.params.id
    if (id.length > 64) return reply.code(404).send({ error: 'No photo' })
    const r = await pool.query<{ profile_picture_url: string | null }>(
      'select profile_picture_url from call_centre_read.staff where auth_user_id::text = $1 or user_id::text = $1 limit 1', [id]).catch(() => ({ rows: [] as { profile_picture_url: string | null }[] }))
    const url = r.rows[0]?.profile_picture_url
    if (!url) return reply.code(404).send({ error: 'No photo' })
    let target: URL
    try { target = new URL(url) } catch { return reply.code(404).send({ error: 'No photo' }) }
    if (target.origin !== supabaseOrigin() || !target.pathname.includes('/wallet-profile-pictures/')) return reply.code(404).send({ error: 'No photo' })
    try {
      const img = await f(target.toString())
      const type = img.headers.get('content-type') ?? ''
      if (!img.ok || !type.startsWith('image/') || !/(jpeg|png|webp)/.test(type)) return reply.code(404).send({ error: 'No photo' })
      const buf = Buffer.from(await img.arrayBuffer())
      if (buf.length > 3_000_000) return reply.code(404).send({ error: 'No photo' })
      return reply.header('content-type', type.split(';')[0]!).header('cache-control', 'private, max-age=600').send(buf)
    } catch { return reply.code(404).send({ error: 'No photo' }) }
  })

  /** Remove the photo from Beverly itself (so it goes in the wallet and CRM too). */
  app.delete<{ Params: { id: string } }>('/agents/:id/photo', { preHandler: staff }, async (req, reply) => {
    const me = req.session!.user
    if (req.params.id !== 'me' && req.params.id !== me.id) return reply.code(404).send({ error: 'Agent not found' })
    try {
      const r = await f(beverlyUrl('/profile-picture'), { method: 'DELETE', headers: bearer(req.session!.beverlyToken) })
      if (!r.ok) return reply.code(502).send({ error: 'Beverly could not remove the photo' })
    } catch { return reply.code(502).send({ error: 'Beverly is unreachable' }) }
    await auditAs(pool, req, 'agent.photo.clear', 'agent', me.id)
    return reply.code(204).send()
  })
}
