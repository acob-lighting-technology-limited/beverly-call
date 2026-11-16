/** The admin console's sections. The left rail turns into these tabs while the admin console is open.
 *  Used by: AppNav (rail), AdminView (header and content). */
export interface AdminSection { id: string; label: string; short: string; icon: string; hint: string }

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: 'chart', hint: 'Live pipeline and today' },
  { id: 'analytics', label: 'Call analytics', short: 'Calls', icon: 'phone', hint: 'Volume, busy hours, forecast' },
  { id: 'agents', label: 'Agents', short: 'Agents', icon: 'users', hint: 'Team and performance' },
  { id: 'shifts', label: 'Shifts and rotation', short: 'Shifts', icon: 'clock', hint: 'Who works when' },
  { id: 'quality', label: 'Quality', short: 'Quality', icon: 'check', hint: 'SLA, cases, QA scores' },
  { id: 'people', label: 'Users and roles', short: 'Users', icon: 'lock', hint: 'Who can use the desk' },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: 'sliders', hint: 'Limits, outages, replies' },
  { id: 'system', label: 'System and audit', short: 'System', icon: 'db', hint: 'Connections, retention, log' },
]

export const adminSection = (id: unknown): AdminSection => ADMIN_SECTIONS.find((s) => s.id === id) ?? ADMIN_SECTIONS[0]!
