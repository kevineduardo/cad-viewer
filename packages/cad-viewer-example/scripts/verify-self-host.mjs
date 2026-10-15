/**
 * Verifies that the production build of the viewer is fully self-hosted and
 * keeps working without a network once the service worker has precached it.
 *
 * 1. Starts the app with the production start command
 *    (`pnpm --filter @mlightcad/cad-viewer-example preview --host 0.0.0.0`)
 *    unless `--url` points at a running server. With `--subpath /cad-viewer/`
 *    dist/ is instead served under that path by a minimal static server, like
 *    GitHub Pages. Run `build` first.
 * 2. Online pass: opens the app, exercises the main features and records every
 *    request. Any request to another origin fails the run.
 * 3. Waits until the service worker reports that it precached every file.
 * 4. Offline pass: `context.setOffline(true)`, every request that still
 *    reaches the network is aborted, the page is reloaded and the same
 *    features are exercised again. Any request that fails or reaches the
 *    network, any console error and any page error fails the run.
 *
 * Usage:
 *   node scripts/verify-self-host.mjs [--url http://localhost:4173/]
 *     [--subpath /cad-viewer/]
 *     [--online-only] [--no-sw] [--headed] [--keep] [--only <regexp>]
 *
 * Env:
 *   PW_EXE      Chromium executable (default: Playwright's bundled browser)
 *   B11L1_DWG   real DWG to open as well (default ~/Downloads/B11L1.dwg, if any)
 */
/* global process */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_DIR = resolve(PKG_DIR, '../..')
const FIXTURES_DIR = join(PKG_DIR, 'e2e', 'fixtures')
const DIST_DIR = join(PKG_DIR, 'dist')

const args = new Set(process.argv.slice(2))
const argValue = name => {
  const all = process.argv.slice(2)
  const index = all.indexOf(name)
  return index >= 0 ? all[index + 1] : undefined
}
const ONLINE_ONLY = args.has('--online-only')
const EXPECT_SW = !args.has('--no-sw')
const HEADED = args.has('--headed')
/** `--only <regexp>` runs only the matching feature steps (debugging aid). */
const ONLY = argValue('--only') ? new RegExp(argValue('--only'), 'i') : null

const defaultDwg = join(homedir(), 'Downloads', 'B11L1.dwg')
const DWG = process.env.B11L1_DWG ?? (existsSync(defaultDwg) ? defaultDwg : '')
const DWG_QUERY = process.env.B11L1_QUERY ?? 'PORW'

const FIXTURES = [
  'minimal-line.dxf',
  'block-color.dxf',
  'aci7-bylayer-background.dxf',
  'nested-insert-layers.dxf',
  'shape-entity.dxf',
  'visible-lwpolylines-in-block.dxf',
  'find-blocks.dxf',
  'sheet_0.dxf'
]

/**
 * Text styles that pull in fonts which are only fetched on demand: every
 * mesh (woff/ttf) face of the catalog, the big CJK SHX big fonts and a few
 * common SHX shape fonts. The online pass only uses the first
 * {@link ONLINE_FONT_STYLES} of them, so the offline pass renders fonts the
 * page never requested while it was online.
 */
const FONT_STYLES = [
  ['simsun', 'simsun.woff', ''],
  ['simhei', 'simhei.woff', ''],
  ['simkai', 'simkai.woff', ''],
  ['simfang', 'simfang.woff', ''],
  ['msyh', 'msyh.woff', ''],
  ['msgothic', 'msgothic.woff', ''],
  ['noto', 'noto-sans-kr.woff', ''],
  ['arial', 'arial.woff', ''],
  ['tahoma', 'tahoma.woff', ''],
  ['verdana', 'verdana.woff', ''],
  ['sjqy', 'SJQY.woff', ''],
  ['gbgdt', 'gbgdt.woff', ''],
  ['aigdt', 'AIGDT.ttf', ''],
  ['gbhz', 'gbenor.shx', 'gbhzfs.shx'],
  ['hztxt', 'txt.shx', 'hztxt.shx'],
  ['tssd', 'tssdeng.shx', 'tssdchn.shx'],
  ['yjk', 'yjkeng.shx', 'yjkchn.shx'],
  ['whtg', 'romans.shx', 'whtgtxt.shx'],
  ['chineset', 'simplex.shx', 'chineset.shx'],
  ['zjdz', 'complex.shx', 'zjdz.shx'],
  ['intecad', 'italic.shx', 'intecad.shx'],
  ['gothic', 'gothice.shx', 'gbcbig.shx']
]

const ONLINE_FONT_STYLES = 8

const pair = (code, value) => `${code}\n${value}\n`

