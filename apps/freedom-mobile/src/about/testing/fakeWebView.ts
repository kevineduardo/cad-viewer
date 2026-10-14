// SPDX-License-Identifier: GPL-3.0-or-later
//
// Substituto de `react-native-webview` SÓ para testes em Node: renderiza um
// host `WebView` e guarda as props da última instância montada, para o teste
// entregar ao `ViewerScreen` as mensagens do viewer (`onMessage`) e ler o que
// a app injecta (`injectJavaScript` via ref). Sem rede, sem página real.
import { createElement, forwardRef, useImperativeHandle } from 'react'

export interface FakeWebViewProps {
  source?: { uri?: string }
  onMessage?: (e: { nativeEvent: { data: string } }) => void
}

export const injected: string[] = []
export const mounted: { current: FakeWebViewProps | null } = { current: null }

export const WebView = forwardRef<unknown, FakeWebViewProps>(
  function FakeWebView(props, ref) {
    useImperativeHandle(ref, () => ({
      injectJavaScript: (script: string) => void injected.push(script)
    }))
    mounted.current = props
    return createElement('WebView', props)
  }
)
