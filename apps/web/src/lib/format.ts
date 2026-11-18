import { intl } from '@/lib/locale'

export const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 125 -> "02:05". */
export const clock = (seconds: number): string => `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleString(intl(), { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Escapes a value for CSV, including the leading-formula characters spreadsheets would execute. */
export function csvCell(v: string | number): string {
  const s = String(v)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** Today in Beverly's time zone (WAT) as YYYY-MM-DD, whatever the browser's own zone is. */
export const lagosToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

/** Full date and time in Beverly's time zone, for records where the exact moment matters (audit log). */
export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(intl(), { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** A running duration with hours once it passes an hour: 252:55 becomes 4:12:55; under an hour stays 12:05. */
export const hms = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  return h > 0 ? `${h}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}` : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}

/** The same duration in words, for tooltips: "4 hours, 12 minutes, 55 seconds". */
export const durationLong = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds))
  const parts: [number, string][] = [[Math.floor(s / 3600), 'hour'], [Math.floor((s % 3600) / 60), 'minute'], [s % 60, 'second']]
  const shown = parts.filter(([n], i) => n > 0 || i === 2 && !parts.some(([m]) => m > 0))
  return shown.map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`).join(', ')
}

/** When something started, in Beverly's time zone: "14:32 today" or "16 Nov, 22:10". */
export const sinceLabel = (ms: number): string => {
  const at = new Date(ms)
  const time = at.toLocaleTimeString(intl(), { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' })
  const day = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  return day(at) === day(new Date()) ? `${time} today` : `${at.toLocaleDateString(intl(), { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' })}, ${time}`
}

/** Only the digits of a phone number, for counting and comparing. */
export const phoneDigits = (p: string): string => p.replace(/\D/g, '')
/** What a dialler needs: digits and a leading plus, with spaces, dashes and brackets removed. */
export const dialable = (p: string): string => p.replace(/[^\d+]/g, '')
