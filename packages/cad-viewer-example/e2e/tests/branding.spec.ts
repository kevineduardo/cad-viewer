import { expect, test } from '@playwright/test'

test('landing page shows Aitra CadViewer branding and keeps mlightcad credit', async ({
  page
}) => {
  await page.goto('/')

  await expect(page).toHaveTitle('Aitra CadViewer')
  await expect(page.locator('.upload-brand')).toHaveText('Aitra CadViewer')

  const credit = page.locator('.upload-credit a')
  await expect(credit).toHaveAttribute(
    'href',
    'https://github.com/mlightcad/cad-viewer'
  )
  await expect(credit).toContainText('mlightcad')
})