/** DXF with one TEXT and one MTEXT per style (CJK + Latin content). */
function fontsFixture(fontStyles) {
  let styles = ''
  let entities = ''
  fontStyles.forEach(([name, font, bigFont], index) => {
    styles +=
      pair(0, 'STYLE') +
      pair(2, name) +
      pair(70, 0) +
      pair(40, 0) +
      pair(41, 1) +
      pair(50, 0) +
      pair(71, 0) +
      pair(42, 2.5) +
      pair(3, font) +
      pair(4, bigFont)
    const y = -index * 20
    entities +=
      pair(0, 'TEXT') +
      pair(8, '0') +
      pair(10, 0) +
      pair(20, y) +
      pair(30, 0) +
      pair(40, 8) +
      pair(1, `${name}: 中文字体 汉字 ABC abc 123 ゴシック 한국어`) +
      pair(7, name) +
      pair(0, 'MTEXT') +
      pair(8, '0') +
      pair(10, 400) +
      pair(20, y) +
      pair(30, 0) +
      pair(40, 8) +
      pair(41, 400) +
      pair(71, 1) +
      pair(1, `{\\f${name}|b0|i0;MTEXT ${name} 测试文字 Ø±°}`) +
      pair(7, name)
  })
  return (
    pair(0, 'SECTION') +
    pair(2, 'HEADER') +
    pair(9, '$ACADVER') +
    pair(1, 'AC1015') +
    pair(9, '$DWGCODEPAGE') +
    pair(3, 'ANSI_936') +
    pair(0, 'ENDSEC') +
    pair(0, 'SECTION') +
    pair(2, 'TABLES') +
    pair(0, 'TABLE') +
    pair(2, 'LTYPE') +
    pair(70, 1) +
    pair(0, 'LTYPE') +
    pair(2, 'CONTINUOUS') +
    pair(70, 0) +
    pair(3, 'Solid line') +
    pair(72, 65) +
    pair(73, 0) +
    pair(40, 0) +
    pair(0, 'ENDTAB') +
    pair(0, 'TABLE') +
    pair(2, 'LAYER') +
    pair(70, 1) +
    pair(0, 'LAYER') +
    pair(2, '0') +
    pair(70, 0) +
    pair(62, 7) +
    pair(6, 'CONTINUOUS') +
    pair(0, 'ENDTAB') +
    pair(0, 'TABLE') +
    pair(2, 'STYLE') +
    pair(70, fontStyles.length) +
    styles +
    pair(0, 'ENDTAB') +
    pair(0, 'ENDSEC') +
    pair(0, 'SECTION') +
    pair(2, 'ENTITIES') +
    entities +
    pair(0, 'ENDSEC') +
    pair(0, 'EOF')
  )
}

const log = message => console.log(`[verify] ${message}`)

/** Starts `vite preview` exactly like production and resolves its URL. */
function startPreview() {
  return new Promise((resolveUrl, reject) => {
    const child = spawn(
      'pnpm',
      [
        '--filter',
        '@mlightcad/cad-viewer-example',
        'preview',
        '--host',
        '0.0.0.0'
      ],
      { cwd: REPO_DIR, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = ''
    const onData = chunk => {
      output += chunk.toString()
      // eslint-disable-next-line no-control-regex
      const plain = output.replace(/\u001b\[[0-9;]*m/g, '')
      const match = /Local:\s+(http:\/\/\S+)/.exec(plain)
      if (match) {
        child.stdout.off('data', onData)
        resolveUrl({ url: match[1], child })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', chunk => (output += chunk.toString()))
    child.on('exit', code =>
      reject(new Error(`vite preview exited (${code}):\n${output}`))
    )
  })
}

const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.zip': 'application/zip'
}

/**
 * Serves dist/ under `prefix` (e.g. `/cad-viewer/`) the way a static host
 * such as GitHub Pages does: no SPA fallback, `/prefix` redirects to
 * `/prefix/`, directories resolve to index.html.
 */
function startStaticServer(prefix) {
  const root = DIST_DIR + sep
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname === prefix.slice(0, -1)) {
      res.writeHead(301, { Location: prefix }).end()
      return
    }
    let file
    try {
      file = resolve(
        DIST_DIR,
        `.${decodeURIComponent(pathname.slice(prefix.length - 1))}`
      )
      if (pathname.startsWith(prefix) && statSync(file).isDirectory()) {
        file = join(file, 'index.html')
      }
    } catch {
      file = undefined
    }
    if (
      !pathname.startsWith(prefix) ||
      !file?.startsWith(root) ||
      !existsSync(file)
    ) {
      res.writeHead(404).end('Not found')
      return
    }
    res.writeHead(200, {
      'Content-Type':
        STATIC_MIME_TYPES[extname(file).toLowerCase()] ??
        'application/octet-stream',
      'Cache-Control': 'no-cache'
    })
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
  })
  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolveServer({ url: `http://localhost:${port}${prefix}`, server })
    })
  })
}

