/**
 * Builds the downloadable offline viewer and its landing page.
 *
 * Output (inside the regular production `dist/`):
 *   dist/offline/index.html               landing page (PT) served at /offline/
 *   dist/offline/cad-viewer-offline.html  single self-contained viewer
 *   dist/offline/cad-viewer-offline.zip   the same file, zipped
 *
 * The viewer is one HTML file that opens straight from disk (file://) with no
 * server and no network: the app is a single inline module script, and fonts,
 * the new-drawing template, web workers and wasm are embedded as base64 and
 * served by `offline/vfs-runtime.js`.
 *
 * Fonts and the template come from the mlightcad cad-data CDN at build time
 * and are cached in node_modules/.cache/cad-viewer-offline.
 *
 * Env:
 *   CAD_SKIP_OFFLINE_BUNDLE=1  skip this step entirely
 *   CAD_OFFLINE_FONTS=all      embed every font in the catalog (~43 MB more)
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { crc32, deflateRawSync } from 'node:zlib'

import { build } from 'vite'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = join(PKG_DIR, 'dist')
const OUT_DIR = join(DIST_DIR, 'offline')
const CACHE_DIR = join(PKG_DIR, 'node_modules', '.cache', 'cad-viewer-offline')
const APP_DIR = join(CACHE_DIR, 'app')
const DATA_DIR = join(CACHE_DIR, 'cad-data')
const OFFLINE_SRC_DIR = join(PKG_DIR, 'offline')

const HTML_NAME = 'cad-viewer-offline.html'
const ZIP_NAME = 'cad-viewer-offline.zip'
const CAD_DATA_URL = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/'
const TEMPLATE_FILE = 'templates/acadiso.dxf'

/** Default fallback chain fonts (`modern` preset); the build fails without them. */
const REQUIRED_FONTS = new Set([
  'simsun.woff',
  'hztxt.shx',
  'simplex.shx',
  'amgdt.shx',
  'txt.shx'
])

/**
 * Large optional CJK faces left out by default to keep the download small
 * (~25 MB saved). Set CAD_OFFLINE_FONTS=all to embed them too.
 */
const EXCLUDED_FONTS = new Set([
  'msyh.woff',
  'simfang.woff',
  'simhei.woff',
  'simkai.woff',
  'msgothic.woff',
  'intecad.shx',
  'tssdchn.shx',
  'gbhzfs.shx',
  'yjkchn.shx',
  'whtmtxt.shx',
  'chineset.shx',
  'whtgtxt.shx',
  'zjdz.shx'
])

const MIME_TYPES = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.dxf': 'application/octet-stream',
  '.shx': 'application/octet-stream'
}

const log = message => console.log(`[offline] ${message}`)

const mimeOf = file => {
  const dot = file.lastIndexOf('.')
  return (
    MIME_TYPES[dot >= 0 ? file.slice(dot).toLowerCase() : ''] ??
    'application/octet-stream'
  )
}

