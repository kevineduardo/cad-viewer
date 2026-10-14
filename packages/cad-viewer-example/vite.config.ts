import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { Alias, defineConfig, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import svgLoader from 'vite-svg-loader'
import { visualizer } from 'rollup-plugin-visualizer'
import vue from '@vitejs/plugin-vue'
import { examplePeerPackageAliases, exampleRollupOutput } from '../vite-config/pluginRollupOutput'
import { selfHostPlugin } from './scripts/self-host.mjs'
import {
  LIBREDWG_CONVERTER_PACKAGE,
  LIBREDWG_PARSER_WASM_FILE,
  LIBREDWG_PARSER_WORKER_FILE,
  MTEXT_RENDERER_WORKER_FILE
} from '../../tools/worker-assets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VIEWER_RUNTIME_SRC = '../cad-html-plugin/dist/viewer-runtime.iife.js'
const LOCAL_DATA_MODEL_LIB = resolve(
  __dirname,
  '../../../realdwg-web/packages/data-model/lib'
)
const LOCAL_DATA_MODEL_ENTRY = resolve(LOCAL_DATA_MODEL_LIB, 'index.js')
const LOCAL_UI_COMPONENTS_SRC = resolve(
  __dirname,
  '../../../ui-components/packages/ui-components/src'
)
const LOCAL_UI_COMPONENTS_ROOT = resolve(
  __dirname,
  '../../../ui-components'
)
const LOCAL_MTEXT_RENDERER_ROOT = resolve(
  __dirname,
  '../../../mtext-renderer/packages/mtext-renderer'
)
const LOCAL_MTEXT_RENDERER_DIST = resolve(LOCAL_MTEXT_RENDERER_ROOT, 'dist')
const LOCAL_MTEXT_RENDERER_ENTRY = resolve(LOCAL_MTEXT_RENDERER_DIST, 'index.js')
const LOCAL_MTEXT_RENDERER_WORKER = resolve(
  LOCAL_MTEXT_RENDERER_DIST,
  MTEXT_RENDERER_WORKER_FILE
)

/**
 * `vite preview` serves `dist/offline/index.html` for `/offline/`; redirect
 * `/offline` so the landing page's relative download links resolve there.
 */
function offlineTrailingSlashPlugin(): Plugin {
  return {
    name: 'cad-viewer-offline-trailing-slash',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, query] = (req.url ?? '').split('?', 2)
        if (pathname === '/offline') {
          res.statusCode = 301
          res.setHeader('Location', `/offline/${query ? `?${query}` : ''}`)
          res.end()
          return
        }
        next()
      })
    }
  }
}

function isEnvFlagEnabled(name: string): boolean {
  const flag = process.env[name]
  return flag === '1' || flag?.toLowerCase() === 'true'
}

function useLocalDataModel(mode: string): boolean {
  return (
    mode === 'local-data-model' ||
    isEnvFlagEnabled('CAD_VIEWER_USE_LOCAL_DATA_MODEL')
  )
}

function useLocalUiComponents(mode: string): boolean {
  return (
    mode === 'local-ui-components' ||
    isEnvFlagEnabled('CAD_VIEWER_USE_LOCAL_UI_COMPONENTS')
  )
}

function useLocalMtextRenderer(mode: string): boolean {
  return (
    mode === 'local-mtext-renderer' ||
    isEnvFlagEnabled('CAD_VIEWER_USE_LOCAL_MTEXT_RENDERER')
  )
}

