/**
 * Build-time flags for the downloadable offline bundle.
 *
 * `vite build --mode offline` (driven by `scripts/build-offline.mjs`) produces
 * a single self-contained HTML file. Fonts, the new-drawing template, web
 * workers and wasm are embedded in it and served by `offline/vfs-runtime.js`
 * from a virtual root, so the page works from `file://` with no network.
 */

/** True when this bundle was built with `--mode offline`. */
export const IS_OFFLINE_BUILD = import.meta.env.MODE === 'offline'

/**
 * Page offering the offline bundle for download (relative to the app root).
 * Undefined inside the offline bundle itself so the UI entry is hidden there.
 */
export const OFFLINE_VERSION_URL = IS_OFFLINE_BUILD ? undefined : './offline/'

declare global {
  interface Window {
    /** Virtual root served by the offline bundle's embedded file system. */
    __CAD_OFFLINE_VFS_ROOT__?: string
  }
}

/**
 * Root URL for fonts (`fonts/`) and drawing templates (`templates/`).
 *
 * The online build serves them from its own origin (`cad-data/` next to
 * index.html, vendored at build time by `scripts/self-host.mjs`). The offline
 * bundle answers requests under its virtual root from embedded data. The URL
 * is absolute because it is also forwarded to MTEXT web workers, which cannot
 * resolve relative URLs from a `blob:` script.
 */
export const resolveCadDataBaseUrl = (): string =>
  IS_OFFLINE_BUILD
    ? (window.__CAD_OFFLINE_VFS_ROOT__ ??
      new URL('./', window.location.href).href)
    : new URL('./cad-data/', window.location.href).href
