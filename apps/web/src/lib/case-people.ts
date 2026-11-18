import type { Assignee } from '@beverly-call/shared'

/** How a person's availability reads next to their name when choosing who to give a case to. */
export const PRESENCE_LABEL: Record<Assignee['presence'], string> = {
  available: 'free', busy: 'on a call', acw: 'wrapping up', break: 'on break', away: 'away', offline: 'offline',
}
/** The dot colour for a presence, from the theme's status colours. */
export const PRESENCE_DOT: Record<Assignee['presence'], string> = {
  available: 'var(--st-on)', busy: 'var(--vio, #7c5cff)', acw: 'var(--vio, #7c5cff)', break: 'var(--st-break)', away: 'var(--st-away)', offline: 'var(--mut)',
}
