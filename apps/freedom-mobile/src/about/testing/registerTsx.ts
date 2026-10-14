// SPDX-License-Identifier: GPL-3.0-or-later
//
// Hooks de módulo só para testes: `.tsx` é transpilado com o `typescript` da
// app (o Node não retira JSX) e `react-native` resolve para o substituto de
// `reactNativeShim.ts`. Tem de ser importado ANTES (import dinâmico) dos
// módulos TSX, porque os hooks só valem para o que se carrega depois.
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const shimUrl = new URL('./reactNativeShim.ts', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') {
      return { url: shimUrl, format: 'module-typescript', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const source = ts.transpileModule(
      readFileSync(fileURLToPath(url), 'utf8'),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText
    return { format: 'module', source, shortCircuit: true }
  }
})
