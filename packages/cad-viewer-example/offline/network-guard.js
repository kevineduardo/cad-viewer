/*
 * Network guard for the single-file offline CAD viewer.
 *
 * Inlined as the first classic <script> of cad-viewer-offline.html (right
 * after the Content-Security-Policy <meta>) by scripts/build-offline.mjs,
 * before vfs-runtime.js. The CSP already stops the browser from loading
 * anything from the network; this script makes the app fail fast and
 * quietly instead of tripping it, and covers what CSP cannot (opening new
 * windows and following links):
 *
 * - fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon / Worker
 *   reject any URL that is not data:, blob: or about:. vfs-runtime.js wraps
 *   fetch and Worker again on top of this, so embedded files still resolve.
 * - window.open only opens about:blank, blob: and data: URLs.
 * - Links to the internet are turned into plain text (the label stays, e.g.
 *   the mlightcad/cad-viewer credit required by the license) and clicks on
 *   any that slip through are cancelled.
 *
 * Every blocked attempt is recorded in window.__CAD_OFFLINE_BLOCKED__ and
 * every CSP violation (page and embedded workers) in
 * window.__CAD_OFFLINE_CSP_VIOLATIONS__, so scripts/verify-offline.mjs can
 * assert that nothing tried to go online.
 */
;(function () {
  'use strict'

  var blocked = []
  var violations = []
  window.__CAD_OFFLINE_BLOCKED__ = blocked
  window.__CAD_OFFLINE_CSP_VIOLATIONS__ = violations

  /** Records a CSP violation (from the page or, via vfs-runtime, a worker). */
  function recordViolation(source, event) {
    var entry = {
      source: source,
      directive: event.effectiveDirective || event.violatedDirective,
      blockedURI: event.blockedURI,
      sample: event.sample || ''
    }
    violations.push(entry)
    return entry
  }
  window.__CAD_OFFLINE_RECORD_VIOLATION__ = recordViolation
  document.addEventListener('securitypolicyviolation', function (event) {
    recordViolation('page', event)
  })

  function record(kind, url) {
    var entry = { kind: kind, url: String(url) }
    blocked.push(entry)
    console.warn('[offline] blocked network access (' + kind + '): ' + url)
    return entry
  }
  window.__CAD_OFFLINE_RECORD_BLOCKED__ = record

  function rawUrl(input) {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.href
    if (input && typeof input.url === 'string') return input.url
    return String(input)
  }

  /** True when loading `input` stays inside the browser (no network). */
  function isLocal(input) {
    var url
    try {
      url = new URL(rawUrl(input), document.baseURI)
    } catch (_error) {
      return false
    }
    return (
      url.protocol === 'data:' ||
      url.protocol === 'blob:' ||
      url.protocol === 'about:'
    )
  }

  function networkError(kind, url) {
    record(kind, url)
    return new TypeError(
      'Network access is disabled in the offline version (' + url + ')'
    )
  }

  var nativeFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    if (!isLocal(input)) {
      return Promise.reject(networkError('fetch', rawUrl(input)))
    }
    return nativeFetch(input, init)
  }

  var nativeXhrOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    if (!isLocal(url)) throw networkError('xhr', url)
    return nativeXhrOpen.apply(this, arguments)
  }

  function guardConstructor(name) {
    var Native = window[name]
    if (typeof Native !== 'function') return
    var Guarded = function (url, options) {
      if (!isLocal(url)) throw networkError(name, rawUrl(url))
      return new Native(url, options)
    }
    Guarded.prototype = Native.prototype
    window[name] = Guarded
  }
  guardConstructor('WebSocket')
  guardConstructor('EventSource')
  guardConstructor('Worker')
  guardConstructor('SharedWorker')

  if (navigator.sendBeacon) {
    navigator.sendBeacon = function (url) {
      record('beacon', url)
      return false
    }
  }

  var nativeOpen = window.open
  window.open = function (url) {
    if (url == null || url === '' || isLocal(url)) {
      return nativeOpen.apply(window, arguments)
    }
    record('window.open', url)
    return null
  }

  var EXTERNAL_LINK = /^\s*(?:https?|wss?|ftp):/i
  var LINK_TITLE = 'Not available in the offline version'

  /** Keeps the link text but drops the address, so it reads as plain text. */
  function neutralize(link) {
    var href = link.getAttribute('href')
    if (href == null || !EXTERNAL_LINK.test(href)) return
    link.removeAttribute('href')
    link.removeAttribute('target')
    link.setAttribute('data-offline-href', href)
    if (!link.title) link.title = LINK_TITLE
  }

  function neutralizeTree(root) {
    if (root.nodeType !== 1) return
    if (root.tagName === 'A' || root.tagName === 'AREA') neutralize(root)
    var links = root.querySelectorAll('a[href], area[href]')
    for (var i = 0; i < links.length; i++) neutralize(links[i])
  }

  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i]
      if (mutation.type === 'attributes') {
        neutralizeTree(mutation.target)
      } else {
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          neutralizeTree(mutation.addedNodes[j])
        }
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href']
  })

  // Links clicked before the observer ran (same task) or created detached.
  document.addEventListener(
    'click',
    function (event) {
      var target = event.target
      var link = target && target.closest ? target.closest('a, area') : null
      if (!link) return
      var href = link.getAttribute('href')
      if (href != null && EXTERNAL_LINK.test(href)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        record('link', href)
        neutralize(link)
      }
    },
    true
  )
})()
