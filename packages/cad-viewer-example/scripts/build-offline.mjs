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
 * and are cached in node_modules/.cache/cad-viewer-offline (cad-data.mjs).
 *
 * The viewer must never touch the internet: the page carries a strict
 * Content-Security-Policy, `offline/network-guard.js` blocks and records any
 * attempt, online-only plugins are stubbed out (vite.config.ts), and the
 * build fails if the final file contains an absolute URL that is not in
 * URL_ALLOWLIST below. `scripts/verify-offline.mjs` checks it in a browser.
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
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { crc32, deflateRawSync } from 'node:zlib'

import { build, transformWithEsbuild } from 'vite'

import {
  cadData,
  collectCatalogFonts,
  loadFontCatalog,
  TEMPLATE_FILE
} from './cad-data.mjs'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = join(PKG_DIR, 'dist')
const OUT_DIR = join(DIST_DIR, 'offline')
const CACHE_DIR = join(PKG_DIR, 'node_modules', '.cache', 'cad-viewer-offline')
const APP_DIR = join(CACHE_DIR, 'app')
const OFFLINE_SRC_DIR = join(PKG_DIR, 'offline')

const HTML_NAME = 'cad-viewer-offline.html'
const ZIP_NAME = 'cad-viewer-offline.zip'
/** Must match PDFJS_WORKER_KEY in offline/vfs-runtime.js. */
const PDFJS_WORKER_KEY = 'pdfjs/pdf.worker.js'
/** Must match VFS_ROOT in offline/vfs-runtime.js. */
const VFS_ROOT = 'https://offline.cad-viewer.invalid/'

/**
 * Content-Security-Policy of the offline viewer. Nothing may be loaded from
 * the network: scripts and styles are inline, embedded workers run from
 * blob: URLs (they inherit this policy) and images/fonts come from
 * data:/blob:. The DWG parser worker needs WebAssembly ('wasm-unsafe-eval')
 * and its embind glue builds functions with `new Function` ('unsafe-eval');
 * neither allows loading anything.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  'worker-src blob:',
  'connect-src data: blob:',
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "style-src 'unsafe-inline'",
  "object-src 'none'",
  "frame-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

/**
 * Absolute URLs that may appear in the offline file (markup, inline scripts
 * and embedded text files such as worker scripts; script comments are not
 * scanned). Anything else fails the build. Every entry must be inert at
 * runtime; keep the patterns tight and explain each group.
 */
