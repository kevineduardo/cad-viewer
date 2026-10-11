import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'find-layouts.dxf'
)

/**
 * OBJ-0100 follow-up: at 390x844 the ribbon collapses the Find command into
 * the "…" overflow popup (same rule as every other overflowing command). The
 * popup button must be hit-testable (not covered by another element) and the
 * FIND palette must fit the viewport and keep its keyboard/touch flow.
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
})

test('FIND via ribbon overflow and palette are usable at 390x844', async ({
  page
}) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(fixturePath)
  await expect(page.locator('.ml-cad-container')).toBeVisible({
    timeout: 30_000
  })

  // Overflow trigger of the Home tab (the only ribbon "…" button).
  await page.locator('button.ml-ribbon-overflow-trigger:visible').first().tap()
  const findBtn = page
    .locator('.ml-ribbon-button:visible')
    .filter({ hasText: /^\s*find\s*$/i })
    .first()
  await expect(findBtn).toBeVisible()

  // Overlap check: the element at the Find button centre is the button itself.
  const covered = await findBtn.evaluate(el => {
    const b = el.getBoundingClientRect()
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
    return { inside: !!hit && el.contains(hit), right: b.right, w: b.width }
  })
  expect(covered.inside).toBe(true)
  expect(covered.right).toBeLessThanOrEqual(390)

  await findBtn.tap()
  const palette = page.getByTestId('find-palette')
  await expect(palette).toBeVisible()
  const box = (await palette.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(box.width).toBeGreaterThanOrEqual(240)

  // Keyboard: input focused, Enter runs the search; touch: tap selects a row.
  const input = page.locator('input[data-testid="find-input"]')
  await expect(input).toBeFocused()
  await input.fill('Sala')
  await input.press('Enter')
  const rows = page.getByTestId('find-row')
  await expect(rows.first()).toBeVisible()
  const form = await page.getByTestId('find-button').boundingBox()
  expect(form!.x + form!.width).toBeLessThanOrEqual(box.x + box.width + 1)
  await rows.first().tap()
  await expect(rows.first()).toHaveClass(/is-selected/)
  console.log('PALETTE', JSON.stringify({ box, covered }))
})
