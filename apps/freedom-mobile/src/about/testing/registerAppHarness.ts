// SPDX-License-Identifier: GPL-3.0-or-later
//
// Hooks de módulo para carregar o `App.tsx` REAL em Node (além do que faz
// `registerTsx.ts`): imports sem extensão (estilo Metro), `app.json` como
// módulo e substitutos só para o que exige o SO — WebView, safe-area,
// servidor nativo e adaptadores Expo. `ViewerScreen`, a sessão, o reducer e o
// ecrã Acerca são os de produção. Importar ANTES (import dinâmico) do `App`.
import './registerTsx.ts'

import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = (name: string) => new URL(`./${name}`, import.meta.url).href

const BARE: Record<string, string> = {
  'react-native-webview': here('fakeWebView.ts'),
  'react-native-safe-area-context': here('fakeSafeArea.ts')
}
const REPLACED: [suffix: string, fake: string][] = [
  ['/src/server/nativeServer.ts', here('fakeNativeServer.ts')],
  ['/src/files/expoFileAdapters.ts', here('fakeNativeServer.ts')]
]

registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare = BARE[specifier]
    if (bare) {
      return { url: bare, format: 'module-typescript', shortCircuit: true }
    }
    let resolved
    if (
      specifier.startsWith('.') &&
      !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)
    ) {
      for (const ext of ['.ts', '.tsx']) {
        try {
          resolved = nextResolve(specifier + ext, context)
          break
        } catch {
          // tenta a extensão seguinte
        }
      }
    }
    resolved ??= nextResolve(specifier, context)
    const fake = REPLACED.find(([suffix]) => resolved.url.endsWith(suffix))
    return fake
      ? { url: fake[1], format: 'module-typescript', shortCircuit: true }
      : resolved
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('/app.json')) return nextLoad(url, context)
    const json = readFileSync(fileURLToPath(url), 'utf8')
    return {
      format: 'module',
      source: `export default ${json}`,
      shortCircuit: true
    }
  }
})
