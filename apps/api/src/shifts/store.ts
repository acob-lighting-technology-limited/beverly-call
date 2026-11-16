import type { Pool } from 'pg'
import { DEFAULT_SHIFT_POLICY, shiftPolicySchema, type RotationStep } from '@beverly-call/shared'
import { addDays, lagosNow, onShiftAt, shiftFor, type DayOverride, type Resolved, type RotationDef, type Shift } from './engine.js'

export interface ShiftData {
  shifts: Map<string, Shift>
  rotations: Map<string, RotationDef>
  assignments: Map<string, { rotationId: string; offsetWeeks: number }>
  overrides: Map<string, DayOverride>
}

const hhmm = (t: string): string => t.slice(0, 5)
const key = (agent: string, day: string): string => `${agent}|${day}`

/** Everything the engine needs for the days between `from` and `to` (inclusive), for all agents or the given ones. */
export async function loadShiftData(pool: Pool, from: string, to: string, agentIds?: string[]): Promise<ShiftData> {
  const [t, r, a, o] = await Promise.all([
    pool.query<{ id: string; name: string; start_time: string; end_time: string; color: string }>('select id, name, start_time::text, end_time::text, color from call_centre.shift_templates where active'),
    pool.query<{ id: string; name: string; anchor_date: string; steps: RotationStep[] }>('select id, name, anchor_date::text, steps from call_centre.rotations'),
    pool.query<{ agent_crm_id: string; rotation_id: string; offset_weeks: number }>('select agent_crm_id, rotation_id, offset_weeks from call_centre.agent_rotation where ($1::text[] is null or agent_crm_id = any($1))', [agentIds ?? null]),
    pool.query<{ agent_crm_id: string; day: string; shift_id: string | null; off: boolean }>('select agent_crm_id, day::text, shift_id, off from call_centre.shift_overrides where day between $1::date and $2::date and ($3::text[] is null or agent_crm_id = any($3))', [from, to, agentIds ?? null]),
  ])
  return {
    shifts: new Map(t.rows.map((x) => [x.id, { id: x.id, name: x.name, start: hhmm(x.start_time), end: hhmm(x.end_time), color: x.color }])),
    rotations: new Map(r.rows.map((x) => [x.id, { id: x.id, name: x.name, anchorDate: x.anchor_date, steps: x.steps }])),
    assignments: new Map(a.rows.map((x) => [x.agent_crm_id, { rotationId: x.rotation_id, offsetWeeks: x.offset_weeks }])),
    overrides: new Map(o.rows.map((x) => [key(x.agent_crm_id, x.day), { shiftId: x.shift_id, off: x.off }])),
  }
}

/** The shift an agent works on a day, or none. */
export function resolveDay(d: ShiftData, agentId: string, day: string): Resolved {
  const as = d.assignments.get(agentId)
  return shiftFor(day, as ? d.rotations.get(as.rotationId) ?? null : null, as?.offsetWeeks ?? 0, d.shifts, d.overrides.get(key(agentId, day)))
}

export function isOnShift(d: ShiftData, agentId: string, at: Date, graceMinutes: number): boolean {
  return onShiftAt(at, (day) => resolveDay(d, agentId, day).shift, graceMinutes)
}

export async function loadPolicy(pool: Pool): Promise<{ enforce: boolean; graceMinutes: number }> {
  const r = await pool.query<{ value: unknown }>(`select value from call_centre.settings where key = 'shift_policy'`)
  const p = shiftPolicySchema.safeParse(r.rows[0]?.value)
  return p.success ? p.data : { ...DEFAULT_SHIFT_POLICY }
}

/** Agent ids who are on shift right now. Used by routing when the admin has switched shift enforcement on. */
export async function agentsOnShift(pool: Pool, agentIds: string[], now = new Date()): Promise<{ enforce: boolean; onShift: Set<string> }> {
  const policy = await loadPolicy(pool)
  if (!policy.enforce) return { enforce: false, onShift: new Set(agentIds) }
  const today = lagosNow(now).day
  const data = await loadShiftData(pool, addDays(today, -1), today, agentIds)
  return { enforce: true, onShift: new Set(agentIds.filter((id) => isOnShift(data, id, now, policy.graceMinutes))) }
}
