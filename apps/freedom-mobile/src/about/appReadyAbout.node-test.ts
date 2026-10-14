// SPDX-License-Identifier: GPL-3.0-or-later
//
// Integração do fluxo VIVO `App → ViewerScreen → ready → Acerca`: o `App.tsx`
// de produção é renderizado com `react-test-renderer`; o servidor é o
// `LocalAssetServer` real (listener falso), a sessão/ponte/reducer são os de
// produção e o viewer sintético envia o `ready` pela `onMessage` da (falsa)
// WebView. Prova que o `viewerVersion` do `ready` chega ao Acerca pelo seam
// `onViewerVersion` — e não só em testes isolados do conteúdo — sem rede nem
// dependência do Acerca para o fluxo técnico. Ver `testing/registerAppHarness.ts`.
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createElement, type ReactElement } from 'react'
import TestRenderer, {
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'

import { SYNTHETIC_DOCUMENTS } from '../fixtures/syntheticDocuments.ts'
import { SyntheticViewer } from '../fixtures/syntheticViewer.ts'
import { VIEWER_VERSION_WAITING } from './aboutContent.ts'

await import('./testing/registerAppHarness.ts')
const { default: App } = (await import('../../App.tsx')) as {
  default: () => ReactElement
}
const webView = (await import('./testing/fakeWebView.ts')) as {
  mounted: {
    current: {
      source?: { uri?: string }
      onMessage?: (e: { nativeEvent: { data: string } }) => void
    } | null
  }
  injected: string[]
}

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
const { act, create } = TestRenderer

const textOf = (n: ReactTestInstance | string): string =>
  typeof n === 'string' ? n : n.children.map(textOf).join('')
const isHost = (n: ReactTestInstance, type: string) =>
  (n.type as unknown) === type
const byLabel = (r: ReactTestRenderer, label: string) =>
  r.root.findAll(
    n => isHost(n, 'Pressable') && n.props.accessibilityLabel === label
  )
const press = (n: ReactTestInstance) =>
  act(() => {
    ;(n.props.onPress as () => void)()
  })
const viewerVersionLine = (r: ReactTestRenderer) =>
  textOf(r.root.findByProps({ testID: 'about-viewer-version' }))

/** Deixa a sessão arrancar (`LocalAssetServer.start` é assíncrono). */
async function until(cond: () => boolean): Promise<void> {
  const end = Date.now() + 3000
  while (!cond()) {
    if (Date.now() > end) throw new Error('condição não cumprida')
    await act(async () => {
      await new Promise(res => setTimeout(res, 5))
    })
  }
}

let current: ReactTestRenderer | null = null
afterEach(() => {
  if (current) act(() => current!.unmount())
  current = null
  webView.mounted.current = null
})

async function mountApp(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer
  await act(async () => {
    r = create(createElement(App))
  })
  current = r
  // sessão viva: o servidor arrancou e a WebView recebeu a página com token
  await until(() => !!webView.mounted.current?.source?.uri)
  return r
}

/** O viewer sintético arranca e entrega o `ready` pela ponte real. */
function deliverReady(): string {
  const viewer = new SyntheticViewer({ documents: SYNTHETIC_DOCUMENTS })
  viewer.boot()
  const raws = viewer.drain()
  assert.equal(raws.length, 1)
  act(() => {
    webView.mounted.current!.onMessage!({ nativeEvent: { data: raws[0] } })
  })
  return (JSON.parse(raws[0]) as { payload: { viewerVersion: string } }).payload
    .viewerVersion
}

describe('App vivo: ready → Acerca (seam onViewerVersion)', () => {
  it('antes do ready o Acerca diz «a aguardar o viewer»', async () => {
    const r = await mountApp()
    press(byLabel(r, 'Acerca e licenças')[0])
    assert.ok(viewerVersionLine(r).includes(VIEWER_VERSION_WAITING))
  })

  it('o viewerVersion do ready chega ao Acerca aberto depois do ready', async () => {
    const r = await mountApp()
    const version = deliverReady()
    assert.equal(version, 'synthetic-1')
    press(byLabel(r, 'Acerca e licenças')[0])
    assert.equal(viewerVersionLine(r), `Versão do viewer: ${version}`)
  })

  it('o ready que chega com o Acerca já aberto actualiza-o (e o viewer não desmonta)', async () => {
    const r = await mountApp()
    press(byLabel(r, 'Acerca e licenças')[0])
    assert.ok(viewerVersionLine(r).includes(VIEWER_VERSION_WAITING))
    const page = webView.mounted.current!.source!.uri
    const version = deliverReady()
    assert.equal(viewerVersionLine(r), `Versão do viewer: ${version}`)
    // o fluxo técnico não depende do Acerca: mesma página/sessão, sem reload
    assert.equal(webView.mounted.current!.source!.uri, page)
  })

  it('fechar o Acerca mantém a sessão e a versão; reabrir mostra a mesma versão', async () => {
    const r = await mountApp()
    const version = deliverReady()
    press(byLabel(r, 'Acerca e licenças')[0])
    press(byLabel(r, 'Voltar ao visualizador')[0])
    assert.equal(byLabel(r, 'Acerca e licenças').length, 1)
    press(byLabel(r, 'Acerca e licenças')[0])
    assert.equal(viewerVersionLine(r), `Versão do viewer: ${version}`)
  })
})
