/*
 * Embedded file system for the single-file offline CAD viewer.
 *
 * Inlined as a classic <script> at the top of cad-viewer-offline.html by
 * scripts/build-offline.mjs. Browsers block fetch(), module scripts and web
 * workers loaded from file:// URLs, so every runtime resource (fonts, the
 * new-drawing template, worker scripts and wasm) is embedded in the page as
 * base64 <script type="application/x-cad-vfs"> blocks and served from here:
 *
 * - window.fetch answers URLs under VFS_ROOT, the cad-data CDN roots, or
 *   next to the page from the embedded data (missing files get a 404, never
 *   a network request).
 * - window.Worker starts embedded worker scripts as classic workers from
 *   blob: URLs. A prelude gives each worker a fetch() that asks the page for
 *   embedded files over a MessageChannel, and replaces import.meta.url
 *   (unusable in blob workers) with the worker's virtual URL. The prelude
 *   also refuses any other network access and reports blocked attempts and
 *   CSP violations to the page (see network-guard.js).
 * - window.pdfjsWorker lazily evaluates the embedded PDF.js worker code on
 *   the main thread for PDF import.
 */
;(function () {
  'use strict'

  var VFS_ROOT = 'https://offline.cad-viewer.invalid/'
  // Built-in defaults of the font loaders (used e.g. by MTEXT workers before
  // the app pushes its font URL); answered from the same embedded files.
  var CDN_ROOTS = [
    'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/',
    'https://cdn.jsdelivr.net/gh/mlightcad/cad-data/'
  ]
  var ROOTS = [VFS_ROOT].concat(CDN_ROOTS)
  // Classic-script build of PDF.js's pdf.worker.min.mjs (see build-offline).
  var PDFJS_WORKER_KEY = 'pdfjs/pdf.worker.js'
  var PAGE_DIR = new URL('./', window.location.href).href
  var entries = null
  var bytesCache = new Map()
  var workerUrlCache = new Map()

  window.__CAD_OFFLINE_VFS_ROOT__ = VFS_ROOT

  function index() {
    if (entries) return entries
    entries = new Map()
    var nodes = document.querySelectorAll(
      'script[type="application/x-cad-vfs"]'
    )
    for (var i = 0; i < nodes.length; i++) {
      entries.set(nodes[i].getAttribute('data-key'), nodes[i])
    }
    return entries
  }

  function decodeBase64(text) {
    if (typeof Uint8Array.fromBase64 === 'function') {
      return Uint8Array.fromBase64(text)
    }
    var binary = atob(text)
    var out = new Uint8Array(binary.length)
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }

  /** Returns `{ bytes, type }` for an embedded file, or null. */
  function read(key) {
    if (bytesCache.has(key)) return bytesCache.get(key)
    var node = index().get(key)
    if (!node) return null
    var file = {
      bytes: decodeBase64(node.textContent.replace(/\s+/g, '')),
      type: node.getAttribute('data-mime') || 'application/octet-stream'
    }
    bytesCache.set(key, file)
    // The decoded copy is cached; drop the base64 text to save memory.
    node.textContent = ''
    return file
  }

  /** Absolute URL (without query/hash) of a fetch/Worker input, or null. */
  function urlOf(input) {
    var raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input && typeof input.url === 'string'
            ? input.url
            : null
    if (raw == null) return null
    try {
      return new URL(raw, document.baseURI).href.split('#')[0].split('?')[0]
    } catch (e) {
      return null
    }
  }

  /** True for URLs that must never reach the network (virtual / CDN). */
  function isVirtual(input) {
    var url = urlOf(input)
    return (
      url != null &&
      ROOTS.some(function (root) {
        return url.indexOf(root) === 0
      })
    )
  }

  /** Maps a URL to its embedded file key, or null when not embedded. */
  function keyOf(input) {
    var url = urlOf(input)
    if (url == null) return null
    var rest = null
    var roots = ROOTS.concat([PAGE_DIR])
    for (var i = 0; i < roots.length && rest == null; i++) {
      if (url.indexOf(roots[i]) === 0) rest = url.slice(roots[i].length)
    }
    if (rest == null) return null
    try {
      rest = decodeURIComponent(rest)
    } catch (e) {
      return null
    }
    return index().has(rest) || bytesCache.has(rest) ? rest : null
  }

  function respond(key) {
    var file = read(key)
    return new Response(file.bytes.slice(), {
      status: 200,
      headers: { 'Content-Type': file.type }
    })
  }

  var nativeFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var key = keyOf(input)
    if (key) return Promise.resolve(respond(key))
    if (isVirtual(input)) {
      return Promise.resolve(new Response('Not found', { status: 404 }))
    }
    return nativeFetch(input, init)
  }

  // Runs inside each embedded worker before its own code.
  function workerPrelude(roots) {
    var port = null
    var queued = []
    var pending = new Map()
    var nextId = 0
    function send(message) {
      if (port) port.postMessage(message)
      else queued.push(message)
    }
    self.addEventListener('message', function (event) {
      var data = event.data
      if (!data || !data.__cadVfsPort) return
      event.stopImmediatePropagation()
      port = data.__cadVfsPort
      port.onmessage = function (reply) {
        var done = pending.get(reply.data.id)
        pending.delete(reply.data.id)
        if (done) done(reply.data)
      }
      queued.splice(0).forEach(function (message) {
        port.postMessage(message)
      })
    })
    // Workers inherit the page CSP; report violations to the page.
    self.addEventListener('securitypolicyviolation', function (event) {
      send({
        violation: {
          effectiveDirective: event.effectiveDirective,
          violatedDirective: event.violatedDirective,
          blockedURI: event.blockedURI,
          sample: event.sample
        }
      })
    })
    function resolve(input) {
      var raw =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input && input.url
      try {
        return new URL(raw, self.__CAD_VFS_SELF_URL__).href
      } catch (_error) {
        return String(raw)
      }
    }
    function isLocal(url) {
      return /^(?:data|blob|about):/i.test(url)
    }
    function networkError(kind, url) {
      send({ blocked: { kind: kind, url: url } })
      return new TypeError(
        'Network access is disabled in the offline version (' + url + ')'
      )
    }
    var nativeFetch = self.fetch.bind(self)
    self.fetch = function (input, init) {
      var url = resolve(input)
      var root = roots.filter(function (r) {
        return url.indexOf(r) === 0
      })[0]
      if (!root) {
        if (isLocal(url)) return nativeFetch(input, init)
        return Promise.reject(networkError('worker fetch', url))
      }
      var key = decodeURIComponent(url.slice(root.length).split(/[?#]/)[0])
      return new Promise(function (done) {
        var id = ++nextId
        pending.set(id, done)
        send({ id: id, key: key })
      }).then(function (reply) {
        return reply.buffer
          ? new Response(reply.buffer, {
              status: 200,
              headers: { 'Content-Type': reply.type }
            })
          : new Response('Not found', { status: 404 })
      })
    }
    if (typeof XMLHttpRequest === 'function') {
      var nativeXhrOpen = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function (method, url) {
        var resolved = resolve(url)
        if (!isLocal(resolved)) throw networkError('worker xhr', resolved)
        return nativeXhrOpen.apply(this, arguments)
      }
    }
    if (typeof self.importScripts === 'function') {
      var nativeImportScripts = self.importScripts
      self.importScripts = function () {
        for (var i = 0; i < arguments.length; i++) {
          var url = resolve(arguments[i])
          if (!isLocal(url)) throw networkError('importScripts', url)
        }
        return nativeImportScripts.apply(self, arguments)
      }
    }
    ;['WebSocket', 'EventSource'].forEach(function (name) {
      if (typeof self[name] !== 'function') return
      self[name] = function (url) {
        throw networkError('worker ' + name, resolve(url))
      }
    })
  }

  function workerBlobUrl(key) {
    if (workerUrlCache.has(key)) return workerUrlCache.get(key)
    var source = new TextDecoder().decode(read(key).bytes)
    var selfUrl = VFS_ROOT + key
    var code =
      "'use strict';self.__CAD_VFS_SELF_URL__=" +
      JSON.stringify(selfUrl) +
      ';(' +
      workerPrelude.toString() +
      ')(' +
      JSON.stringify(ROOTS) +
      ');\n' +
      source.split('import.meta.url').join('self.__CAD_VFS_SELF_URL__')
    var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    workerUrlCache.set(key, url)
    return url
  }

  var NativeWorker = window.Worker
  if (typeof NativeWorker === 'function') {
    var VfsWorker = function (scriptUrl, options) {
      var key = keyOf(scriptUrl)
      if (!key) return new NativeWorker(scriptUrl, options)
      // Chrome refuses module workers from blob: URLs on file:// pages (the
      // page origin is opaque), so embedded workers run as classic scripts.
      // The build checks that each one parses as a classic script.
      var classicOptions = {}
      for (var name in options || {}) {
        if (name !== 'type') classicOptions[name] = options[name]
      }
      var worker = new NativeWorker(workerBlobUrl(key), classicOptions)
      var channel = new MessageChannel()
      channel.port1.onmessage = function (event) {
        var data = event.data
        if (data.blocked) {
          var record = window.__CAD_OFFLINE_RECORD_BLOCKED__
          if (record) record(data.blocked.kind, data.blocked.url)
          return
        }
        if (data.violation) {
          var recordViolation = window.__CAD_OFFLINE_RECORD_VIOLATION__
          if (recordViolation) recordViolation('worker ' + key, data.violation)
          return
        }
        var file = read(data.key)
        var buffer = file ? file.bytes.slice().buffer : null
        channel.port1.postMessage(
          {
            id: data.id,
            type: file ? file.type : null,
            buffer: buffer
          },
          buffer ? [buffer] : []
        )
      }
      worker.postMessage({ __cadVfsPort: channel.port2 }, [channel.port2])
      return worker
    }
    VfsWorker.prototype = NativeWorker.prototype
    window.Worker = VfsWorker
  }

  // PDF.js runs its "worker" on the main thread when globalThis.pdfjsWorker
  // is set, so PDF import never has to start a module worker or import() a
  // script by URL (neither works on file:// pages under the offline CSP).
  // The embedded copy is a classic script, evaluated on first use.
  function definePdfjsWorker(value) {
    Object.defineProperty(window, 'pdfjsWorker', {
      value: value,
      writable: true,
      configurable: true,
      enumerable: true
    })
  }
  Object.defineProperty(window, 'pdfjsWorker', {
    configurable: true,
    enumerable: true,
    get: function () {
      var file = read(PDFJS_WORKER_KEY)
      definePdfjsWorker(undefined)
      if (file) {
        var script = document.createElement('script')
        script.textContent = new TextDecoder().decode(file.bytes)
        document.head.appendChild(script)
        script.remove()
        bytesCache.delete(PDFJS_WORKER_KEY)
      }
      return window.pdfjsWorker
    },
    set: definePdfjsWorker
  })
})()
