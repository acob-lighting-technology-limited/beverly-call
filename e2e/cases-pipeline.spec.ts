import { expect, test, type Page } from '@playwright/test'

/** Opening a case and moving it through the desk, as the people who do it. Runs on the sample data (EX-2038 starts unassigned, in the queue). */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.locator('input[type=password]').fill('dev')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('a supervisor takes a case from the queue, then hands it to a colleague', async ({ page }) => {
  await signIn(page, 'sup@x.test')
  await page.goto('/cases')
  await expect(page.getByRole('button', { name: /^Queue/ })).toBeVisible()
  const row = page.getByRole('row', { name: /EX-2038/ })
  await expect(row).toContainText('In queue')
  await row.click()
  await page.getByRole('button', { name: 'Take this case' }).click()
  await expect(page.getByText(/sup took it from the queue and started/)).toBeVisible()
  await expect(row).not.toContainText('In queue')

  await page.getByRole('button', { name: 'Hand over' }).click()
  const chidi = await page.locator('#cp-hand option', { hasText: 'Chidi Okafor' }).getAttribute('value')
  await page.getByLabel('Give it to').selectOption(chidi!)
  await page.getByLabel('Note for the new holder').fill('You know this customer')
  await page.getByRole('button', { name: 'Hand over', exact: true }).last().click()
  await expect(page.getByText(/moved it from sup to Chidi Okafor \(You know this customer\)/)).toBeVisible()
  await expect(page.getByText('not started')).toBeVisible()
})

test('an agent opens a case into the queue and then takes it, and a link in an alert opens the case', async ({ page }) => {
  await signIn(page, 'agent@x.test')
  await page.goto('/cases')
  await page.getByRole('button', { name: 'Open a case' }).click()
  const dialog = page.getByRole('dialog', { name: 'Open a case' })
  await dialog.getByPlaceholder(/Name, phone, meter/).fill('musa')
  await dialog.getByRole('button', { name: /Musa Garba/ }).click()
  const who = dialog.getByLabel('Give it to')
  await who.selectOption({ index: 1 })                              // "The queue": the first choice after "Me"
  await expect(dialog.getByText(/waits in the queue/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Open case' }).click()

  await page.getByRole('button', { name: /^Queue/ }).click()
  const row = page.getByRole('row', { name: /billing|wallet|token|meter|hardware|tamper|other/i }).filter({ hasText: 'In queue' }).first()
  await expect(row).toBeVisible()
  const ref = (await row.locator('td').first().textContent())!.trim()
  await page.goto(`/cases?open=${ref}`)
  await expect(page.locator('.cp-ref')).toHaveText(ref)
  await page.getByRole('button', { name: 'Take this case' }).click()
  await expect(page.getByText(/took it from the queue and started/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resolve this case' })).toBeVisible()
})