function stopPreview(child) {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // already gone
  }
}

/** Collects request/console activity of one pass. */
class Recorder {
  constructor(origin) {
    this.origin = origin
    this.requests = []
    this.external = []
    this.failed = []
    this.httpErrors = []
    this.consoleErrors = []
    this.pageErrors = []
    this.aborted = []
    this.fromServiceWorker = 0
    /** cad-data font file → `status (service worker|network)` */
    this.fonts = new Map()
  }

  isExternal(url) {
    if (!/^(https?|wss?):/.test(url)) return false
    return new URL(url).origin !== this.origin
  }

  attach(context) {
    context.on('request', request => {
      const url = request.url()
      this.requests.push(url)
      if (this.isExternal(url)) this.external.push(url)
    })
    context.on('requestfailed', request => {
      this.failed.push(`${request.url()} (${request.failure()?.errorText})`)
    })
    context.on('response', response => {
      if (response.fromServiceWorker()) this.fromServiceWorker++
      // Only fonts the app asked for, not the service worker's precache.
      const font = /\/cad-data\/fonts\/([^?]+)$/.exec(response.url())
      if (font && !response.request().serviceWorker()) {
        this.fonts.set(
          decodeURIComponent(font[1]),
          `${response.status()} ${response.fromServiceWorker() ? 'sw' : 'net'}`
        )
      }
      if (response.status() >= 400) {
        this.httpErrors.push(`${response.status()} ${response.url()}`)
      }
    })
  }

  attachPage(page) {
    page.on('console', message => {
      if (message.type() === 'error') {
        this.consoleErrors.push(`${message.text()} @ ${message.location().url}`)
      }
    })
    page.on('pageerror', error => this.pageErrors.push(error.message))
  }

  summary(name) {
    const unique = list => [...new Set(list)]
    return {
      pass: name,
      requests: this.requests.length,
      fromServiceWorker: this.fromServiceWorker,
      fonts: new Map(this.fonts),
      external: unique(this.external),
      failed: unique(this.failed),
      httpErrors: unique(this.httpErrors),
      aborted: unique(this.aborted),
      consoleErrors: unique(this.consoleErrors),
      pageErrors: unique(this.pageErrors)
    }
  }
}

/** Page and folder used for failure screenshots. */
const failureShots = { page: undefined, dir: undefined }

async function step(name, action) {
  if (ONLY && !ONLY.test(name)) return
  const started = Date.now()
  try {
    await action()
    log(`  ok   ${name} (${Date.now() - started} ms)`)
  } catch (error) {
    log(`  FAIL ${name}: ${error.message.split('\n')[0]}`)
    if (failureShots.page) {
      const path = join(failureShots.dir, 'failure.png')
      await failureShots.page.screenshot({ path }).catch(() => {})
      log(`  screenshot ${path}`)
    }
    throw error
  }
}

async function waitForViewer(page, minTabs = 1, timeout = 60_000) {
  await page.locator('.ml-cad-container').waitFor({ timeout })
  await page.waitForFunction(
    count =>
      document.querySelectorAll('.ml-layout-tabs-button').length >= count,
    minTabs,
    { timeout }
  )
  // Let the progressive draw / MTEXT workers settle.
  await page.waitForTimeout(2500)
}

async function openLanding(page, base) {
  await page.goto(base)
  await page.locator('input[type="file"]').first().waitFor({
    state: 'attached',
    timeout: 30_000
  })
}

