import type { FastifyPluginAsync } from 'fastify'
import type { Pool } from 'pg'
import { languageSchema, type AgentPeriodStats, type AgentProfile } from '@beverly-call/shared'
import type { AppDeps } from '../app.js'
import { requireRole } from '../auth/guards.js'
import { staffNames } from '../beverly/staff-directory.js'

const TZ = 'Africa/Lagos'
/** Start of the Lagos day `n` days ago, as a timestamptz. Explicit zone because the pooler does not keep session settings. */
const dayStart = (n: number): string => `(date_trunc('day', now() at time zone '${TZ}') - interval '${n} days') at time zone '${TZ}'`

const ROLE_LABEL: Record<string, string> = { agent: 'Agent', supervisor: 'Supervisor', admin: 'Admin' }

async function periodStats(pool: Pool, agentId: string, since: string): Promise<AgentPeriodStats> {
  const c = await pool.query<{ calls: string; answered: string; avg_handle: string | null; rating: string | null; rated: string; resolved_first: string; with_outcome: string }>(
    `select count(*) as calls, count(*) filter (where answered_at is not null) as answered,
            avg(extract(epoch from (ended_at - answered_at))) filter (where answered_at is not null and ended_at is not null) as avg_handle,
            avg(rating) as rating, count(rating) as rated,
            count(*) filter (where disposition is not null and disposition not in ('escalated', 'Callback needed', 'Escalated')) as resolved_first,
            count(*) filter (where disposition is not null) as with_outcome
     from call_centre.calls where agent_crm_id = $1 and started_at >= ${since}`, [agentId])
  const k = await pool.query<{ opened: string; resolved: string }>(
    `select count(*) filter (where created_at >= ${since}) as opened, count(*) filter (where resolved_at >= ${since}) as resolved
     from call_centre.tickets where agent_crm_id = $1`, [agentId])
  const b = await pool.query<{ n: string }>(`select count(*) as n from call_centre.callbacks where assigned_to_crm_id = $1 and status = 'completed' and completed_at >= ${since}`, [agentId])
  const r = c.rows[0]!
  const withOutcome = Number(r.with_outcome)
  return {
    calls: Number(r.calls), answered: Number(r.answered), avgHandleSeconds: Math.round(Number(r.avg_handle ?? 0)),
    rating: r.rating === null ? null : Math.round(Number(r.rating) * 10) / 10, ratingCount: Number(r.rated),
    firstCallResolvedPct: withOutcome ? Math.round((Number(r.resolved_first) / withOutcome) * 100) : 0,
    casesOpened: Number(k.rows[0]?.opened ?? 0), casesResolved: Number(k.rows[0]?.resolved ?? 0), callbacksDone: Number(b.rows[0]?.n ?? 0),
  }
}

/** Agent profile and analytics. Agents see their own; supervisors and admins see anyone's. */
export const agentRoutes = ({ env, pool, fetchImpl }: AppDeps): FastifyPluginAsync => async (app) => {
  const staff = requireRole('agent', 'supervisor', 'admin')

  app.get<{ Params: { id: string } }>('/agents/:id/profile', { preHandler: staff }, async (req, reply): Promise<AgentProfile | void> => {
    const me = req.session!.user
    const id = req.params.id === 'me' ? me.id : req.params.id
    if (id !== me.id && me.role === 'agent') return reply.code(404).send({ error: 'Agent not found' })
    if (id.length > 64) return reply.code(404).send({ error: 'Agent not found' })

    const pres = await pool.query<{ name: string; status: string; languages: string[]; last_seen: Date }>('select name, status, languages, last_seen from call_centre.agent_presence where agent_crm_id = $1', [id])
    const seen = await pool.query<{ n: string }>('select count(*) as n from call_centre.calls where agent_crm_id = $1', [id])
    if (id !== me.id && !pres.rows[0] && Number(seen.rows[0]?.n) === 0) return reply.code(404).send({ error: 'Agent not found' })
    const names = id === me.id ? new Map<string, string>() : await staffNames(env, req.session!.beverlyToken, fetchImpl, pool).catch(() => new Map<string, string>())
    const p = pres.rows[0]

    const [today, week, month] = await Promise.all([periodStats(pool, id, dayStart(0)), periodStats(pool, id, dayStart(6)), periodStats(pool, id, dayStart(29))])
    const days = await pool.query<{ d: string; n: string }>(
      `select to_char(s.d, 'DD Mon') as d, (select count(*) from call_centre.calls c where c.agent_crm_id = $1
         and (c.started_at at time zone '${TZ}')::date = s.d::date) as n
       from generate_series((now() at time zone '${TZ}')::date - 13, (now() at time zone '${TZ}')::date, interval '1 day') as s(d) order by s.d`, [id])
    const hours = await pool.query<{ h: number; n: string }>(
      `select extract(hour from started_at at time zone '${TZ}')::int as h, count(*) as n from call_centre.calls
       where agent_crm_id = $1 and started_at >= ${dayStart(0)} group by 1`, [id])
    const outcomes = await pool.query<{ label: string; n: string }>(
      `select coalesce(disposition, 'No outcome') as label, count(*) as n from call_centre.calls where agent_crm_id = $1 and started_at >= ${dayStart(29)} group by 1 order by 2 desc limit 8`, [id])
    const qa = await pool.query<{ avg: string | null; n: string }>(
      `select avg(q.score) as avg, count(*) as n from call_centre.qa_scores q join call_centre.calls c on c.id = q.call_id where c.agent_crm_id = $1`, [id])
    const open = await pool.query<{ cases: string; cbs: string }>(
      `select (select count(*) from call_centre.tickets where agent_crm_id = $1 and status not in ('RESOLVED','CLOSED')) as cases,
              (select count(*) from call_centre.callbacks where assigned_to_crm_id = $1 and status in ('pending','assigned')) as cbs`, [id])

    const hourly = Array<number>(24).fill(0)
    for (const r of hours.rows) hourly[r.h] = Number(r.n)
    return {
      id, name: p?.name ?? (id === me.id ? me.name : names.get(id)) ?? 'Agent', role: ROLE_LABEL[id === me.id ? me.role : 'agent'] ?? 'Agent',
      staffId: `AG-${id.replace(/[^0-9a-z]/gi, '').slice(0, 4).toUpperCase()}`,
      languages: (p?.languages ?? []).map((l) => languageSchema.catch('en').parse(l)), status: p?.status ?? null,
      online: !!p && Date.now() - p.last_seen.getTime() < 90_000,
      today, week, month,
      days: days.rows.map((x) => ({ label: x.d, calls: Number(x.n) })), hours: hourly,
      outcomes: outcomes.rows.map((x) => ({ label: x.label, count: Number(x.n) })),
      qa: { average: qa.rows[0]?.avg == null ? null : Math.round(Number(qa.rows[0].avg)), scored: Number(qa.rows[0]?.n ?? 0) },
      openCases: Number(open.rows[0]?.cases ?? 0), openCallbacks: Number(open.rows[0]?.cbs ?? 0),
    }
  })
}
