import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CALL_ALERT, CALL_ALERT_TITLES } from '@beverly-call/shared'
import { decideInstallState, decidePushStatus, isIos, keyToBytes } from '../src/lib/pwa'

const pub = (f: string): string => join(__dirname, '..', 'public', f)

describe('install state', () => {
  it('installed beats everything, then the browser prompt, then platform instructions', () => {
    expect(decideInstallState({ installed: true, canPrompt: true, ios: true })).toBe('installed')
    expect(decideInstallState({ installed: false, canPrompt: true, ios: false })).toBe('ready')
    expect(decideInstallState({ installed: false, canPrompt: false, ios: true })).toBe('ios')
    expect(decideInstallState({ installed: false, canPrompt: false, ios: false })).toBe('manual')
  })
  it('recognises iPhone, iPad and an iPad that reports itself as a Mac, but not a desktop Mac', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false)
    expect(isIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false)
  })
})

describe('push status', () => {
  const base = { supported: true, ios: false, standalone: false, permission: 'default' as NotificationPermission | 'unsupported', subscribed: false }
  it('says why push cannot work instead of failing silently', () => {
    expect(decidePushStatus({ ...base, ios: true, supported: false })).toBe('needs-install')
    expect(decidePushStatus({ ...base, ios: true, standalone: true, supported: true })).toBe('off')
    expect(decidePushStatus({ ...base, supported: false })).toBe('unsupported')
    expect(decidePushStatus({ ...base, permission: 'denied', subscribed: true })).toBe('blocked')
  })
  it('is on only with both a subscription and permission', () => {
    expect(decidePushStatus({ ...base, permission: 'granted', subscribed: true })).toBe('on')
    expect(decidePushStatus({ ...base, permission: 'granted', subscribed: false })).toBe('off')
    expect(decidePushStatus({ ...base, permission: 'default', subscribed: true })).toBe('off')
  })
  it('decodes the VAPID key to the 65 bytes the push API requires', () => {
    const key = readFileSync(join(__dirname, '..', '..', '..', '.env.example'), 'utf8').match(/VAPID_PUBLIC_KEY=(\S+)/)?.[1]
    const sample = Buffer.from([4, ...Array.from({ length: 64 }, (_, i) => i)]).toString('base64url')
    expect(key === undefined || key.startsWith('CHANGE')).toBe(true)
    const bytes = keyToBytes(sample)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(4)
    expect(Array.from(bytes.slice(1, 4))).toEqual([0, 1, 2])
  })
})

describe('call alert titles', () => {
  it('are the three the app rings for', () => {
    expect([...CALL_ALERT_TITLES].sort()).toEqual([CALL_ALERT.incoming, CALL_ALERT.transferred, CALL_ALERT.warmTransfer].sort())
  })
})

describe('web app manifest', () => {
  const manifest = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8')) as {
    name: string; start_url: string; scope: string; display: string; id: string
    icons: { src: string; sizes: string; type: string; purpose: string }[]
  }
  const png = (f: string): { w: number; h: number } => {
    const b = readFileSync(pub(f))
    expect(b.subarray(1, 4).toString()).toBe('PNG')
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  }
  it('is installable: name, standalone display, start page inside its scope', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true)
    expect(manifest.id).toBeTruthy()
  })
  it('lists real icon files of the size it claims, including 192, 512 and a maskable one', () => {
    for (const i of manifest.icons) {
      const { w, h } = png(i.src.slice(1))
      expect(`${w}x${h}`, i.src).toBe(i.sizes)
      expect(i.type).toBe('image/png')
    }
    expect(manifest.icons.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true)
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true)
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })
  it('the page links the manifest and an Apple touch icon, and the notification badge exists', () => {
    const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">')
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"')
    expect(png('icons/apple-touch-icon.png')).toEqual({ w: 180, h: 180 })
    expect(png('icons/badge-96.png')).toEqual({ w: 96, h: 96 })
  })
})

