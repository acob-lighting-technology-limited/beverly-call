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

/** The rail shows these groups (five at most, so the bottom bar never needs scrolling). Each opens its first section;
 *  groups with several sections get a tab strip inside the page. Section ids are the /admin/:section routes. */
export interface AdminGroup { id: string; label: string; short: string; icon: string; sections: readonly string[] }
export const ADMIN_GROUPS: readonly AdminGroup[] = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: 'grid', sections: ['overview'] },
  { id: 'insights', label: 'Insights', short: 'Insights', icon: 'chart', sections: ['analytics', 'quality'] },
  { id: 'team', label: 'Team', short: 'Team', icon: 'users', sections: ['agents', 'shifts', 'people'] },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: 'sliders', sections: ['settings'] },
  { id: 'system', label: 'System and audit', short: 'System', icon: 'db', sections: ['system'] },
]
export const adminGroupOf = (sectionId: unknown): AdminGroup => ADMIN_GROUPS.find((g) => g.sections.includes(String(sectionId))) ?? ADMIN_GROUPS[0]!
