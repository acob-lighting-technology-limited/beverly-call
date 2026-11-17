import { expect, test, type CDPSession, type Page } from '@playwright/test'

/**
 * Install and push, checked in a real Chromium-based browser. The browser's own installability audit decides whether the app
 * can be installed, and a push is delivered straight to the service worker (no push server needed) to prove an alert is shown
 * when the app is not the thing handling it.
 */
test.use({ permissions: ['notifications'] })

async function workerReady(page: Page): Promise<{ cdp: CDPSession; registrationId: string; origin: string }> {
  const cdp = await page.context().newCDPSession(page)
  let registrationId = ''
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] }) => {
    const r = e.registrations.find((x) => !x.isDeleted && x.scopeURL.endsWith('/'))
    if (r) registrationId = r.registrationId
  })
  await cdp.send('ServiceWorker.enable')
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => registrationId, { timeout: 15_000 }).not.toBe('')
  return { cdp, registrationId, origin: new URL(page.url()).origin }
}

/** Reads the alerts the worker has shown. A dev-server reload mid-read just means "try again". */
const shownNotifications = async (page: Page) => {
  for (let i = 0; i < 5; i++) {
    try { return await readNotifications(page) } catch { await page.waitForLoadState('load') }
  }
  return readNotifications(page)
}
const readNotifications = (page: Page) => page.evaluate(async () => {
  const reg = (await navigator.serviceWorker.getRegistration('/'))!
  return (await reg.getNotifications()).map((n) => ({
    title: n.title, body: n.body, tag: n.tag, silent: n.silent, requireInteraction: n.requireInteraction,
    vibrate: Array.from((n as unknown as { vibrate?: number[] }).vibrate ?? []), link: (n.data as { link?: string })?.link, urgent: (n.data as { urgent?: boolean })?.urgent,
    actions: ((n as unknown as { actions?: { title: string }[] }).actions ?? []).map((a) => a.title),
  }))
})

test('the browser itself finds nothing wrong with installing the app', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] }
  // "in-incognito" only reflects the throwaway test profile, not the app. Anything else (no icon, no manifest, no worker) is a real problem.
  expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')).toEqual([])
  const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; errors: { message: string }[] }
  expect(manifest.errors.map((e) => e.message)).toEqual([])
})

test('the service worker registers for the whole app and takes control', async ({ page }) => {
  await page.goto('/login')
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return { scope: reg.scope, active: reg.active?.state }
  })
  expect(state.scope.endsWith('/')).toBe(true)
  expect(state.active).toBe('activated')
})

test('a normal push is shown as an alert even though no page asked for it', async ({ page }) => {
  const { cdp, registrationId, origin } = await workerReady(page)
  const data = { title: 'EX-2042 assigned to you', body: 'billing', link: '/cases', category: 'esc', urgent: false, silent: false, tag: 'overdue:EX-2042' }
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(data) })
  await expect.poll(async () => (await shownNotifications(page)).length, { timeout: 10_000 }).toBe(1)
  const [n] = await shownNotifications(page)
  expect(n).toMatchObject({ title: 'EX-2042 assigned to you', body: 'billing', tag: 'overdue:EX-2042', requireInteraction: false, silent: false, link: '/cases', urgent: false })
})

test('a ringing call stays on screen until answered and offers to open the call', async ({ page }) => {
  const { cdp, registrationId, origin } = await workerReady(page)
  const data = { title: 'Incoming call', body: '+2348035550142', link: '/call', category: 'sys', urgent: true, silent: false, tag: 'incoming-call' }
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(data) })
  await expect.poll(async () => (await shownNotifications(page)).length, { timeout: 10_000 }).toBe(1)
  const [n] = await shownNotifications(page)
  expect(n).toMatchObject({ title: 'Incoming call', body: '+2348035550142', tag: 'incoming-call', requireInteraction: true, link: '/call', urgent: true })
  expect(n!.vibrate.length).toBeGreaterThan(3)
  expect(n!.actions).toEqual(['Open call'])
})

test('a second ring replaces the first instead of stacking', async ({ page }) => {
  const { cdp, registrationId, origin } = await workerReady(page)
  for (const body of ['+2348035550142', '+2348035550188']) {
    await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ title: 'Incoming call', body, link: '/call', urgent: true, tag: 'incoming-call' }) })
    await page.waitForTimeout(500)
  }
  await expect.poll(async () => (await shownNotifications(page)).map((n) => n.body), { timeout: 10_000 }).toEqual(['+2348035550188'])
})

test('a silenced device still gets the alert, without a vibration pattern', async ({ page }) => {
  const { cdp, registrationId, origin } = await workerReady(page)
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ title: 'Coaching', body: 'x', link: '/call', urgent: false, silent: true, tag: 'sys:Coaching' }) })
  await expect.poll(async () => (await shownNotifications(page)).length, { timeout: 10_000 }).toBe(1)
  const [n] = await shownNotifications(page)
  expect(n).toMatchObject({ silent: true, vibrate: [] })
})
