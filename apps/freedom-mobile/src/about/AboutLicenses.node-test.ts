// SPDX-License-Identifier: GPL-3.0-or-later
//
// Comportamento REAL do ecrã Acerca/Licenças: a árvore React é renderizada com
// `react-test-renderer` sobre um substituto de `react-native` (ver
// `testing/reactNativeShim.ts`) e accionada por `onPress`/botão «Voltar».
// Não prova píxeis (isso é `docs/evidence/OBJ-0104-m5-l2/`).
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createElement, type ReactElement } from 'react'
import TestRenderer, {
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'

import {
  BUILD_SHA_UNSET,
  GPL_3_0_TEXT,
  GPL_BUTTON_LABEL,
  NOT_LEGAL_ADVICE,
  SOURCE_URL_PENDING,
  THIRD_PARTY,
  VIEWER_VERSION_WAITING
} from './aboutContent.ts'
import type { AboutLicensesProps } from './AboutLicenses.tsx'

await import('./testing/registerTsx.ts')
const { AboutLicenses } = (await import('./AboutLicenses.tsx')) as {
  AboutLicenses: (p: AboutLicensesProps) => ReactElement
}
const shim = (await import('./testing/reactNativeShim.ts')) as {
  StyleSheet: { flatten: (s: unknown) => Record<string, number | undefined> }
  pressHardwareBack: () => boolean
  backHandlerCount: () => number
}

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
const { act, create } = TestRenderer

const base: AboutLicensesProps = {
  onClose: () => undefined,
  appVersion: '0.0.0',
  viewerVersion: null,
  buildSha: null,
  onOpenLink: () => undefined
}

const mounted: ReactTestRenderer[] = []
const el = (p: AboutLicensesProps) => createElement(AboutLicenses, p)
function render(props: Partial<AboutLicensesProps> = {}) {
  let r!: ReactTestRenderer
  act(() => {
    r = create(el({ ...base, ...props }))
  })
  mounted.push(r)
  return {
    r,
    update: (p: Partial<AboutLicensesProps>) =>
      act(() => r.update(el({ ...base, ...props, ...p })))
  }
}

afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount())
})

/** Sem espaços: os parágrafos são nós Text separados, o ficheiro tem linhas em branco. */
const norm = (s: string) => s.replace(/\s+/g, '')
const textOf = (n: ReactTestInstance | string): string =>
  typeof n === 'string' ? n : n.children.map(textOf).join('')
const allText = (r: ReactTestRenderer) => textOf(r.root)
const byTestId = (r: ReactTestRenderer, id: string) =>
  r.root.findByProps({ testID: id })
const pressables = (r: ReactTestRenderer) =>
  r.root.findAll(n => isHost(n, 'Pressable'))
const press = (n: ReactTestInstance) =>
  act(() => {
    ;(n.props.onPress as () => void)()
  })
/** `type` é `ElementType` no tipo; no shim os primitivos são strings host. */
const isHost = (n: ReactTestInstance, type: string) =>
  (n.type as unknown) === type
const hardwareBack = () => {
  let handled = false
  act(() => {
    handled = shim.pressHardwareBack()
  })
  return handled
}
const pressByLabel = (r: ReactTestRenderer, label: string) =>
  press(
    r.root.findAll(
      n => isHost(n, 'Pressable') && n.props.accessibilityLabel === label
    )[0]
  )

describe('metadados «Acerca» (§8.2 item 1)', () => {
  it('mostra versão da app, viewerVersion e SHA de build', () => {
    const { r } = render({
      appVersion: '1.2.3',
      viewerVersion: '1.15.7',
      buildSha: 'abc1234def'
    })
    assert.equal(
      textOf(byTestId(r, 'about-app-version')),
      'Versão da app: 1.2.3'
    )
    assert.equal(
      textOf(byTestId(r, 'about-viewer-version')),
      'Versão do viewer: 1.15.7'
    )
    assert.equal(
      textOf(byTestId(r, 'about-build-sha')),
      'Build (SHA): abc1234def'
    )
  })

  it('antes do ready diz «a aguardar» e sem SHA diz «não definido» (nunca inventa)', () => {
    const { r } = render()
    assert.match(
      textOf(byTestId(r, 'about-viewer-version')),
      new RegExp(VIEWER_VERSION_WAITING.replace(/[()]/g, '\\$&'))
    )
    assert.ok(textOf(byTestId(r, 'about-build-sha')).includes(BUILD_SHA_UNSET))
  })

  it('o viewerVersion que chega depois (ready) actualiza o ecrã aberto', () => {
    const { r, update } = render()
    assert.ok(allText(r).includes(VIEWER_VERSION_WAITING))
    update({ viewerVersion: '9.9.9' })
    assert.equal(
      textOf(byTestId(r, 'about-viewer-version')),
      'Versão do viewer: 9.9.9'
    )
    assert.ok(!allText(r).includes(VIEWER_VERSION_WAITING))
  })

  it('declara offline, sem envio de ficheiros, e que não é aconselhamento jurídico', () => {
    const { r } = render()
    const t = allText(r)
    assert.match(t, /visualizador offline de DWG\/DXF; não envia ficheiros/)
    assert.ok(t.includes(NOT_LEGAL_ADVICE))
    assert.match(t, /Sem rede, sem contas, sem telemetria/)
  })
})

