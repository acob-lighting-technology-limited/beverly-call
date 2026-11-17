import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PresenceStatus, SelfPresenceStatus } from '@beverly-call/shared'
import { api } from '@/lib/api'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'

const HEARTBEAT_MS = 30_000
const IDLE_CHECK_MS = 30_000

/**
 * My availability, for everyone who signs in: agents, supervisors and admins.
 *  - `choice` is what I picked (Available, Break, Away); `status` is what applies (the server keeps a person on a live
 *    call Busy until wrap-up, whatever I picked, and tells us in the heartbeat reply).
 *  - It survives a reload: on start we ask the server for my row instead of resetting to Available.
 *  - Break and Away are never routed calls. Admins can set a status (supervisors see it) but are never routed calls.
 *  - Auto-away: if I am Available, not on a call and idle for the configured minutes, I am set to Away and told so.
 */
export const usePresence = defineStore('presence', () => {
  const choice = ref<SelfPresenceStatus>('available')
  const status = ref<PresenceStatus>('available')
  const languages = ref<string[]>(['en'])
  const since = ref(Date.now())
  /** Why I am Away when I did not choose it: 'idle' after the auto-away delay. Cleared on any manual change. */
  const reason = ref<'' | 'idle'>('')
  const now = ref(Date.now())
  let beatTimer = 0
  let idleTimer = 0
  let tick = 0
  let lastActive = Date.now()

  const elapsedSeconds = computed(() => Math.max(0, Math.floor((now.value - since.value) / 1000)))
  /** Busy or wrap-up: the server holds the status and I cannot change it until the call is wrapped up. */
  const locked = computed(() => status.value === 'busy' || status.value === 'acw')
  const unavailable = computed(() => choice.value !== 'available')

  const storeKey = (): string => `bc.presence.${useSession().user?.id ?? 'anon'}`
  function remember(): void { try { sessionStorage.setItem(storeKey(), JSON.stringify({ choice: choice.value, since: since.value, reason: reason.value })) } catch { /* storage blocked */ } }

  /** Heartbeat. Reads the status that actually applies from the reply header, so a busy agent is never shown as Available. */
  async function beat(): Promise<void> {
    const s = useSession()
    if (!s.user) return
    try {
      const r = await fetch('/api/presence', {
        method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: choice.value, languages: languages.value }),
      })
      if (r.status === 401) { location.assign('/login'); return }
      const applied = r.headers.get('x-presence-status') as PresenceStatus | null
      if (r.ok && applied) status.value = applied
    } catch { /* the next beat retries */ }
  }

  async function restore(): Promise<void> {
    try {
      const me = await api<{ status: PresenceStatus; languages: string[] } | undefined>('/presence/me')
      if (me) {
        status.value = me.status
        choice.value = me.status === 'break' || me.status === 'away' ? me.status : 'available'
        languages.value = me.languages
        const saved = JSON.parse(sessionStorage.getItem(storeKey()) ?? 'null') as { choice: string; since: number; reason: '' | 'idle' } | null
        if (saved && saved.choice === choice.value) { since.value = saved.since; reason.value = saved.reason }
        else { since.value = Date.now(); reason.value = '' }
        return
      }
    } catch { /* fall through: a fresh sign-in starts Available */ }
    choice.value = 'available'; status.value = 'available'; since.value = Date.now(); reason.value = ''
  }

  function noteActivity(): void { lastActive = Date.now() }
  function checkIdle(): void {
    const minutes = useSettings().p.autoAwayMin
    if (!minutes || choice.value !== 'available' || locked.value) return
    if (Date.now() - lastActive >= minutes * 60_000) void set('away', 'idle')
  }

  async function start(): Promise<void> {
    stop()
    await restore()
    await beat()
    lastActive = Date.now()
    beatTimer = window.setInterval(() => { if (!document.hidden) void beat() }, HEARTBEAT_MS)
    idleTimer = window.setInterval(checkIdle, IDLE_CHECK_MS)
    tick = window.setInterval(() => { now.value = Date.now() }, 1000)
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) document.addEventListener(ev, noteActivity, { passive: true, capture: true })
  }
  function stop(): void {
    clearInterval(beatTimer); clearInterval(idleTimer); clearInterval(tick); beatTimer = idleTimer = tick = 0
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) document.removeEventListener(ev, noteActivity, { capture: true })
  }

  /** Change my status. Ignored while locked on a call; updates the elapsed timer and tells the server straight away. */
  async function set(next: SelfPresenceStatus, why: '' | 'idle' = ''): Promise<void> {
    if (locked.value || (next === choice.value && !why)) return
    choice.value = next
    status.value = next
    since.value = Date.now(); now.value = since.value
    reason.value = why
    lastActive = Date.now()
    remember()
    await beat()
    remember()
  }

  return { choice, status, languages, since, reason, elapsedSeconds, locked, unavailable, start, stop, set, beat }
})