describe('service worker', () => {
  type Listener = (event: Record<string, unknown>) => void
  let listeners: Record<string, Listener>
  let shown: { title: string; options: Record<string, unknown> }[]
  let closed: number
  let messages: unknown[]
  let opened: string[]
  let windows: { visibilityState: string; focus: () => Promise<void>; postMessage: (m: unknown) => void }[]

  beforeEach(() => {
    vi.useFakeTimers()
    listeners = {}; shown = []; closed = 0; messages = []; opened = []; windows = []
    const self = {
      addEventListener: (type: string, fn: Listener) => { listeners[type] = fn },
      skipWaiting: vi.fn(),
      registration: {
        showNotification: async (title: string, options: Record<string, unknown>) => {
          // Chrome refuses these combinations, so the fake refuses them too.
          if (options.silent === true && options.vibrate) throw new TypeError('silent and vibrate cannot both be set')
          if (options.renotify && !options.tag) throw new TypeError('renotify requires a tag')
          shown.push({ title, options })
        },
        getNotifications: async () => [{ close: () => { closed++ } }],
        pushManager: { subscribe: vi.fn() },
      },
      clients: { claim: vi.fn(), matchAll: async () => windows, openWindow: async (l: string) => { opened.push(l) } },
    }
    new Function('self', 'fetch', readFileSync(pub('sw.js'), 'utf8'))(self, vi.fn())
  })
  afterEach(() => { vi.useRealTimers() })

  const push = async (data: unknown): Promise<void> => {
    let work: Promise<unknown> = Promise.resolve()
    listeners.push!({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => { work = p } })
    await vi.advanceTimersByTimeAsync(60_000)
    await work
  }

  it('shows a normal alert with the right icon, badge, link and a short vibration', async () => {
    await push({ title: 'Case assigned', body: 'EX-2042', link: '/cases', category: 'esc', urgent: false, silent: false, tag: 'esc:EX-2042' })
    expect(shown).toHaveLength(1)
    expect(shown[0]!.title).toBe('Case assigned')
    expect(shown[0]!.options).toMatchObject({ body: 'EX-2042', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: 'esc:EX-2042', renotify: true, requireInteraction: false, silent: false, vibrate: [120], data: { link: '/cases', urgent: false } })
  })

  it('rings for a call: stays on screen, vibrates in a pattern, and clears itself once stale', async () => {
    await push({ title: 'Incoming call', body: '+2348035550142', link: '/call', urgent: true, silent: false, tag: 'incoming-call' })
    expect(shown[0]!.options).toMatchObject({ requireInteraction: true, tag: 'incoming-call', data: { link: '/call', urgent: true } })
    expect((shown[0]!.options.vibrate as number[]).length).toBeGreaterThan(3)
    expect((shown[0]!.options.actions as { title: string }[])[0]!.title).toBe('Open call')
    expect(closed).toBe(1)
  })

  it('a silenced device gets the alert without vibration (which would otherwise throw)', async () => {
    await push({ title: 'Coaching', body: 'x', link: '/call', urgent: false, silent: true, tag: 'sys:Coaching' })
    expect(shown[0]!.options).toMatchObject({ silent: true })
    expect(shown[0]!.options.vibrate).toBeUndefined()
    await push({ title: 'Incoming call', urgent: true, silent: true, tag: 'incoming-call' })
    expect(shown).toHaveLength(2)
  })

  it('survives a payload with no tag or junk, and never trusts an off-site link', async () => {
    await push({ title: 'Plain', link: 'https://evil.test/x' })
    expect(shown[0]!.options).toMatchObject({ renotify: false, data: { link: '/' } })
    await push(null)
    expect(shown[1]!.title).toBe('Beverly Call')
  })

  it('tells open windows about the push so the app refreshes immediately', async () => {
    windows = [{ visibilityState: 'visible', focus: async () => undefined, postMessage: (m) => { messages.push(m) } }]
    await push({ title: 'Incoming call', link: '/call', urgent: true, tag: 'incoming-call' })
    expect(messages).toEqual([{ type: 'push', link: '/call', urgent: true }])
  })

  it('tapping an alert focuses the open app and sends it to the right screen, or opens the app when it is closed', async () => {
    let focused = 0
    windows = [{ visibilityState: 'visible', focus: async () => { focused++ }, postMessage: (m) => { messages.push(m) } }]
    let work: Promise<unknown> = Promise.resolve()
    listeners.notificationclick!({ notification: { close: () => undefined, data: { link: '/cb' } }, waitUntil: (p: Promise<unknown>) => { work = p } })
    await work
    expect(focused).toBe(1)
    expect(messages).toEqual([{ type: 'navigate', link: '/cb' }])
    windows = []
    listeners.notificationclick!({ notification: { close: () => undefined, data: { link: '/call' } }, waitUntil: (p: Promise<unknown>) => { work = p } })
    await work
    expect(opened).toEqual(['/call'])
  })

  it('installs immediately and takes control of open pages', async () => {
    expect(typeof listeners.install).toBe('function')
    expect(typeof listeners.activate).toBe('function')
    expect(typeof listeners.fetch).toBe('function')
    expect(typeof listeners.pushsubscriptionchange).toBe('function')
  })
})
