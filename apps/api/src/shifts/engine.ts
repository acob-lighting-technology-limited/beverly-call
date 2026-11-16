import type { RotationStep } from '@beverly-call/shared'

/**
 * The rotation engine. Pure functions, no database: given shift templates, a rotation, an agent's offset and any
 * day overrides, say which shift an agent works on a date and whether they are on shift at a moment. All days and times are Nigerian time (WAT).
 */
export interface Shift { id: string; name: string; start: string; end: string; color: string }
export interface RotationDef { id: string; name: string; anchorDate: string; steps: RotationStep[] }
export interface DayOverride { shiftId: string | null; off: boolean }
export type Source = 'rotation' | 'override' | 'none'
export interface Resolved { shift: Shift | null; source: Source }

const DAY_MS = 86_400_000
/** 'YYYY-MM-DD' as a UTC day number. */
export const dayNumber = (d: string): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS
export const addDays = (d: string, n: number): string => new Date((dayNumber(d) + n) * DAY_MS).toISOString().slice(0, 10)
/** Monday = 0 ... Sunday = 6. */
export const weekday = (d: string): number => (((dayNumber(d) + 3) % 7) + 7) % 7
export const mondayOf = (d: string): string => addDays(d, -weekday(d))
export const minutes = (hhmm: string): number => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5)
export const isOvernight = (s: Pick<Shift, 'start' | 'end'>): boolean => minutes(s.end) <= minutes(s.start)

const lagosParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** A moment as the Lagos calendar day and minutes since midnight. */
export function lagosNow(at: Date): { day: string; minute: number } {
  const p = Object.fromEntries(lagosParts.formatToParts(at).map((x) => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, minute: +p.hour! * 60 + +p.minute! }
}

/** Which week of the cycle a date falls in for an agent: whole weeks since the anchor plus their offset, wrapped to the cycle length. */
export function cycleWeek(anchorDate: string, day: string, offsetWeeks: number, cycleLength: number): number {
  const weeks = Math.floor((dayNumber(mondayOf(day)) - dayNumber(mondayOf(anchorDate))) / 7)
  return (((weeks + offsetWeeks) % cycleLength) + cycleLength) % cycleLength
}

/** The shift an agent works on a day. A day override wins over the rotation. */
export function shiftFor(day: string, rotation: RotationDef | null, offsetWeeks: number, shifts: ReadonlyMap<string, Shift>, override?: DayOverride): Resolved {
  if (override) return override.off || !override.shiftId ? { shift: null, source: 'override' } : { shift: shifts.get(override.shiftId) ?? null, source: 'override' }
  if (!rotation || !rotation.steps.length || day < rotation.anchorDate) return { shift: null, source: 'none' }
  const step = rotation.steps[cycleWeek(rotation.anchorDate, day, offsetWeeks, rotation.steps.length)]!
  if (!step.shiftId || !step.days.includes(weekday(day))) return { shift: null, source: 'rotation' }
  return { shift: shifts.get(step.shiftId) ?? null, source: 'rotation' }
}

/** Whether `minute` of the shift's own start day falls inside it, extending `graceMinutes` either side. */
const coversStartDay = (s: Shift, minute: number, grace: number): boolean => {
  const start = minutes(s.start) - grace
  const end = isOvernight(s) ? 1440 : minutes(s.end) + grace
  return minute >= start && minute < end
}
/** Whether the overnight tail of yesterday's shift covers `minute` today. */
const coversTail = (s: Shift, minute: number, grace: number): boolean => isOvernight(s) && minute < minutes(s.end) + grace

/** Whether an agent is on shift at this moment, given the shift they work today and the one they worked yesterday. */
export function onShiftAt(at: Date, today: (day: string) => Shift | null, graceMinutes = 0): boolean {
  const { day, minute } = lagosNow(at)
  const t = today(day)
  if (t && coversStartDay(t, minute, graceMinutes)) return true
  const y = today(addDays(day, -1))
  if (y && coversTail(y, minute, graceMinutes)) return true
  // Grace before an overnight shift that starts just after midnight tomorrow is not needed; an early start-of-day grace is covered above.
  return false
}
