import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { uploadFixture } from '../helpers/fileUpload'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(
  currentDir,
  '..',
  'fixtures',
  'find-layouts.dxf'
)

/** Layouts: Model (B*), Planta (C*), Alçados (D*). */
let viewerModuleUrl: string | undefined

test.beforeEach(async ({ page }) => {
  viewerModuleUrl = undefined
  // The example app serves the workspace sources in dev; import the same
  // module instance in the page to read the live viewer state.
  page.on('request', request => {
    if (
      /cad-simple-viewer\/(src\/index\.ts|dist\/cad-simple-viewer\.js)/.test(
        request.url()
      )
    ) {
      viewerModuleUrl = request.url()
    }
  })
})

interface ViewerState {
  layout: string
  center: [number, number]
  selected: string[]
}

async function viewerState(page: Page): Promise<ViewerState> {
  expect(viewerModuleUrl, 'viewer module url captured').toBeTruthy()
  return page.evaluate(async url => {
    const mod = await import(/* @vite-ignore */ url)
    const manager = mod.AcApDocManager.instance
    const view = manager.curView
    let layout = ''
    for (const l of manager.curDocument.database.objects.layout.newIterator()) {
      if (l.blockTableRecordId === view.activeLayoutBtrId) layout = l.layoutName
    }
    return {
      layout,
      center: [view.center.x, view.center.y] as [number, number],
      selected: [...view.selectionSet.ids] as string[]
    }
  }, viewerModuleUrl!)
}

async function runCommand(page: Page, name: string) {
  const commandLine = page.locator('input[placeholder="Type command"]')
  await commandLine.click()
  await commandLine.fill(name)
  await page.keyboard.press('Enter')
}

async function loadFixture(page: Page) {
  await page.goto('/')
  await uploadFixture(page, fixturePath)
  await expect(page.locator('.ml-cad-container')).toBeVisible({
    timeout: 30000
  })
  await expect(page.locator('.ml-layout-tabs-button')).toHaveCount(3, {
    timeout: 30000
  })
  await page.waitForTimeout(2500)
}

async function openFind(page: Page) {
  await loadFixture(page)
  await runCommand(page, 'find')
  await expect(page.getByTestId('find-palette')).toBeVisible()
}

const input = (page: Page) => page.locator('input[data-testid="find-input"]')
const rows = (page: Page) => page.getByTestId('find-row')
const status = (page: Page) => page.getByTestId('find-status')

/** `Layout | text` for every result row, sorted. */
async function results(page: Page) {
  const list = await rows(page).evaluateAll(els =>
    els.map(
      el =>
        `${el.querySelector('.ml-find-layout')?.textContent?.trim()} | ${el
          .querySelector('.ml-find-text')
          ?.textContent?.trim()}`
    )
  )
  return list.sort()
}

async function search(page: Page, query: string) {
  await input(page).fill(query)
  await page.getByTestId('find-button').click()
}

test.describe('Find palette (full Vue UI)', () => {
  test('FIND command opens the palette on the whole-drawing scope', async ({
    page
  }) => {
    await openFind(page)
    await expect(input(page)).toBeFocused()
    await expect(
      page.getByTestId('find-current-layout-only').locator('input')
    ).not.toBeChecked()
    await expect(status(page)).toContainText('whole drawing')
  })

  test('ribbon Find button (Home > Utilities) opens the palette', async ({
    page
  }) => {
    await loadFixture(page)
    // At the default window size the Utilities group sits in the overflow.
    const overflow = page.locator('button.ml-ribbon-overflow-trigger:visible')
    if ((await overflow.count()) > 0) await overflow.first().click()
    await page.getByText('Find', { exact: true }).first().click()
    await expect(page.getByTestId('find-palette')).toBeVisible()
    await expect(input(page)).toBeFocused()
  })

  test('searches every layout by default and names the layout of each hit', async ({
    page
  }) => {
    await openFind(page)
    await search(page, 'sala')
    await expect(rows(page)).toHaveCount(3)
    expect(await results(page)).toEqual([
      'Alçados | Sala Técnica 01 (vista lateral)',
      'Model | Sala Técnica 01',
      'Planta | Legenda: Sala Técnica 01'
    ])
    await expect(status(page)).toContainText('3 found in 3 layouts')
  })

  test('is accent/case-insensitive and respects match case and hidden layers', async ({
    page
  }) => {
    await openFind(page)
    await search(page, 'alcado')
    expect(await results(page)).toEqual(['Alçados | Alçado Norte - Folha 2'])

    await search(page, 'oculta')
    await expect(rows(page)).toHaveCount(0)
    await expect(status(page)).toContainText('No text found')

    await page.getByTestId('find-match-case').click()
    await search(page, 'tecnica')
    await expect(rows(page)).toHaveCount(0)
    await search(page, 'Técnica')
    await expect(rows(page)).toHaveCount(3)
  })

  test('"Current layout only" restricts the search and can be turned off again', async ({
    page
  }) => {
    await openFind(page)
    await search(page, 'sala')
    await expect(rows(page)).toHaveCount(3)

    const toggle = page.getByTestId('find-current-layout-only')
    await toggle.click()
    await expect(rows(page)).toHaveCount(1)
    expect(await results(page)).toEqual(['Model | Sala Técnica 01'])

    await toggle.click()
    await expect(rows(page)).toHaveCount(3)
  })

  test('selecting a cross-layout hit activates the layout, zooms and selects', async ({
    page
  }) => {
    await openFind(page)
    expect((await viewerState(page)).layout).toBe('Model')
    await search(page, 'sala')

    await rows(page).filter({ hasText: 'Planta' }).click()
    await expect
      .poll(async () => (await viewerState(page)).layout)
      .toBe('Planta')
    await expect
      .poll(async () => (await viewerState(page)).selected)
      .toEqual(['C11'])
    // "Legenda: Sala Técnica 01" sits at (40, 500) in paper space.
    const planta = await viewerState(page)
    expect(planta.center[0]).toBeGreaterThan(40)
    expect(planta.center[0]).toBeLessThan(400)
    expect(planta.center[1]).toBeGreaterThan(495)
    expect(planta.center[1]).toBeLessThan(515)
    await expect(
      page.locator('.ml-layout-tabs-button.el-button--primary')
    ).toHaveText('Planta')

    // A layout that was never visited before.
    await rows(page).filter({ hasText: 'Alçados' }).click()
    await expect
      .poll(async () => (await viewerState(page)).layout)
      .toBe('Alçados')
    await expect
      .poll(async () => (await viewerState(page)).selected)
      .toEqual(['D11'])

    await rows(page).filter({ hasText: 'Model' }).click()
    await expect
      .poll(async () => (await viewerState(page)).layout)
      .toBe('Model')
    await expect
      .poll(async () => (await viewerState(page)).selected)
      .toEqual(['B1'])
  })

  test('Enter steps through hits across layouts', async ({ page }) => {
    await openFind(page)
    await input(page).fill('sala')
    await input(page).press('Enter')
    await expect
      .poll(async () => (await viewerState(page)).selected)
      .toEqual(['B1'])
    await input(page).press('Enter')
    await expect
      .poll(async () => (await viewerState(page)).layout)
      .toBe('Planta')
    await input(page).press('Enter')
    await expect
      .poll(async () => (await viewerState(page)).layout)
      .toBe('Alçados')
    await input(page).press('Shift+Enter')
    await expect
      .poll(async () => (await viewerState(page)).layout)
      .toBe('Planta')
  })
})
