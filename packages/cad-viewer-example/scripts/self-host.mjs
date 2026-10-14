/**
 * Self-hosting and precaching for the online (non-offline) build.
 *
 * - Every runtime asset the viewer used to load from the cad-data CDN (font
 *   catalog, all catalog fonts, the new-drawing template) is copied into
 *   `dist/cad-data/` at build time, so the app only talks to its own origin.
 * - `dist/sw.js` is generated from `service-worker/sw.js` with a precache
 *   manifest (path, content hash, size) of every file in `dist/` except the
 *   downloadable offline bundle in `dist/offline/`.
 * - In dev, `/cad-data/*` is served from the same build cache (downloaded on
 *   first use), so dev and production use the same same-origin URLs.
 */
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  cadData,
  collectCatalogFonts,
  FONT_CATALOG_FILE,
  loadFontCatalog,
  SAFE_FILE_NAME,
  TEMPLATE_FILE
} from './cad-data.mjs'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SW_TEMPLATE = join(PKG_DIR, 'service-worker', 'sw.js')

/** Folder of `dist/` (and URL prefix) holding the self-hosted cad-data files. */
export const CAD_DATA_DIR = 'cad-data'
export const SW_FILE = 'sw.js'

/** dist files never precached: the offline download, the worker itself. */
const PRECACHE_EXCLUDE = [/^offline\//, /^sw\.js$/, /\.map$/, /(^|\/)\./]

const MIME_TYPES = {
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
}

const log = message => console.log(`[self-host] ${message}`)
const formatMb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const hash = data => createHash('sha256').update(data).digest('hex')

function writeFile(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

/**
 * Copies the font catalog, every catalog font and the drawing template into
 * `<outDir>/cad-data/`. Fails when the catalog, the template or a required
 * font cannot be fetched; other fonts are skipped (and left out of the
 * catalog) with a warning.
 */
export async function vendorCadData(outDir) {
  const root = join(outDir, CAD_DATA_DIR)
  const [fullCatalog, template] = await Promise.all([
    loadFontCatalog(log),
    cadData(TEMPLATE_FILE)
  ])
  const { files, catalog } = await collectCatalogFonts(fullCatalog, { log })
  let bytes = template.length
  for (const [file, data] of files) {
    writeFile(join(root, 'fonts', file), data)
    bytes += data.length
  }
  writeFile(join(root, FONT_CATALOG_FILE), JSON.stringify(catalog))
  writeFile(join(root, TEMPLATE_FILE), template)
  log(
    `${CAD_DATA_DIR}/: ${files.size}/${fullCatalog.length} fonts + template ` +
      `(${formatMb(bytes)})`
  )
}

function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    const relative = prefix + name
    return statSync(path).isDirectory()
      ? listFiles(path, `${relative}/`)
      : [relative]
  })
}

/**
 * Writes `<outDir>/sw.js` with the precache manifest of `outDir`. The cache
 * version is the hash of the manifest, so any content change produces a new
 * worker script and the browser installs it as an update.
 */
export function writeServiceWorker(outDir) {
  const manifest = listFiles(outDir)
    .filter(path => !PRECACHE_EXCLUDE.some(pattern => pattern.test(path)))
    .sort()
    .map(path => {
      const data = readFileSync(join(outDir, path))
      return [path, hash(data).slice(0, 16), data.length]
    })
  const version = hash(JSON.stringify(manifest)).slice(0, 16)
  const template = readFileSync(SW_TEMPLATE, 'utf8')
  const tokens = {
    'self.__CAD_PRECACHE_VERSION__': JSON.stringify(version),
    'self.__CAD_PRECACHE_MANIFEST__': JSON.stringify(manifest)
  }
  let source = template
  for (const [token, value] of Object.entries(tokens)) {
    if (!source.includes(token)) {
      throw new Error(`${SW_TEMPLATE} is missing ${token}`)
    }
    source = source.replace(token, () => value)
  }
  writeFileSync(join(outDir, SW_FILE), source)
  const bytes = manifest.reduce((sum, [, , size]) => sum + size, 0)
  log(
    `${SW_FILE}: precache ${manifest.length} files, ${formatMb(bytes)} ` +
      `(version ${version})`
  )
}

/** Serves `/cad-data/*` in dev from the build cache, downloading on demand. */
function serveCadData(req, res, next) {
  const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(
    /^\/+/,
    ''
  )
  const allowed =
    path === TEMPLATE_FILE ||
    path === FONT_CATALOG_FILE ||
    (path.startsWith('fonts/') && SAFE_FILE_NAME.test(path.slice(6)))
  if (!allowed) {
    next()
    return
  }
  cadData(path).then(
    data => {
      const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
      res.setHeader(
        'Content-Type',
        MIME_TYPES[ext] ?? 'application/octet-stream'
      )
      res.end(data)
    },
    error => {
      log(`dev: ${path}: ${error.message}`)
      res.statusCode = 404
      res.end()
    }
  )
}

/**
 * Vite plugin: same-origin cad-data in dev, and on `vite build` vendors
 * cad-data into the output and generates the service worker.
 *
 * @param {{ enabled: boolean }} options - disabled for the offline bundle
 * @returns {import('vite').Plugin}
 */
export function selfHostPlugin({ enabled }) {
  let outDir
  let isBuild = false
  return {
    name: 'cad-viewer-self-host',
    apply: () => enabled,
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      isBuild = config.command === 'build'
    },
    configureServer(server) {
      server.middlewares.use(`/${CAD_DATA_DIR}`, serveCadData)
    },
    async closeBundle() {
      if (!isBuild) return
      await vendorCadData(outDir)
      writeServiceWorker(outDir)
    }
  }
}