describe('GPL-3.0 local (§8.2 item 2)', () => {
  it('tem o botão acessível «Ver texto completo da GPL-3.0»', () => {
    const { r } = render()
    const btn = byTestId(r, 'about-gpl-button')
    assert.equal(btn.props.accessibilityRole, 'button')
    assert.equal(btn.props.accessibilityLabel, 'Ver texto completo da GPL-3.0')
    assert.equal(GPL_BUTTON_LABEL, 'Ver texto completo da GPL-3.0')
    assert.ok(textOf(btn).includes(GPL_BUTTON_LABEL))
  })

  it('abre o texto completo (offline) e o Voltar regressa ao Acerca sem fechar', () => {
    let closed = 0
    const { r } = render({ onClose: () => void (closed += 1) })
    press(byTestId(r, 'about-gpl-button'))
    const t = textOf(byTestId(r, 'about-text'))
    assert.ok(t.includes('GNU GENERAL PUBLIC LICENSE'))
    assert.ok(t.includes('Version 3, 29 June 2007'))
    assert.ok(t.includes('END OF TERMS AND CONDITIONS'))
    assert.ok(t.includes('How to Apply These Terms to Your New Programs'))
    // texto completo: todos os parágrafos do ficheiro, sem perdas
    assert.ok(norm(t) === norm(GPL_3_0_TEXT), 'texto GPL completo e sem perdas')
    assert.equal(
      byTestId(r, 'about-back').props.accessibilityLabel,
      'Voltar ao Acerca e licenças'
    )
    press(byTestId(r, 'about-back'))
    assert.equal(closed, 0)
    assert.ok(byTestId(r, 'about-main'))
    assert.throws(() => byTestId(r, 'about-text'))
    assert.equal(
      byTestId(r, 'about-back').props.accessibilityLabel,
      'Voltar ao visualizador'
    )
    press(byTestId(r, 'about-back'))
    assert.equal(closed, 1)
  })

  it('o botão físico «Voltar» fecha primeiro a vista GPL e só depois o ecrã', () => {
    let closed = 0
    const { r } = render({ onClose: () => void (closed += 1) })
    assert.equal(shim.backHandlerCount(), 1)
    press(byTestId(r, 'about-gpl-button'))
    assert.equal(hardwareBack(), true)
    assert.equal(closed, 0)
    assert.ok(byTestId(r, 'about-main'))
    assert.equal(hardwareBack(), true)
    assert.equal(closed, 1)
  })

  it('desmontar remove o handler do botão «Voltar» (sem fugas)', () => {
    const { r } = render()
    assert.equal(shim.backHandlerCount(), 1)
    act(() => r.unmount())
    assert.equal(shim.backHandlerCount(), 0)
  })
})

describe('créditos gerados do inventário (§8.2 item 4)', () => {
  it('mostra uma entrada por componente, com versão, licença e copyright', () => {
    const { r } = render()
    for (const e of THIRD_PARTY) {
      const entry = byTestId(r, `about-entry-${e.name}`)
      const t = textOf(entry)
      assert.ok(t.includes(e.name) && t.includes(e.version), e.name)
      assert.ok(t.includes(`Licença: ${e.license}`), e.name)
      if (e.copyright) assert.ok(t.includes(e.copyright), e.name)
    }
  })

  it('cada componente com texto abre o texto completo da sua licença', () => {
    const { r } = render()
    const withText = THIRD_PARTY.filter(e => e.text)
    assert.ok(withText.length >= 15)
    for (const e of withText) {
      pressByLabel(r, `Ver texto da licença de ${e.name}`)
      const shown = textOf(byTestId(r, 'about-text'))
      assert.ok(norm(shown) === norm(e.text), e.name)
      press(byTestId(r, 'about-back'))
    }
  })

  it('MIT tem o texto MIT; GPL tem o texto GPL; Apache preserva o NOTICE', () => {
    const { r } = render()
    pressByLabel(r, 'Ver texto da licença de react')
    assert.match(
      textOf(byTestId(r, 'about-text')),
      /Permission is hereby granted, free of charge/
    )
    press(byTestId(r, 'about-back'))
    pressByLabel(r, 'Ver texto da licença de @mlightcad/libredwg-web')
    assert.match(
      textOf(byTestId(r, 'about-text')),
      /GNU GENERAL PUBLIC LICENSE/
    )
    press(byTestId(r, 'about-back'))
    pressByLabel(r, 'Ver texto da licença de @mlightcad/emf-converter')
    const t = textOf(byTestId(r, 'about-text'))
    assert.match(t, /Apache License/)
    assert.match(t, /Notices for @mlightcad\/emf-converter/)
  })

  it('LibreDWG: GPL-3.0, ligação ao projecto e à fonte, abertas só ao tocar', () => {
    const opened: string[] = []
    const { r } = render({ onOpenLink: u => void opened.push(u) })
    const entry = byTestId(
      r,
      'about-entry-LibreDWG (biblioteca C compilada para wasm em @mlightcad/libredwg-web)'
    )
    const t = textOf(entry)
    assert.match(t, /GPL-3\.0/)
    assert.ok(t.includes('https://www.gnu.org/software/libredwg/'))
    assert.ok(t.includes('https://github.com/LibreDWG/libredwg'))
    assert.ok(t.includes('https://github.com/mlightcad/libredwg-web'))
    assert.deepEqual(opened, [], 'nenhum pedido sem acção do utilizador')
    const links = entry.findAll(
      n => isHost(n, 'Pressable') && n.props.accessibilityRole === 'link'
    )
    assert.equal(links.length, 3)
    press(links[0])
    press(links[1])
    assert.deepEqual(opened, [
      'https://www.gnu.org/software/libredwg/',
      'https://github.com/LibreDWG/libredwg'
    ])
  })

  it('família mlightcad, three.js e React Native/Expo/webview estão creditados', () => {
    const { r } = render()
    const t = allText(r)
    for (const s of [
      '@mlightcad/data-model',
      '@mlightcad/mtext-renderer',
      'three 0.172.0',
      'react-native-webview',
      'expo-crypto',
      'react-native-tcp-socket',
      'react-native-safe-area-context'
    ]) {
      assert.ok(t.includes(s), s)
    }
    assert.match(t, /Copyright \(c\) 2026 mlightcad/)
  })
})

