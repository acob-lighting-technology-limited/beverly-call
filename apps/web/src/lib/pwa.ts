import { computed, ref } from 'vue'
import type { PushPrefs } from '@beverly-call/shared'
import { api } from '@/lib/api'

/**
 * Install and push for Beverly Call. The service worker (public/sw.js) shows alerts while the app is closed;
 * this file registers it, captures the browser's install prompt for the whole app (not just the Settings panel),
 * and manages this device's push subscription.
 */

/* ---------- pure decisions (unit tested) ---------- */

export type InstallState = 'installed' | 'ready' | 'ios' | 'manual'
export function decideInstallState(o: { installed: boolean; canPrompt: boolean; ios: boolean }): InstallState {
  if (o.installed) return 'installed'
  if (o.canPrompt) return 'ready'
  return o.ios ? 'ios' : 'manual'
}

export type PushStatus = 'on' | 'off' | 'unsupported' | 'needs-install' | 'blocked'
export function decidePushStatus(o: { supported: boolean; ios: boolean; standalone: boolean; permission: NotificationPermission | 'unsupported'; subscribed: boolean }): PushStatus {
  // iPhone and iPad only deliver web push to an app added to the Home Screen; in a Safari tab there is no push API at all.
  if (o.ios && !o.standalone) return 'needs-install'
  if (!o.supported) return 'unsupported'
  if (o.permission === 'denied') return 'blocked'
  return o.subscribed && o.permission === 'granted' ? 'on' : 'off'
}

/** VAPID public key (URL-safe base64) to the bytes the push API wants. */
export function keyToBytes(k: string): Uint8Array {
  const raw = atob((k + '='.repeat((4 - (k.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/* ---------- environment ---------- */

export const isIos = (ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean =>
  /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)   // iPadOS reports itself as a Mac
export const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true
const pushSupported = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/* ---------- install ---------- */

interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const deferred = ref<InstallPromptEvent | null>(null)
const installed = ref(typeof window !== 'undefined' && isStandalone())
export const installState = computed<InstallState>(() => decideInstallState({ installed: installed.value, canPrompt: deferred.value !== null, ios: isIos() }))

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred.value
  if (!e) return 'unavailable'
  deferred.value = null   // a prompt can only be used once
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') installed.value = true
  return outcome
}

/* ---------- start-up ---------- */

export interface PwaHandlers {
  /** A tapped alert asks the open app to go to this screen. */
  onNavigate(link: string): void
  /** A push arrived; refresh alerts now and (for a ringing call) ring. */
  onPush(m: { link: string; urgent: boolean }): void
}

/** Call once at start-up: registers the service worker, captures the install prompt and relays worker messages. */
export function initPwa(h: PwaHandlers): void {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred.value = e as InstallPromptEvent })
  window.addEventListener('appinstalled', () => { installed.value = true; deferred.value = null })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (e) => { installed.value = e.matches })
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; link?: string; urgent?: boolean }>) => {
    const m = e.data
    if (m?.type === 'navigate' && typeof m.link === 'string' && m.link.startsWith('/')) h.onNavigate(m.link)
    else if (m?.type === 'push') h.onPush({ link: m.link ?? '/', urgent: m.urgent === true })
  })
  // Register after load so it never competes with the first paint.
  const reg = (): void => { void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined) }
  if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg, { once: true })
}

/* ---------- push ---------- */

const OWNER_KEY = 'bc.push.user'   // who turned push on for this browser: the next person to sign in here is not subscribed for them
const owner = (): string | null => { try { return localStorage.getItem(OWNER_KEY) } catch { return null } }
const setOwner = (id: string | null): void => { try { if (id) localStorage.setItem(OWNER_KEY, id); else localStorage.removeItem(OWNER_KEY) } catch { /* storage blocked */ } }

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null))
}
async function subscription(): Promise<PushSubscription | null> {
  try { return (await (await registration())?.pushManager.getSubscription()) ?? null } catch { return null }
}

/** What the Settings switch should show right now. */
export async function pushStatus(userId: string | undefined): Promise<PushStatus> {
  const sub = await subscription()
  return decidePushStatus({
    supported: pushSupported(), ios: isIos(), standalone: isStandalone(),
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    // A subscription left by someone else on this browser does not count as the current person's.
    subscribed: sub !== null && owner() === (userId ?? null),
  })
}

export type EnableResult = { ok: true } | { ok: false; reason: string }

export async function enablePush(userId: string, prefs: PushPrefs): Promise<EnableResult> {
  try {
    const reg = await registration()
    if (!reg || !pushSupported()) return { ok: false, reason: 'Push is not supported in this browser.' }
    const { publicKey } = await api<{ publicKey: string | null }>('/push/key')
    if (!publicKey) return { ok: false, reason: 'Push alerts are not set up on the server yet.' }
    if ((await Notification.requestPermission()) !== 'granted') return { ok: false, reason: 'Push alerts are blocked in your browser settings for this site.' }
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) as BufferSource }))
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ ...sub.toJSON(), prefs }) })
    setOwner(userId)
    return { ok: true }
  } catch { return { ok: false, reason: 'Could not turn push alerts on. Try again.' } }
}

export async function disablePush(): Promise<void> {
  const sub = await subscription()
  setOwner(null)
  if (!sub) return
  await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

/**
 * Keeps this device's subscription and preferences right on the server. Run when the app starts signed in and whenever
 * the notification settings change. It only acts for the person who turned push on here, and drops a subscription the
 * browser no longer allows.
 */
export async function syncPush(userId: string, prefs: PushPrefs): Promise<void> {
  if (!pushSupported() || owner() !== userId) return
  const sub = await subscription()
  if (!sub) return
  if (Notification.permission !== 'granted') { await disablePush(); return }
  await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ ...sub.toJSON(), prefs }) }).catch(() => undefined)
}

/** On sign-out: stop alerts for this person on this device (the browser keeps the subscription for their next sign-in). */
export async function releasePush(): Promise<void> {
  const sub = await subscription()
  if (!sub || owner() === null) return
  await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined)
}