const formatMb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`

async function download(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise(done => setTimeout(done, 500 * attempt))
    }
  }
  throw new Error(`Failed to download ${url}: ${lastError?.message}`)
}

/** Downloads a cad-data file once and reuses the cached copy afterwards. */
async function cadData(file, { refresh = false } = {}) {
  const cached = join(DATA_DIR, file)
  if (!refresh && existsSync(cached)) {
    return readFileSync(cached)
  }
  const data = await download(
    CAD_DATA_URL + file.split('/').map(encodeURIComponent).join('/')
  )
  mkdirSync(dirname(cached), { recursive: true })
  writeFileSync(cached, data)
  return data
}

const SAFE_FILE_NAME = /^(?!\.)[\w@ .-]+$/

async function collectFonts() {
  let catalog
  try {
    catalog = JSON.parse(
      (await cadData('fonts/fonts.json', { refresh: true })).toString('utf8')
    )
  } catch (error) {
    if (!existsSync(join(DATA_DIR, 'fonts/fonts.json'))) throw error
    log(`font catalog refresh failed, using cached copy (${error.message})`)
    catalog = JSON.parse(
      readFileSync(join(DATA_DIR, 'fonts/fonts.json'), 'utf8')
    )
  }
  const includeAll = process.env.CAD_OFFLINE_FONTS === 'all'
  // The catalog is remote data: only accept plain file names so an entry can
  // never escape the cache directory or break out of the vfs markup.
  const wanted = catalog.filter(
    font =>
      SAFE_FILE_NAME.test(font.file) &&
      (includeAll || !EXCLUDED_FONTS.has(font.file))
  )
  const files = new Map()
  const queue = [...wanted]
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length > 0) {
      const font = queue.shift()
      try {
        files.set(font.file, await cadData(`fonts/${font.file}`))
      } catch (error) {
        if (REQUIRED_FONTS.has(font.file)) throw error
        log(`skipping font ${font.file}: ${error.message}`)
      }
    }
  })
  await Promise.all(workers)
  for (const required of REQUIRED_FONTS) {
    if (!files.has(required)) {
      throw new Error(`Required font ${required} is missing from the catalog`)
    }
  }
  // Only advertise fonts that are embedded so missing ones fall back cleanly.
  const embeddedCatalog = catalog.filter(font => files.has(font.file))
  return { files, catalog: embeddedCatalog }
}

async function buildApp() {
  log('building app (vite --mode offline)')
  await build({
    root: PKG_DIR,
    mode: 'offline',
    logLevel: 'warn',
    build: { outDir: APP_DIR, emptyOutDir: true }
  })
}

/** Makes inline script text safe inside an HTML <script> element. */
const escapeScript = code =>
  code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')

const readAppHtml = () => readFileSync(join(APP_DIR, 'index.html'), 'utf8')

/** Returns the `<script type="module" src>` tag of the single app chunk. */
function findEntryScript(html) {
  const scripts = [
    ...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)
  ]
  if (scripts.length !== 1) {
    throw new Error(`Expected one entry script, found ${scripts.length}`)
  }
  const [tag, src] = scripts[0]
  return { tag, key: src.replace(/^\.?\//, '') }
}

/**
 * Inlines CSS, icons, the VFS runtime, the embedded files and the app chunk
 * into vite's index.html. The template is edited before the (large) app code
 * goes in, so no pattern can match text inside the bundle.
 */
function assembleHtml(vfsRuntime, vfsHtml) {
  let html = readAppHtml()
  const entry = findEntryScript(html)
  html = html.replace(
    /<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
    (_, href) =>
      `<style>${readFileSync(join(APP_DIR, href), 'utf8').replace(/<\/(style)/gi, '<\\/$1')}</style>`
  )
  // Icons from public/ would be loaded from disk; embed them instead.
  html = html.replace(/href="\.?\/([\w.-]+\.(?:png|ico))"/g, (match, file) => {
    const path = join(APP_DIR, file)
    if (!existsSync(path)) return match
    const data = readFileSync(path).toString('base64')
    return `href="data:${mimeOf(file)};base64,${data}"`
  })
  html = html.replace(
    '<head>',
    () => `<head>\n    <script>${escapeScript(vfsRuntime)}</script>`
  )
  const bodyEnd = html.lastIndexOf('</body>')
  html = `${html.slice(0, bodyEnd)}${vfsHtml}${html.slice(bodyEnd)}`
  const [before, after] = html.split(entry.tag)
  const fileRef = /(?:src|href)="(?:\.\/|\/)[^"]*"/.exec(before + after)
  if (fileRef) {
    throw new Error(`Offline HTML still references a local file: ${fileRef[0]}`)
  }
  const code = readFileSync(join(APP_DIR, entry.key), 'utf8')
  return `${before}<script type="module">${escapeScript(code)}</script>${after}`
}

/**
 * vfs-runtime.js starts embedded workers as classic scripts (module workers
 * from blob: URLs are blocked on file:// pages), so each script must parse as
 * one once `import.meta.url` is substituted.
 */
function assertClassicScript(file, data) {
  const source = data
    .toString('utf8')
    .split('import.meta.url')
    .join('self.__CAD_VFS_SELF_URL__')
  try {
    new vm.Script(source, { filename: file })
  } catch (error) {
    throw new Error(
      `${file} cannot run as a classic worker script: ${error.message}`
    )
  }
}

const escapeAttr = value =>
  String(value).replace(/[&"<>]/g, char => `&#${char.charCodeAt(0)};`)