describe('pendentes explícitos, sem fabricar (§8.2 itens 3 e 4)', () => {
  it('mostra SOURCE_URL_PENDING e o motivo (EXT-1)', () => {
    const { r } = render()
    const t = allText(r)
    assert.ok(
      t.includes(
        `Oferta de código-fonte correspondente: ${SOURCE_URL_PENDING}.`
      )
    )
    assert.match(
      t,
      /Pendente: URL público do código-fonte por definir \(EXT-1\)/
    )
  })

  it('mostra o titular por confirmar, as variantes GPL e os transitivos/fontes por apurar', () => {
    const { r } = render()
    const t = allText(r)
    assert.match(t, /Pendente: Titular do copyright da app por confirmar/)
    assert.match(t, /Pendente: .*GPL-3\.0-only.*GPL-3\.0-or-later/)
    assert.match(t, /Pendente: Separação runtime vs build por concluir/)
    assert.match(
      t,
      /Pendente: À data deste inventário o bundle .* não inclui ficheiros de fonte/
    )
    assert.match(t, /Pendente: viewer-bundle\/MANIFEST\.json/)
    assert.match(t, /EXT-2/)
  })

  it('toda a entrada `pending` mostra cada motivo como «Pendente: …»', () => {
    const { r } = render()
    for (const e of THIRD_PARTY.filter(x => x.status === 'pending')) {
      const t = textOf(byTestId(r, `about-entry-${e.name}`))
      assert.ok(e.pending.length > 0, e.name)
      for (const p of e.pending) assert.ok(t.includes(`Pendente: ${p}`), e.name)
    }
  })
})

describe('acessibilidade e alvos tácteis', () => {
  const flat = (n: ReactTestInstance) => shim.StyleSheet.flatten(n.props.style)

  it('todos os controlos (Acerca e vista de texto) têm papel, etiqueta e ≥44 px', () => {
    const { r } = render()
    const check = () => {
      const ps = pressables(r)
      assert.ok(ps.length > 0)
      for (const p of ps) {
        assert.ok(
          ['button', 'link'].includes(p.props.accessibilityRole),
          textOf(p)
        )
        assert.ok(
          String(p.props.accessibilityLabel ?? '').length > 0,
          textOf(p)
        )
        const s = flat(p)
        assert.ok(
          (s.minHeight ?? 0) >= 44,
          `${p.props.accessibilityLabel} minHeight`
        )
        assert.ok(
          (s.minWidth ?? 0) >= 44,
          `${p.props.accessibilityLabel} minWidth`
        )
      }
    }
    check()
    assert.ok(
      pressables(r).length > 20,
      'um botão por componente + ligações + GPL + Voltar'
    )
    press(byTestId(r, 'about-gpl-button'))
    check()
  })

  it('é um modal acessível com cabeçalhos e o ecrã de texto tem título próprio', () => {
    const { r } = render()
    assert.equal(byTestId(r, 'about-root').props.accessibilityViewIsModal, true)
    const headers = r.root.findAll(
      n => isHost(n, 'Text') && n.props.accessibilityRole === 'header'
    )
    assert.ok(headers.length >= 7)
    press(byTestId(r, 'about-gpl-button'))
    const titles = r.root.findAll(
      n => isHost(n, 'Text') && n.props.accessibilityRole === 'header'
    )
    assert.equal(titles.length, 1)
    assert.match(textOf(titles[0]), /GNU General Public License, versão 3/)
  })

  it('abrir o ecrã não pede rede nem abre ligações sozinho', () => {
    const opened: string[] = []
    render({ onOpenLink: u => void opened.push(u) })
    assert.deepEqual(opened, [])
  })
})