async function openFile(page, base, file, minTabs = 1, timeout) {
  await openLanding(page, base)
  await page.getByRole('radio', { name: /^Write\b/ }).click()
  await page.getByRole('radio', { name: /^Extents\b/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(file)
  await waitForViewer(page, minTabs, timeout)
}

async function runCommand(page, name) {
  const commandLine = page.locator('input[placeholder="Type command"]')
  await commandLine.click()
  await commandLine.fill(name)
  await page.keyboard.press('Enter')
}

async function findText(page, query, minRows = 1) {
  await runCommand(page, 'find')
  await page.getByTestId('find-palette').waitFor()
  await page.locator('input[data-testid="find-input"]').fill(query)
  await page.getByTestId('find-button').click()
  await page.waitForFunction(
    count =>
      document.querySelectorAll('[data-testid="find-row"]').length >= count,
    minRows,
    { timeout: 30_000 }
  )
  return page.getByTestId('find-row').count()
}

/** Runs every feature check; `label` only prefixes artifact names. */
async function exercise(page, base, workDir, label) {
  failureShots.page = page
  failureShots.dir = workDir
  const fontsDxf = join(workDir, 'fonts.dxf')
  writeFileSync(
    fontsDxf,
    fontsFixture(
      label === 'online'
        ? FONT_STYLES.slice(0, ONLINE_FONT_STYLES)
        : FONT_STYLES
    )
  )

  await step('landing page', () => openLanding(page, base))

  for (const fixture of FIXTURES) {
    await step(`open ${fixture}`, () =>
      openFile(page, base, join(FIXTURES_DIR, fixture))
    )
  }

  await step('fonts fixture (all lazily loaded fonts)', async () => {
    await openFile(page, base, fontsDxf)
    await page.waitForTimeout(4000)
    await page
      .locator('.ml-cad-container canvas')
      .first()
      .screenshot({ path: join(workDir, `${label}-fonts.png`) })
  })

  await step('layouts + FIND on find-layouts.dxf', async () => {
    await openFile(page, base, join(FIXTURES_DIR, 'find-layouts.dxf'), 3)
    for (const name of ['Planta', 'Alçados', 'Model']) {
      await page
        .locator('.ml-layout-tabs-button', { hasText: name })
        .first()
        .click()
      await page.waitForTimeout(800)
    }
    const rows = await findText(page, 'sala', 3)
    if (rows !== 3) throw new Error(`FIND returned ${rows} rows, expected 3`)
  })

  await step('switch language (zh, then back to en)', async () => {
    const pick = async (label, expected) => {
      const select = page.locator('.ml-ribbon-language-switch__select:visible')
      if ((await select.count()) === 0) {
        await page.locator('button.ml-ribbon-overflow-trigger:visible').click()
      }
      await select.first().click()
      await page.waitForTimeout(400)
      await page
        .locator('.el-select-dropdown__item:visible', { hasText: label })
        .click()
      await page
        .locator('input[placeholder="' + expected + '"]')
        .waitFor({ timeout: 10_000 })
    }
    await openFile(page, base, join(FIXTURES_DIR, 'find-layouts.dxf'), 3)
    await pick('简体中文', '输入命令')
    await pick('English', 'Type command')
  })

  let pdfPath
  await step('PDF export (dialog, text mode embeds fonts)', async () => {
    await openFile(page, base, fontsDxf)
    const download = page.waitForEvent('download', { timeout: 120_000 })
    await runCommand(page, 'cpdf')
    const dialog = page.locator('.ml-base-dialog-container:visible')
    await dialog.getByText('Text', { exact: true }).first().click()
    await dialog
      .locator('.ml-base-dialog-footer button.el-button--primary')
      .click()
    const file = await download
    pdfPath = join(workDir, `${label}-export.pdf`)
    await file.saveAs(pdfPath)
  })

  await step('PDF import (ipdf)', async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 30_000 })
    await runCommand(page, 'ipdf')
    await (await chooser).setFiles(pdfPath)
    await page.waitForTimeout(4000)
  })

  await step('new drawing (template)', async () => {
    await openLanding(page, base)
    await page.getByText('New Drawing', { exact: true }).first().click()
    await waitForViewer(page)
  })

  if (DWG) {
    await step(`DWG ${DWG} + FIND "${DWG_QUERY}"`, async () => {
      await openFile(page, base, DWG, 1, 180_000)
      await page.waitForTimeout(5000)
      await page
        .locator('.ml-cad-container canvas')
        .first()
        .screenshot({ path: join(workDir, `${label}-dwg.png`) })
      const rows = await findText(page, DWG_QUERY)
      if (rows < 1) throw new Error('FIND returned no rows')
    })
  } else {
    log('  skip DWG (set B11L1_DWG)')
  }
}

async function waitForPrecache(page) {
  const started = Date.now()
  let last = ''
  for (;;) {
    const status = await page.evaluate(() => window.__CAD_PRECACHE__ ?? null)
    const text = status ? JSON.stringify(status) : 'none'
    if (text !== last) {
      log(`  precache ${text}`)
      last = text
    }
    if (status?.state === 'ready') return status
    if (status?.state === 'error') {
      throw new Error(`precache failed: ${status.error}`)
    }
    if (Date.now() - started > 600_000) throw new Error('precache timeout')
    await page.waitForTimeout(1000)
  }
}