const URL_ALLOWLIST = [
  // Answered locally by offline/vfs-runtime.js (fetch and worker fetch);
  // never reach the network.
  /^https:\/\/offline\.cad-viewer\.invalid\//,
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/mlightcad\/cad-data(?:@main)?(?:\/|\/fonts\/)?$/,
  // Identifiers compared as strings, never requested: XML/SVG/XFA
  // namespaces, URL-parsing bases, a reserved .invalid virtual base used by
  // the HTML export package reader, and URL templates in PDF.js/linkify.
  /^http:\/\/www\.w3\.org\/(?:1998\/Math\/MathML|1999\/xhtml|1999\/xlink|2000\/svg|2000\/xmlns\/|XML\/1998\/namespace|2000\/09\/xmldsig#|1999\/XSL\/Transform)$/,
  /^http:\/\/www\.xfa\.org\/schema\/[\w./-]*$/,
  /^http:\/\/ns\.adobe\.com\/(?:xdp|xdp\/pdf|xfdf|xmpmeta)\/$/,
  /^https:\/\/foo\.bar$/,
  /^https:\/\/acex-package\.invalid\/$/,
  /^https?:\/\/\$\{\w+$/,
  // Placeholder text in inputs (URL / xref path fields).
  /^https?:\/\/(?:www\.)?example\.com(?:[/:?#]|$)/,
  /^https:\/\/\.\.\.$/,
  // Link targets in the About dialog and in notifications. network-guard.js
  // renders such links as plain text and blocks window.open, so they can
  // never be followed; the mlightcad credit text stays visible.
  /^https:\/\/mlightcad\.github\.io\/cad-viewer\/$/,
  /^https:\/\/mlightcad\.com\/cad-viewer\/docs\/$/,
  /^https:\/\/mlightcad\.com\/dwg-parser\.html$/,
  /^https:\/\/github\.com\/mlightcad\/cad-viewer$/,
  // Source-code URL shown as text in the licenses panel (GPL-3.0 notice).
  /^https:\/\/github\.com\/kevineduardo\/cad-viewer$/,
  // Text only: console warnings/errors of Vue, Element Plus, opentype.js and
  // iconv-lite, and the "Producer" string pdf-lib writes into exported PDFs.
  /^https:\/\/vuejs\.org\/error-reference\/#runtime-\$\{\w+$/,
  /^https:\/\/element-plus\.org\/(?:en-US|zh-CN)\/component\/[\w.#-]+$/,
  /^https:\/\/github\.com\/vuejs\/vue-next\/pull\/2485$/,
  /^https:\/\/github\.com\/opentypejs\/opentype\.js\/issues\/183#issuecomment-\d+$/,
  /^https:\/\/github\.com\/ashtuchkin\/iconv-lite\/wiki\/[\w-]+$/,
  /^https:\/\/github\.com\/Hopding\/pdf-lib$/
]

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

async function collectFonts() {
  const catalog = await loadFontCatalog(log)
  const includeAll = process.env.CAD_OFFLINE_FONTS === 'all'
  // Only advertise fonts that are embedded so missing ones fall back cleanly.
  return collectCatalogFonts(catalog, {
    filter: font => includeAll || !EXCLUDED_FONTS.has(font.file),
    log
  })
}

/**
 * PDF.js's worker as a classic script that only defines
 * `globalThis.pdfjsWorker`; vfs-runtime.js evaluates it on first PDF import.
 * It must be the same pdfjs-dist the app bundles (PDF.js checks versions).
 */
function pdfjsWorkerScript(appCode) {
  const require = createRequire(join(PKG_DIR, '../cad-pdf-plugin/package.json'))
  const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
  const { version } = JSON.parse(
    readFileSync(join(dirname(workerPath), '../package.json'), 'utf8')
  )
  if (!appCode.includes(`"${version}"`)) {
    throw new Error(`App bundle does not use pdfjs-dist ${version}`)
  }
  const source = readFileSync(workerPath, 'utf8')
  const exportStatement = /export\s*\{\s*WorkerMessageHandler\s*\}\s*;?/g
  if ((source.match(exportStatement) ?? []).length !== 1) {
    throw new Error('Unexpected pdf.worker.min.mjs exports')
  }
  const body = source
    .replace(exportStatement, '')
    .split('import.meta.url')
    .join(JSON.stringify(VFS_ROOT + PDFJS_WORKER_KEY))
  if (!body.includes('globalThis.pdfjsWorker')) {
    throw new Error('pdf.worker.min.mjs no longer sets globalThis.pdfjsWorker')
  }
  const script = Buffer.from(
    `(function(){'use strict';\n${body}\n}).call(globalThis);\n`,
    'utf8'
  )
  assertClassicScript(PDFJS_WORKER_KEY, script)
  return script
}

/**
 * cad-pdf-plugin's library build inlines the PDF.js worker as a data: URL
 * (~3 MB) for `GlobalWorkerOptions.workerSrc`. The offline viewer never loads
 * it (see pdfjsWorkerScript), so replace it with an empty script.
 */
function dropInlinedPdfjsWorker(code) {
  let dropped = 0
  const result = code.replace(
    /data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g,
    (match, base64) => {
      const source = Buffer.from(base64, 'base64').toString('utf8')
      if (!source.includes('WorkerMessageHandler')) return match
      dropped++
      return 'data:text/javascript,'
    }
  )
  if (dropped > 0) log(`dropped ${dropped} inlined PDF.js worker copy`)
  return result
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
 * Inlines the CSP, guard and VFS runtime, CSS, icons, the embedded files and
 * the app chunk (`code`) into vite's index.html. The template is edited before the (large) app code
 * goes in, so no pattern can match text inside the bundle.
 */
function assembleHtml(headHtml, vfsHtml, code) {
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
  // The CSP and the guard must come before anything that could load a
  // resource; only the charset declaration may precede them.
  const charset = /<meta charset="[^"]*"\s*\/?>/i.exec(html)
  if (
    !charset ||
    /<(?:script|link|style|base)\b/i.test(html.slice(0, charset.index))
  ) {
    throw new Error('Expected <meta charset> before any script or link')
  }
  const headStart = charset.index + charset[0].length
  html = `${html.slice(0, headStart)}${headHtml}${html.slice(headStart)}`
  const bodyEnd = html.lastIndexOf('</body>')
  html = `${html.slice(0, bodyEnd)}${vfsHtml}${html.slice(bodyEnd)}`
  const [before, after] = html.split(entry.tag)
  const fileRef = /(?:src|href)="(?:\.\/|\/)[^"]*"/.exec(before + after)
  if (fileRef) {
    throw new Error(`Offline HTML still references a local file: ${fileRef[0]}`)
  }
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

const ABSOLUTE_URL = /\b(?:https?|wss?|ftp):\/\/[^\s"'`<>\\)\]},]*/gi
/** `//host.tld/...` right after a quote, `(` or `=`: protocol-relative. */
const PROTOCOL_RELATIVE_URL =
  /(?<=["'`(=]\s*)\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}(?=[/:"'`)\s])[^\s"'`<>\\)]*/gi

/** Script code without comments: URLs in comments are never requested. */
async function stripComments(code, name) {
  const { code: stripped } = await transformWithEsbuild(code, `${name}.js`, {
    loader: 'js',
    legalComments: 'none',
    minifyWhitespace: true,
    minifySyntax: false,
    minifyIdentifiers: false
  })
  return stripped
}

const INLINE_SCRIPT =
  /(<script\b(?![^>]*application\/x-cad-vfs)[^>]*>)([\s\S]*?)(<\/script>)/g

/**
 * Fails the build when the offline file contains an absolute or
 * protocol-relative URL outside URL_ALLOWLIST: in the page markup and
 * styles, in its inline scripts (the app bundle, guard and vfs runtime) or
 * in any embedded text file (worker scripts, JSON). Script comments are
 * ignored; string literals, markup and styles are not. Binary entries
 * (fonts, wasm, the template) are skipped.
 */
async function assertNoExternalUrls(html, vfs) {
  const page = html.replace(
    /<script type="application\/x-cad-vfs"[^>]*>[^<]*<\/script>/g,
    ''
  )
  const scripts = [...page.matchAll(INLINE_SCRIPT)]
  const sources = [[`${HTML_NAME} (markup)`, page.replace(INLINE_SCRIPT, '')]]
  for (const [index, match] of scripts.entries()) {
    const name = `${HTML_NAME} (inline script ${index + 1})`
    sources.push([name, await stripComments(match[2], name)])
  }
  for (const [key, data] of vfs) {
    if (/\.(?:js|mjs)$/.test(key)) {
      sources.push([key, await stripComments(data.toString('utf8'), key)])
    } else if (/\.(?:json|css|html)$/.test(key)) {
      sources.push([key, data.toString('utf8')])
    }
  }
  const offending = new Map()
  for (const [name, text] of sources) {
    for (const regex of [ABSOLUTE_URL, PROTOCOL_RELATIVE_URL]) {
      for (const match of text.matchAll(regex)) {
        const url = match[0]
        if (URL_ALLOWLIST.some(pattern => pattern.test(url))) continue
        if (offending.has(url)) continue
        const context = text
          .slice(Math.max(0, match.index - 60), match.index + url.length + 20)
          .replace(/\s+/g, ' ')
        offending.set(url, `${name}: ...${context}...`)
      }
    }
  }
  if (offending.size > 0) {
    const list = [...offending]
      .map(([url, where]) => `  ${url}\n      ${where}`)
      .join('\n')
    throw new Error(
      `Offline HTML references ${offending.size} URL(s) outside the allowlist:\n${list}`
    )
  }
  log(`URL check passed (${sources.length} sources scanned)`)
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
  const appCode = dropInlinedPdfjsWorker(
    readFileSync(join(APP_DIR, entry), 'utf8')
  )

  const vfs = [
    [PDFJS_WORKER_KEY, pdfjsWorkerScript(appCode)],
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

  const offlineSource = file =>
    readFileSync(join(OFFLINE_SRC_DIR, file), 'utf8')
  const html = assembleHtml(
    [
      `\n    <meta http-equiv="Content-Security-Policy" content="${escapeAttr(CSP)}" />`,
      `\n    <script>${escapeScript(offlineSource('network-guard.js'))}</script>`,
      `\n    <script>${escapeScript(offlineSource('vfs-runtime.js'))}</script>`,
      `\n    <style>${offlineSource('offline.css').replace(/<\/(style)/gi, '<\\/$1')}</style>`
    ].join(''),
    vfs.map(([key, data]) => vfsBlock(key, data)).join(''),
    appCode
  )
  await assertNoExternalUrls(html, vfs)
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