export default defineConfig(({ command, mode }) => {
  const hasViewerRuntime = existsSync(resolve(__dirname, VIEWER_RUNTIME_SRC))
  if (!hasViewerRuntime) {
    console.warn(
      '[cad-viewer-example] viewer-runtime.iife.js not found — HTML export will be unavailable. ' +
        'Build @mlightcad/cad-html-plugin to enable it. Opening DXF/DWG does not require this file.'
    )
  }
  const aliases: Alias[] = []
  const devSourcePackages = [
    'cad-svg-plugin',
    'cad-pdf-plugin',
    'pdf-renderer',
    'three-renderer',
    'cad-simple-viewer',
    'cad-viewer'
  ]
  const linkLocalDataModel =
    command === 'serve' &&
    useLocalDataModel(mode) &&
    existsSync(LOCAL_DATA_MODEL_ENTRY)
  const linkLocalUiComponents =
    command === 'serve' &&
    useLocalUiComponents(mode) &&
    existsSync(LOCAL_UI_COMPONENTS_SRC)
  const linkLocalMtextRenderer =
    command === 'serve' &&
    useLocalMtextRenderer(mode) &&
    existsSync(LOCAL_MTEXT_RENDERER_ENTRY)
  if (command === 'serve') {
    aliases.push({
      find: /^@mlightcad\/cad-pdf-plugin\/register$/,
      replacement: resolve(__dirname, '../cad-pdf-plugin/src/register.ts')
    })
    aliases.push({
      find: /^@mlightcad\/(cad-svg-plugin|cad-pdf-plugin|pdf-renderer|three-renderer|cad-simple-viewer|cad-viewer)$/,
      replacement: resolve(__dirname, '../$1/src')
    })
    if (linkLocalMtextRenderer) {
      console.info(
        '[cad-viewer-example] Aliasing @mlightcad/mtext-renderer to local dist:',
        LOCAL_MTEXT_RENDERER_DIST
      )
      aliases.push({
        find: '@mlightcad/mtext-renderer',
        replacement: LOCAL_MTEXT_RENDERER_DIST
      })
    } else if (
      useLocalMtextRenderer(mode) &&
      !existsSync(LOCAL_MTEXT_RENDERER_ENTRY)
    ) {
      console.warn(
        '[cad-viewer-example] Local mtext-renderer alias requested but not found at:',
        LOCAL_MTEXT_RENDERER_ENTRY
      )
    }
    if (linkLocalDataModel) {
      aliases.push({
        find: '@mlightcad/data-model',
        replacement: LOCAL_DATA_MODEL_LIB
      })
    } else if (useLocalDataModel(mode) && !existsSync(LOCAL_DATA_MODEL_ENTRY)) {
      console.warn(
        '[cad-viewer-example] Local data-model alias requested but not found at:',
        LOCAL_DATA_MODEL_ENTRY
      )
    }
    if (linkLocalUiComponents) {
      console.info(
        '[cad-viewer-example] Aliasing @mlightcad/ui-components to local source:',
        LOCAL_UI_COMPONENTS_SRC
      )
      aliases.push({
        find: '@mlightcad/ui-components',
        replacement: LOCAL_UI_COMPONENTS_SRC
      })
    } else if (
      useLocalUiComponents(mode) &&
      !existsSync(LOCAL_UI_COMPONENTS_SRC)
    ) {
      console.warn(
        '[cad-viewer-example] Local ui-components alias requested but not found at:',
        LOCAL_UI_COMPONENTS_SRC
      )
    }
  }

  // `--mode offline` builds the single-file bundle (scripts/build-offline.mjs):
  // one JS chunk and every asset inlined so nothing is loaded from disk.
  const isOfflineBundle = mode === 'offline'
  if (isOfflineBundle) {
    // Plugins that only work online (AI assistant, cloud drives) are left out.
    const stub = resolve(__dirname, 'offline/stubs/unavailable-plugin.js')
    aliases.unshift(
      {
        find: /^@mlightcad\/cad-agent-plugin\/style\.css$/,
        replacement: resolve(__dirname, 'offline/stubs/empty.css')
      },
      {
        find: /^@mlightcad\/cad-(?:agent|onedrive|google-drive)-plugin(?:\/register)?$/,
        replacement: stub
      }
    )
  }

  aliases.push(
    ...examplePeerPackageAliases(__dirname).filter(
      alias =>
        !linkLocalMtextRenderer || alias.find !== '@mlightcad/mtext-renderer'
    )
  )

  const libredwgDist = `./node_modules/${LIBREDWG_CONVERTER_PACKAGE}/dist`
  const libredwgWasmSrc = resolve(
    __dirname,
    'node_modules',
    LIBREDWG_CONVERTER_PACKAGE,
    'dist',
    LIBREDWG_PARSER_WASM_FILE
  )
  const mtextWorkerSrc = linkLocalMtextRenderer
    ? LOCAL_MTEXT_RENDERER_WORKER
    : `./node_modules/@mlightcad/cad-simple-viewer/dist/${MTEXT_RENDERER_WORKER_FILE}`

  const plugins = [
    offlineTrailingSlashPlugin(),
    // Same-origin fonts/templates and the precaching service worker (online
    // build only; the offline bundle embeds them and never registers it).
    selfHostPlugin({ enabled: !isOfflineBundle }),
    vue(),
    svgLoader(),
    viteStaticCopy({
      targets: [
        {
          src: mtextWorkerSrc,
          dest: 'assets',
          rename: { stripBase: true }
        },
        {
          src: `${libredwgDist}/${LIBREDWG_PARSER_WORKER_FILE}`,
          dest: 'assets',
          rename: { stripBase: true }
        },
        ...(existsSync(libredwgWasmSrc)
          ? [
              {
                src: `${libredwgDist}/${LIBREDWG_PARSER_WASM_FILE}`,
                dest: 'assets',
                rename: { stripBase: true }
              }
            ]
          : []),
        ...(hasViewerRuntime
          ? [
              {
                src: VIEWER_RUNTIME_SRC,
                dest: 'assets',
                rename: { stripBase: true }
              }
            ]
          : [])
      ]
    })
  ]

  if (mode === 'analyze') {
    plugins.push(visualizer())
  }

  return {
    base: './',
    resolve: {
      alias: aliases
    },
    optimizeDeps: {
      force: command === 'serve',
      // Pre-bundle pdf-lib so the first lazy `cpdf` import does not trigger a
      // Vite optimizeDeps full-page reload in the example app.
      include:
        command === 'serve'
          ? [
              'pdf-lib',
              '@pdf-lib/standard-fonts',
              '@pdf-lib/upng',
              'pako'
            ]
          : [],
      exclude:
        command === 'serve'
          ? [
              ...devSourcePackages.map(name => `@mlightcad/${name}`),
              ...(linkLocalDataModel ? ['@mlightcad/data-model'] : []),
              ...(linkLocalUiComponents ? ['@mlightcad/ui-components'] : []),
              ...(linkLocalMtextRenderer ? ['@mlightcad/mtext-renderer'] : [])
            ]
          : []
    },
    server: {
      fs: {
        allow: [
          resolve(__dirname, '../..'),
          ...(linkLocalUiComponents ? [LOCAL_UI_COMPONENTS_ROOT] : []),
          ...(linkLocalMtextRenderer ? [LOCAL_MTEXT_RENDERER_ROOT] : [])
        ]
      }
    },
    build: {
      outDir: 'dist',
      // Preload the entry's static imports in parallel (flat waterfall) for
      // the first paint; the offline bundle is a single inlined chunk.
      modulePreload: isOfflineBundle ? false : { polyfill: false },
      minify: true,
      ...(isOfflineBundle
        ? { assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false }
        : {}),
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html')
        },
        output: isOfflineBundle
          ? { inlineDynamicImports: true }
          : exampleRollupOutput
      }
    },
    plugins: plugins
  }
})
