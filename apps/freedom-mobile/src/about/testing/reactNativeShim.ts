// SPDX-License-Identifier: GPL-3.0-or-later
//
// Substituto de `react-native` SÓ para testes em Node: os primitivos são
// elementos «host» (strings) que o `react-test-renderer` instancia, para o
// ecrã Acerca ser renderizado e accionado de verdade (hooks, estado, handlers)
// sem Metro nem dispositivo. Não prova píxeis: isso é a evidência de superfície.

type Style = Record<string, unknown> | false | null | undefined
type Handler = () => boolean | null | undefined

export const View = 'View'
export const Text = 'Text'
export const ScrollView = 'ScrollView'
export const Pressable = 'Pressable'

export const StyleSheet = {
  create: <T>(styles: T): T => styles,
  flatten: (style: Style | readonly Style[]): Record<string, unknown> =>
    Object.assign(
      {},
      ...(Array.isArray(style) ? style : [style]).filter(Boolean)
    )
}

const handlers = new Set<Handler>()

export const BackHandler = {
  addEventListener(_event: 'hardwareBackPress', handler: Handler) {
    handlers.add(handler)
    return { remove: () => void handlers.delete(handler) }
  }
}

/** Simula o botão físico «Voltar»: o último registado decide (como no Android). */
export function pressHardwareBack(): boolean {
  for (const h of [...handlers].reverse()) if (h()) return true
  return false
}

export function backHandlerCount(): number {
  return handlers.size
}

export const opened: string[] = []

export const Linking = {
  openURL(url: string): Promise<void> {
    opened.push(url)
    return Promise.resolve()
  }
}