function vfsBlock(key, data) {
  const lines = data.toString('base64').replace(/.{1,4096}/g, '$&\n')
  return `<script type="application/x-cad-vfs" data-key="${escapeAttr(key)}" data-mime="${escapeAttr(mimeOf(key))}">\n${lines}</script>\n`
}

/** Minimal ZIP writer (deflate) so no archive dependency is needed. */
function createZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  const now = new Date()
  const time =
    ((now.getHours() << 11) |
      (now.getMinutes() << 5) |
      (now.getSeconds() >> 1)) &
    0xffff
  const date =
    (((now.getFullYear() - 1980) << 9) |
      ((now.getMonth() + 1) << 5) |
      now.getDate()) &
    0xffff
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = deflateRawSync(data, { level: 9 })
    const stored = deflated.length >= data.length
    const body = stored ? data : deflated
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(stored ? 0 : 8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, body)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

function renderLanding(values) {
  return readFileSync(join(OFFLINE_SRC_DIR, 'landing.html'), 'utf8').replace(
    /\{\{(\w+)\}\}/g,
    (match, name) => values[name] ?? match
  )
}

async function main() {
  if (process.env.CAD_SKIP_OFFLINE_BUNDLE === '1') {
    log('CAD_SKIP_OFFLINE_BUNDLE=1, skipping')
    return
  }
  if (!existsSync(join(DIST_DIR, 'index.html'))) {
    throw new Error('Run the main build first (dist/index.html is missing)')
  }
  const started = Date.now()
  const [{ files: fonts, catalog }, template] = await Promise.all([
    collectFonts(),
    cadData(TEMPLATE_FILE),
    buildApp()
  ])
  const entry = findEntryScript(readAppHtml()).key

  const vfs = [
    ['fonts/fonts.json', Buffer.from(JSON.stringify(catalog))],
    [TEMPLATE_FILE, template],
    ...[...fonts].map(([file, data]) => [`fonts/${file}`, data])
  ]
  for (const file of readdirSync(join(APP_DIR, 'assets'))) {
    // Worker scripts, wasm and the HTML-export runtime are copied verbatim by
    // vite-plugin-static-copy and loaded at runtime by URL. The app itself
    // is a single chunk (inlineDynamicImports) already inlined above.
    if (`assets/${file}` !== entry && /\.(?:js|wasm)$/.test(file)) {
      const data = readFileSync(join(APP_DIR, 'assets', file))
      if (file.endsWith('.js')) assertClassicScript(file, data)
      vfs.push([`assets/${file}`, data])
    }
  }

  const html = assembleHtml(
    readFileSync(join(OFFLINE_SRC_DIR, 'vfs-runtime.js'), 'utf8'),
    vfs.map(([key, data]) => vfsBlock(key, data)).join('')
  )
  const htmlBuffer = Buffer.from(html, 'utf8')
  const zip = createZip([{ name: HTML_NAME, data: htmlBuffer }])

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, HTML_NAME), htmlBuffer)
  writeFileSync(join(OUT_DIR, ZIP_NAME), zip)
  const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
  writeFileSync(
    join(OUT_DIR, 'index.html'),
    renderLanding({
      HTML_NAME,
      ZIP_NAME,
      // The landing page is in Portuguese: decimal comma.
      HTML_SIZE: formatMb(htmlBuffer.length).replace('.', ','),
      ZIP_SIZE: formatMb(zip.length).replace('.', ','),
      VERSION: pkg.version,
      BUILD_DATE: new Date().toISOString().slice(0, 10),
      SHA256: createHash('sha256').update(htmlBuffer).digest('hex')
    })
  )
  log(
    `${HTML_NAME} ${formatMb(htmlBuffer.length)}, ${ZIP_NAME} ${formatMb(zip.length)}, ` +
      `${fonts.size} fonts, ${vfs.length} embedded files ` +
      `(${((Date.now() - started) / 1000).toFixed(1)}s)`
  )
}

main().catch(error => {
  console.error(`[offline] ${error.stack ?? error}`)
  process.exit(1)
})
