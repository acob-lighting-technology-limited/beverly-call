import { expect, test, type Page } from '@playwright/test'

/** Click to call from a customer's profile: the call opens on the call screen and the number goes to the device's dialler. */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.locator('input[type=password]').fill('dev')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('an agent calls a customer from their profile and lands on an outgoing call', async ({ page }) => {
  // Record what would be handed to the dialler instead of letting the browser try to open one.
  await page.addInitScript(() => {
    const w = window as unknown as { __tel: string[] }
    w.__tel = []
    const original = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if ((this.getAttribute('href') ?? '').startsWith('tel:')) { w.__tel.push(this.getAttribute('href')!); return }
      return original.call(this)
    }
  })
  await signIn(page, 'agent@x.test')
  await expect(page).toHaveURL(/\/call$/)

  // The sample agent starts on a live call; wrap it up so a new call can start.
  await page.evaluate(async () => {
    const active = await (await fetch('/api/calls/active')).json() as { id: string } | null
    if (active) await fetch(`/api/calls/${active.id}/wrap-up`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'Resolved on the call', notes: '' }) })
  })
  const id = await page.evaluate(async () => ((await (await fetch('/api/customers/page?q=musa&limit=1')).json()) as { customers: { id: string }[] }).customers[0]!.id)
  await page.goto(`/cust?open=${id}`)

  await page.getByRole('button', { name: 'Call customer' }).click()
  await expect(page).toHaveURL(/\/call$/)
  await expect(page.getByText('Musa Garba').first()).toBeVisible()
  await expect(page.getByText('Outgoing')).toBeVisible()               // an outgoing call is not recorded, so it does not claim to be
  await expect(page.getByText('REC', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __tel: string[] }).__tel)).toEqual(['tel:08035550142'])

  // Calling again while this one is open is refused, in plain words.
  await page.goto(`/cust?open=${id}`)
  await page.getByRole('button', { name: 'Call customer' }).click()
  await expect(page.getByText('You are already on a call. Wrap it up first.')).toBeVisible()
})