async function cacheStats(page) {
  return page.evaluate(async () => {
    const result = { caches: [], entries: 0, bytes: 0 }
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      const keys = await cache.keys()
      result.caches.push(`${name} (${keys.length})`)
      result.entries += keys.length
      for (const key of keys) {
        const response = await cache.match(key)
        result.bytes += (await response.arrayBuffer()).byteLength
      }
    }
    return result
  })
}

function report(summary, { offline = false, onlineFonts } = {}) {
  const fonts = [...summary.fonts]
  const problems = [
    ...fonts
      .filter(
        ([, how]) => !how.startsWith('200') || (offline && how !== '200 sw')
      )
      .map(([file, how]) => `font ${file}: ${how}`),
    ...summary.external.map(url => `external request: ${url}`),
    ...summary.failed.map(url => `failed request: ${url}`),
    ...summary.httpErrors.map(url => `HTTP error: ${url}`),
    ...summary.aborted.map(url => `reached the network offline: ${url}`),
    ...summary.consoleErrors.map(text => `console error: ${text}`),
    ...summary.pageErrors.map(text => `page error: ${text}`)
  ]
  log(
    `${summary.pass}: ${summary.requests} requests, ` +
      `${summary.fromServiceWorker} served by the service worker, ` +
      `${summary.external.length} external, ${summary.failed.length} failed, ` +
      `${summary.aborted.length} hit the network while offline, ` +
      `${summary.consoleErrors.length} console errors, ` +
      `${summary.pageErrors.length} page errors`
  )
  log(
    `  ${fonts.length} font files loaded ` +
      `(${fonts.filter(([, how]) => how === '200 sw').length} from the service worker cache)`
  )
  if (onlineFonts) {
    const fresh = fonts
      .map(([file]) => file)
      .filter(file => !onlineFonts.has(file))
    log(`  never requested while online: ${fresh.length} (${fresh.join(', ')})`)
  }
  for (const problem of problems) log(`  ! ${problem}`)
  return problems.length
}

async function main() {
  let preview
  let staticServer
  let base = argValue('--url')
  const subpath = argValue('--subpath')
  if (subpath) {
    const prefix = `/${subpath.replace(/^\/+|\/+$/g, '')}/`
    staticServer = await startStaticServer(prefix)
    base = staticServer.url
  } else if (!base) {
    preview = await startPreview()
    base = preview.url
  }
  base = new URL(base).href
  const origin = new URL(base).origin
  const how = preview
    ? ' (vite preview, production start command)'
    : staticServer
      ? ' (static server, dist/ under a subpath)'
      : ''
  log(`app ${base}${how}`)

  const workDir = mkdtempSync(join(tmpdir(), 'cad-verify-'))
  const browser = await chromium.launch({
    headless: !HEADED,
    executablePath: process.env.PW_EXE || undefined
  })
  let problems = 0
  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 }
    })
    const online = new Recorder(origin)
    online.attach(context)
    const page = await context.newPage()
    online.attachPage(page)

    log('online pass')
    await exercise(page, base, workDir, 'online')
    if (EXPECT_SW) {
      await openLanding(page, base)
      const status = await waitForPrecache(page)
      const stats = await cacheStats(page)
      log(
        `precached ${status.total} files, ${(status.bytes / 1024 / 1024).toFixed(1)} MB ` +
          `(Cache Storage: ${stats.entries} entries, ${(stats.bytes / 1024 / 1024).toFixed(1)} MB in ${stats.caches.join(', ')})`
      )
    }
    const onlineSummary = online.summary('online')
    problems += report(onlineSummary)

    if (!ONLINE_ONLY) {
      log('offline pass (context offline + every network request aborted)')
      const offline = new Recorder(origin)
      offline.attach(context)
      offline.attachPage(page)
      await context.setOffline(true)
      await context.route('**/*', route => {
        offline.aborted.push(route.request().url())
        return route.abort('internetdisconnected')
      })
      // Drop the viewer's IndexedDB font cache so every font must come from
      // the service worker's precache.
      await page.evaluate(async () => {
        for (const db of await indexedDB.databases()) {
          if (db.name) indexedDB.deleteDatabase(db.name)
        }
      })
      await page.reload()
      await exercise(page, base, workDir, 'offline')
      problems += report(offline.summary('offline'), {
        offline: true,
        onlineFonts: onlineSummary.fonts
      })
    }
    log(`screenshots and PDFs in ${workDir}`)
  } finally {
    await browser.close()
    if (preview) stopPreview(preview.child)
    staticServer?.server.close()
    if (problems === 0 && !args.has('--keep')) {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
  if (problems > 0) {
    log(`${problems} problem(s)`)
    process.exit(1)
  }
  log('all checks passed')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
