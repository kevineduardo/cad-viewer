/**
 * Verifies that the single-file offline viewer never touches the network.
 *
 * Opens dist/offline/cad-viewer-offline.html from file:// in Chromium with
 * every http(s)/ws(s) request aborted and recorded, then exercises the app:
 * landing page, New Drawing, every ribbon tab and the File menu, every
 * language, the settings menus, About, all exports (DXF, HTML, PDF, SVG,
 * PNG), PDF import, the DXF fixtures in e2e/fixtures (layout switching and
 * FIND) and, when available, a real DWG.
 *
 * It fails when any of these is non-zero:
 *   - network attempts (requests/WebSockets seen by the browser, plus those
 *     refused by offline/network-guard.js inside the page or a worker)
 *   - CSP violations (securitypolicyviolation events in the page and the
 *     embedded workers, and CSP console reports)
 *   - console errors / uncaught page errors
 *   - failed steps
 *
 * Usage: pnpm --filter @mlightcad/cad-viewer-example verify:offline
 * Env:
 *   OFFLINE_HTML  viewer file (default dist/offline/cad-viewer-offline.html)
 *   PW_EXE        Chromium executable (default: Playwright's Chrome for
 *                 Testing 1243 on macOS, else Playwright's bundled browser)
 *   B11L1_DWG     DWG to open (default ~/Downloads/B11L1.dwg, skipped when
 *                 missing)
 *   HEADED=1      show the browser
 *   SCREENSHOTS   directory for a screenshot after each step (optional)
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HTML_PATH = resolve(
  process.env.OFFLINE_HTML ??
    join(PKG_DIR, 'dist', 'offline', 'cad-viewer-offline.html')
)
const FIXTURES_DIR = join(PKG_DIR, 'e2e', 'fixtures')
const FIXTURES = [
  'minimal-line.dxf',
  'find-layouts.dxf',
  'find-blocks.dxf',
  'shape-entity.dxf'
]
const DWG_PATH = resolve(
  process.env.B11L1_DWG ?? join(homedir(), 'Downloads', 'B11L1.dwg')
)
const DEFAULT_EXE = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
)
const EXECUTABLE =
  process.env.PW_EXE ?? (existsSync(DEFAULT_EXE) ? DEFAULT_EXE : undefined)

/** URLs that never leave the machine. */
const LOCAL_URL = /^(?:data|blob|file|about|chrome-error):/i

const results = {
  attempts: [],
  violations: [],
  consoleErrors: [],
  failedSteps: [],
  steps: [],
  downloads: []
}

const log = message => console.log(`[verify-offline] ${message}`)

function recordAttempt(source, url) {
  results.attempts.push({ source, url })
  log(`NETWORK ATTEMPT (${source}): ${url}`)
}

