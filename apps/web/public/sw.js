/*
 * Beverly Call service worker. It does three things:
 *  1. keeps the app installable,
 *  2. shows server-sent alerts when the app is closed (Web Push), and rings loudly for an incoming call,
 *  3. brings the app forward and opens the right screen when an alert is tapped.
 * It deliberately caches nothing: the app and its data always come from the network.
 */
const CALL_TAG = 'incoming-call'
const CALL_RING_MS = 45_000   // a ring older than this is stale (the server also drops pushes after 30 s)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
// Present so browsers treat the app as installable. It does not touch the request.
self.addEventListener('fetch', () => {})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  if (data === null || typeof data !== 'object') data = {}   // valid JSON that is not an object (null, a string) must not lose the alert
  const urgent = data.urgent === true
  const silent = data.silent === true
  const link = typeof data.link === 'string' && data.link.startsWith('/') ? data.link : '/'
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag,
    renotify: Boolean(tag),           // renotify is only allowed with a tag
    requireInteraction: urgent,       // a ringing call stays on screen until it is answered or dismissed
    silent,
    timestamp: Date.now(),
    data: { link, urgent },
    actions: urgent ? [{ action: 'open', title: 'Open call' }] : [],
  }
  // Chrome throws when a notification is both silent and vibrating, so only vibrate when sound is allowed.
  if (!silent) options.vibrate = urgent ? [500, 250, 500, 250, 500] : [120]

  event.waitUntil((async () => {
    await self.registration.showNotification(typeof data.title === 'string' ? data.title : 'Beverly Call', options)
    // Tell any open window right away so it refreshes its bell and plays its own alert without waiting for the next poll.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of open) c.postMessage({ type: 'push', link, urgent })
    if (urgent) {
      // Clear the ring once it is stale so an agent never taps a call that ended long ago.
      await new Promise((r) => setTimeout(r, CALL_RING_MS))
      const stale = await self.registration.getNotifications({ tag: CALL_TAG })
      for (const n of stale) n.close()
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const target = all.find((c) => c.visibilityState === 'visible') || all[0]
    if (target) {
      await target.focus()
      target.postMessage({ type: 'navigate', link })
      return
    }
    await self.clients.openWindow(link)
  })())
})

// The browser can replace a push subscription (expiry, key rotation). Re-subscribe and tell the server, so alerts keep arriving.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey
    if (!key) return
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
  })())
})
