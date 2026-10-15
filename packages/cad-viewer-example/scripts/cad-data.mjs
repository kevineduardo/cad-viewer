/**
 * Build-time access to the mlightcad cad-data repository (font catalog, font
 * files and the new-drawing template), shared by the online build
 * (`scripts/self-host.mjs`, which serves them from our own origin) and the
 * single-file offline bundle (`scripts/build-offline.mjs`).
 *
 * Files are downloaded from the jsDelivr mirror of the repository once and
 * cached in node_modules/.cache/cad-viewer-offline/cad-data.
 */
/* global Buffer */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const CAD_DATA_URL =
  'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/'
export const CAD_DATA_CACHE_DIR = join(
  PKG_DIR,
  'node_modules',
  '.cache',
  'cad-viewer-offline',
  'cad-data'
)

export const FONT_CATALOG_FILE = 'fonts/fonts.json'
export const TEMPLATE_FILE = 'templates/acadiso.dxf'

/** Default fallback chain fonts (`modern` preset); builds fail without them. */
export const REQUIRED_FONTS = new Set([
  'simsun.woff',
  'hztxt.shx',
  'simplex.shx',
  'amgdt.shx',
  'txt.shx'
])

/**
 * The catalog is remote data: only plain file names are accepted so an entry
 * can never escape the cache/output directory or break out of markup.
 */
export const SAFE_FILE_NAME = /^(?!\.)[\w@ .-]+$/

export async function download(url, attempts = 3) {
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

/** Path of a cad-data file inside the local cache. */
export const cadDataCachePath = file => join(CAD_DATA_CACHE_DIR, file)

/** Downloads a cad-data file once and reuses the cached copy afterwards. */
export async function cadData(file, { refresh = false } = {}) {
  const cached = cadDataCachePath(file)
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

/**
 * Returns the font catalog, refreshed from the network when possible and
 * falling back to the cached copy otherwise.
 */
export async function loadFontCatalog(log = console.log) {
  try {
    return JSON.parse(
      (await cadData(FONT_CATALOG_FILE, { refresh: true })).toString('utf8')
    )
  } catch (error) {
    const cached = cadDataCachePath(FONT_CATALOG_FILE)
    if (!existsSync(cached)) throw error
    log(`font catalog refresh failed, using cached copy (${error.message})`)
    return JSON.parse(readFileSync(cached, 'utf8'))
  }
}

/**
 * Downloads the catalog entries accepted by `filter` (8 at a time).
 * A missing required font throws; other failures are logged and skipped.
 *
 * @returns `{ files, catalog }` — file name → bytes, and the catalog
 *   restricted to the fonts that were fetched, so the app never advertises a
 *   font it cannot load.
 */
export async function collectCatalogFonts(
  catalog,
  { filter = () => true, log = console.log } = {}
) {
  const wanted = catalog.filter(
    font => SAFE_FILE_NAME.test(font.file) && filter(font)
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
  return { files, catalog: catalog.filter(font => files.has(font.file)) }
}