async function step(name, fn) {
  const started = Date.now()
  try {
    await fn()
    if (process.env.SCREENSHOTS && results.page) {
      const file = `${String(results.steps.length + 1).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '_').slice(0, 60)}.png`
      await results.page.screenshot({
        path: join(process.env.SCREENSHOTS, file)
      })
    }
    results.steps.push(name)
    log(`ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  } catch (error) {
    results.failedSteps.push({ name, error: String(error?.message ?? error) })
    log(`FAIL ${name}: ${String(error?.message ?? error).split('\n')[0]}`)
  }
}

/** Moves the page-side records (network guard + CSP) into the results. */
async function collectPageRecords(page) {
  const records = await page
    .evaluate(() => ({
      blocked: window.__CAD_OFFLINE_BLOCKED__ ?? null,
      violations: window.__CAD_OFFLINE_CSP_VIOLATIONS__ ?? null
    }))
    .catch(() => null)
  if (!records || !records.blocked || !records.violations) {
    results.failedSteps.push({
      name: 'collect page records',
      error: 'network guard not installed in the page'
    })
    return
  }
  for (const { kind, url } of records.blocked)
    recordAttempt(`guard ${kind}`, url)
  for (const violation of records.violations) {
    results.violations.push(violation)
    log(`CSP VIOLATION: ${JSON.stringify(violation)}`)
  }
  await page.evaluate(() => {
    window.__CAD_OFFLINE_BLOCKED__.length = 0
    window.__CAD_OFFLINE_CSP_VIOLATIONS__.length = 0
  })
}

/** External links that could still be followed (should be none). */
async function assertNoLiveExternalLinks(page) {
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href], area[href]')]
      .map(link => link.getAttribute('href'))
      .filter(href => /^\s*(?:https?|wss?|ftp):/i.test(href))
  )
  if (links.length > 0) {
    throw new Error(`live external links: ${links.join(', ')}`)
  }
}

async function openViewer(page) {
  if (page.url() !== 'about:blank') await collectPageRecords(page)
  await page.goto(pathToFileURL(HTML_PATH).href)
  await page.locator('.ml-ui-file-open-primary').waitFor({ timeout: 60_000 })
}

async function waitForDrawing(page, timeout = 60_000) {
  await page.locator('.ml-cad-container').waitFor({ timeout })
  await page
    .locator('.ml-layout-tabs-button[role="tab"]')
    .first()
    .waitFor({ timeout })
  await page.waitForTimeout(2000)
}

async function uploadDrawing(page, file, timeout) {
  await openViewer(page)
  await page.getByRole('radio', { name: /^Write\b/ }).click()
  await page.getByRole('radio', { name: /^Extents\b/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(file)
  await waitForDrawing(page, timeout)
}

async function runCommand(page, command) {
  const input = page.locator('input.ml-cli-text')
  await input.click()
  await input.fill(command)
  await page.keyboard.press('Enter')
}

/** Opens File > ...submenus (hovered) > item (clicked). */
async function clickFileMenu(page, ...labels) {
  await page.locator('.ml-ribbon-tab--file').click()
  for (const [index, label] of labels.entries()) {
    const item = page
      .locator('.el-dropdown-menu__item:visible')
      .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })
      .first()
    await item.hover()
    if (index === labels.length - 1) await item.click()
  }
}

async function expectDownload(page, trigger, timeout = 60_000) {
  const download = page.waitForEvent('download', { timeout })
  // Avoid an unhandled rejection when the trigger itself fails.
  download.catch(() => {})
  await trigger()
  const file = await download
  const path = join(results.tempDir, file.suggestedFilename())
  await file.saveAs(path)
  results.downloads.push(file.suggestedFilename())
  return path
}

async function clickDialogOk(page) {
  await page
    .locator('.ml-base-dialog-footer-actions .el-button--primary:visible')
    .first()
    .click()
}

async function zoomExtents(page) {
  await runCommand(page, 'zoom')
  await runCommand(page, 'e')
  await page.waitForTimeout(1000)
}

/** PNG (base64) of the drawing canvas only, without overlays. */
async function canvasSnapshot(page) {
  await page.keyboard.press('Escape')
  await page.mouse.move(5, 5)
  const png = await page
    .locator('.ml-cad-container canvas')
    .first()
    .screenshot({
      style:
        'body * { visibility: hidden !important; } ' +
        '.ml-cad-container canvas { visibility: visible !important; }'
    })
  return png.toString('base64')
}

/** Number of pixels that differ between two canvas snapshots. */
async function changedPixels(page, before, after) {
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async base64 => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, canvas.width, canvas.height).data
      }
      const [x, y] = await Promise.all([pixels(a), pixels(b)])
      if (x.length !== y.length) return Number.MAX_SAFE_INTEGER
      let changed = 0
      for (let i = 0; i < x.length; i += 4) {
        const diff =
          Math.abs(x[i] - y[i]) +
          Math.abs(x[i + 1] - y[i + 1]) +
          Math.abs(x[i + 2] - y[i + 2])
        if (diff > 60) changed++
      }
      return changed
    },
    [before, after]
  )
}

async function switchLayouts(page) {
  const tabs = page.locator('.ml-layout-tabs-button[role="tab"]')
  const count = await tabs.count()
  for (let i = count - 1; i >= 0; i--) {
    await tabs.nth(i).click()
    await page.waitForTimeout(1000)
  }
  return count
}

async function find(page, query) {
  await runCommand(page, 'find')
  await page.getByTestId('find-palette').waitFor()
  await page.locator('input[data-testid="find-input"]').fill(query)
  await page.getByTestId('find-button').click()
  await page.getByTestId('find-row').first().waitFor({ timeout: 30_000 })
  return page.getByTestId('find-row').count()
}

async function main() {
  if (!existsSync(HTML_PATH)) {
    throw new Error(`${HTML_PATH} not found; run the build first`)
  }
  for (const fixture of FIXTURES) {
    if (!existsSync(join(FIXTURES_DIR, fixture))) {
      throw new Error(`missing fixture ${fixture}`)
    }
  }
  results.tempDir = mkdtempSync(join(tmpdir(), 'cad-offline-verify-'))
  log(`file: ${HTML_PATH}`)
  log(`browser: ${EXECUTABLE ?? 'Playwright default chromium'}`)

  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    headless: process.env.HEADED !== '1'
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    serviceWorkers: 'block'
  })
  await context.route(
    url => !LOCAL_URL.test(url.href),
    route => {
      recordAttempt('route', route.request().url())
      return route.abort('blockedbyclient')
    }
  )
  await context.routeWebSocket(/.*/, ws => {
    recordAttempt('websocket', ws.url())
    return ws.close()
  })
  context.on('request', request => {
    if (!LOCAL_URL.test(request.url())) {
      recordAttempt('request', request.url())
    }
  })
  const onConsole = source => message => {
    const text = message.text()
    if (/Content[ -]Security[ -]Policy/i.test(text)) {
      results.violations.push({ source, text })
      log(`CSP CONSOLE (${source}): ${text}`)
    } else if (message.type() === 'error') {
      results.consoleErrors.push(text)
      log(`CONSOLE ERROR (${source}): ${text}`)
    }
  }
  context.on('console', onConsole('page'))

  const page = await context.newPage()
  results.page = page
  page.on('pageerror', error => {
    results.consoleErrors.push(`pageerror: ${error.message}`)
    log(`PAGE ERROR: ${error.message}`)
  })
  // Worker consoles are separate (CSP reports of workers land there). Every
  // worker must be an embedded one started by vfs-runtime.js, whose prelude
  // blocks and reports network access; anything else is a blind spot.
  page.on('worker', worker => {
    worker.on('console', onConsole('worker'))
    worker
      .evaluate(() => typeof self.__CAD_VFS_SELF_URL__ === 'string')
      .catch(() => true)
      .then(guarded => {
        if (guarded) return
        results.failedSteps.push({
          name: 'worker check',
          error: `worker without the offline guard: ${worker.url()}`
        })
        log(`UNGUARDED WORKER: ${worker.url()}`)
      })
  })
  page.on('popup', popup => {
    recordAttempt('popup', popup.url())
  })

  await step('landing page', async () => {
    await openViewer(page)
    const html = await page.content()
    if (!html.includes('http-equiv="Content-Security-Policy"')) {
      throw new Error('CSP meta missing')
    }
    const credit = page.locator('.upload-credit')
    if (!(await credit.textContent())?.includes('mlightcad')) {
      throw new Error('mlightcad credit text missing')
    }
    const sources = await page
      .locator('.ml-ui-file-open-menu-item')
      .allTextContents()
    if (sources.length !== 1 || sources.some(text => /url/i.test(text))) {
      throw new Error(`unexpected open sources: ${sources.join(', ')}`)
    }
    await assertNoLiveExternalLinks(page)
  })

  await step('new drawing', async () => {
    await openViewer(page)
    await page.locator('.ml-ui-file-open-primary').click()
    await waitForDrawing(page)
    // The mobile command help opens the online user guide in an iframe.
    if (await page.locator('.ml-mobile-cmd-help').isVisible()) {
      throw new Error('online help button visible')
    }
  })

  await step('ribbon tabs and File menu', async () => {
    const tabs = page.locator('.ml-ribbon-tab[role="tab"]')
    const names = await tabs.allTextContents()
    for (let i = 0; i < names.length; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(400)
    }
    if (names.some(name => /\b(?:AI|Agent)\b/i.test(name))) {
      throw new Error(`AI tab present: ${names.join(', ')}`)
    }
    await tabs.first().click()
    await page.locator('.ml-ribbon-tab--file').click()
    await page.locator('.el-dropdown-menu__item:visible').first().waitFor()
    const items = await page
      .locator('.el-dropdown-menu__item:visible')
      .allTextContents()
    if (items.some(text => /offline/i.test(text))) {
      throw new Error('"Offline version" entry shown in the offline build')
    }
    await page.keyboard.press('Escape')
    const agent = await page.locator('text=/AI Assistant|CAD Agent/i').count()
    if (agent > 0) throw new Error('AI assistant entry visible')
    log(`  tabs: ${names.join(', ')}; File menu: ${items.length} items`)
  })

  await step('status bar settings menus', async () => {
    for (const selector of [
      '.ml-setting-button',
      '.ml-osnap-setting-button',
      '.ml-polar-tracking-button__arrow'
    ]) {
      await page.locator(selector).first().click()
      await page.waitForTimeout(400)
      await page.keyboard.press('Escape')
      await page.mouse.click(700, 500)
    }
  })

  await step('every language', async () => {
    const select = page.locator('.ml-ribbon-language-switch__select')
    await select.click()
    const options = page.locator('.el-select-dropdown__item:visible')
    await options.first().waitFor()
    const labels = await options.allTextContents()
    if (labels.length < 2) throw new Error('language list not found')
    await page.keyboard.press('Escape')
    for (const label of [...labels.slice(1), labels[0]]) {
      await select.click()
      await page
        .locator('.el-select-dropdown__item:visible')
        .filter({ hasText: label })
        .first()
        .click()
      await page.waitForTimeout(800)
    }
    log(`  languages: ${labels.map(label => label.trim()).join(', ')}`)
  })

  await step('About dialog', async () => {
    await clickFileMenu(page, 'About')
    const dialog = page.locator('.ml-ui-about-links')
    await dialog.waitFor()
    await assertNoLiveExternalLinks(page)
    if (process.env.SCREENSHOTS) {
      await page.screenshot({
        path: join(process.env.SCREENSHOTS, 'about-dialog.png')
      })
    }
    await page.locator('.ml-ui-about-link').first().click({ force: true })
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
  })

  let pdfPath
  await step('draw something to export', async () => {
    const before = await canvasSnapshot(page)
    await runCommand(page, 'line')
    for (const point of ['0,0', '100,0', '100,50', '0,0', '']) {
      await runCommand(page, point)
      await page.waitForTimeout(200)
    }
    await zoomExtents(page)
    const changed = await changedPixels(
      page,
      before,
      await canvasSnapshot(page)
    )
    if (changed < 500) throw new Error('drawn lines are not visible')
    log(`  lines drawn: ${changed} canvas pixels changed`)
  })

  await step('export DXF', async () => {
    await expectDownload(page, () =>
      clickFileMenu(page, 'Export', 'Export to DXF')
    )
  })

  await step('export HTML', async () => {
    await expectDownload(page, async () => {
      await clickFileMenu(page, 'Export', 'Export to HTML')
      await clickDialogOk(page)
    })
  })

  await step('export PDF', async () => {
    pdfPath = await expectDownload(page, async () => {
      await clickFileMenu(page, 'Export', 'Export to PDF')
      await clickDialogOk(page)
    })
  })

  await step('export SVG', async () => {
    await expectDownload(page, () =>
      clickFileMenu(page, 'Export', 'Export to SVG')
    )
  })

  await step('export PNG', async () => {
    await expectDownload(page, async () => {
      await clickFileMenu(page, 'Export', 'Export to Image')
      // Accept the default answers of any prompts.
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(500)
        await page.keyboard.press('Enter')
      }
    })
  })

  await step('import PDF', async () => {
    if (!pdfPath) throw new Error('no exported PDF to import')
    // `ipdf` is known to the command line once the PDF plugin is loaded,
    // which the PDF export above did.
    const before = await canvasSnapshot(page)
    const chooser = page.waitForEvent('filechooser')
    await runCommand(page, 'ipdf')
    await (await chooser).setFiles(pdfPath)
    await page.waitForFunction(
      () => window.pdfjsWorker?.WorkerMessageHandler != null,
      null,
      { timeout: 30_000 }
    )
    await page.waitForTimeout(2000)
    await zoomExtents(page)
    const changed = await changedPixels(
      page,
      before,
      await canvasSnapshot(page)
    )
    if (changed < 500) throw new Error('nothing imported from the PDF')
    log(`  PDF imported: ${changed} canvas pixels changed`)
  })

  for (const fixture of FIXTURES) {
    await step(`open ${fixture}`, async () => {
      await uploadDrawing(page, join(FIXTURES_DIR, fixture))
      const layouts = await switchLayouts(page)
      log(`  layouts: ${layouts}`)
      if (fixture === 'find-layouts.dxf') {
        const rows = await find(page, 'Quadro')
        log(`  FIND "Quadro": ${rows} result(s)`)
      }
      if (fixture === 'find-blocks.dxf') {
        const rows = await find(page, 'Aitra')
        log(`  FIND "Aitra": ${rows} result(s)`)
      }
    })
  }

  if (existsSync(DWG_PATH)) {
    await step(`open ${DWG_PATH}`, async () => {
      await uploadDrawing(page, DWG_PATH, 180_000)
      const layouts = await switchLayouts(page)
      const rows = await find(page, 'B')
      log(`  layouts: ${layouts}; FIND "B": ${rows} result(s)`)
    })
  } else {
    log(`skipping DWG: ${DWG_PATH} not found`)
  }

  await collectPageRecords(page)
  // Give late worker reports a moment, then collect again.
  await page.waitForTimeout(1000)
  await collectPageRecords(page)
  await browser.close()
  rmSync(results.tempDir, { recursive: true, force: true })

  const summary = {
    networkAttempts: results.attempts.length,
    cspViolations: results.violations.length,
    consoleErrors: results.consoleErrors.length,
    failedSteps: results.failedSteps.length,
    passedSteps: results.steps.length,
    downloads: results.downloads
  }
  console.log(JSON.stringify(summary, null, 2))
  if (results.failedSteps.length > 0) {
    console.log(JSON.stringify(results.failedSteps, null, 2))
  }
  const failed =
    summary.networkAttempts +
      summary.cspViolations +
      summary.consoleErrors +
      summary.failedSteps >
    0
  log(failed ? 'FAILED' : 'PASSED: zero network access')
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.error(`[verify-offline] ${error.stack ?? error}`)
  process.exit(1)
})
