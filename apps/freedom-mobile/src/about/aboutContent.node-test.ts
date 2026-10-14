// SPDX-License-Identifier: GPL-3.0-or-later
//
// Conteúdo (§8.2), inventário gerado e navegação por análise da fonte do
// ecrã Acerca/Licenças. O comportamento renderizado está em
// `AboutLicenses.node-test.ts`; os píxeis em `docs/evidence/OBJ-0104-m5-l2/`.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  ABOUT_SECTIONS,
  aboutMetaRows,
  BUILD_SHA_UNSET,
  GPL_3_0_TEXT,
  NOT_LEGAL_ADVICE,
  SOURCE_URL_PENDING,
  splitParagraphs,
  THIRD_PARTY,
  VIEWER_VERSION_WAITING
} from './aboutContent.ts'
import { parseBuildSha } from './buildInfo.ts'

const here = (p: string) => new URL(p, import.meta.url)
const read = (p: string) => readFileSync(here(p), 'utf8')
const allText = JSON.stringify(ABOUT_SECTIONS)
const pkg = JSON.parse(read('../../package.json')) as {
  dependencies: Record<string, string>
}
const lock = JSON.parse(read('../../package-lock.json')) as {
  packages: Record<string, { version: string }>
}
const asset = JSON.parse(
  read('../../assets/licenses/third-party.json')
) as typeof THIRD_PARTY
const find = (name: string) => {
  const e = THIRD_PARTY.find(x => x.name === name)
  assert.ok(e, `entrada ${name}`)
  return e
}

describe('aboutContent (§8.2)', () => {
  it('tem as secções de §8.2 pela ordem', () => {
    assert.deepEqual(
      ABOUT_SECTIONS.map(s => s.id),
      ['about', 'license', 'source', 'third-party', 'marks', 'privacy']
    )
  })

  it('aboutMetaRows: versão da app, viewerVersion e SHA, com estados vazios explícitos', () => {
    assert.deepEqual(
      aboutMetaRows({
        appVersion: '1',
        viewerVersion: '2',
        buildSha: 'abcdef0'
      }).map(r => r.value),
      ['1', '2', 'abcdef0']
    )
    const empty = aboutMetaRows({
      appVersion: '1',
      viewerVersion: null,
      buildSha: null
    })
    assert.equal(empty[1].value, VIEWER_VERSION_WAITING)
    assert.equal(empty[2].value, BUILD_SHA_UNSET)
  })

  it('parseBuildSha só aceita SHA hexadecimal (nunca inventa)', () => {
    assert.equal(parseBuildSha('ABCDEF1234'), 'abcdef1234')
    assert.equal(parseBuildSha(undefined), null)
    assert.equal(parseBuildSha(''), null)
    assert.equal(parseBuildSha('not-a-sha'), null)
    assert.equal(parseBuildSha('abc'), null)
  })

  it('texto da licença da app e oferta de fonte com placeholder', () => {
    assert.match(allText, /GNU General Public License, versão 3 ou/)
    assert.match(allText, /SEM QUALQUER GARANTIA/)
    assert.match(allText, /GPL-3\.0-or-later/)
    assert.equal(SOURCE_URL_PENDING, 'SOURCE_URL_PENDING')
    assert.ok(
      allText.includes(
        'Oferta de código-fonte correspondente: SOURCE_URL_PENDING'
      )
    )
  })

  it('marcas e privacidade de §8.2', () => {
    assert.match(allText, /não é afiliada à Autodesk nem ao projecto mlightcad/)
    assert.match(allText, /Sem rede, sem contas, sem telemetria/)
  })

  it('não dá parecer jurídico nem bloqueia fluxos', () => {
    assert.match(NOT_LEGAL_ADVICE, /Não constitui aconselhamento jurídico/)
    assert.doesNotMatch(
      allText,
      /(conforme a lei|juridicamente|garantimos conformidade)/i
    )
  })

  it('splitParagraphs preserva todo o texto GPL', () => {
    const joined = splitParagraphs(GPL_3_0_TEXT).join('').replace(/\s+/g, '')
    assert.equal(joined === GPL_3_0_TEXT.replace(/\s+/g, ''), true)
  })
})

describe('inventário gerado (third-party.json, NOTICE, GPL-3.0.txt)', () => {
  it('GPL-3.0.txt local é o texto canónico completo e é o que o ecrã consome', () => {
    const text = read('../../assets/licenses/GPL-3.0.txt')
    assert.equal(
      createHash('sha256').update(text).digest('hex'),
      '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986'
    )
    assert.equal(GPL_3_0_TEXT, text)
    assert.match(text, /END OF TERMS AND CONDITIONS/)
    assert.match(text, /<https:\/\/www\.gnu\.org\/licenses\/>\./)
  })

  it('third-party.json (formato §8.2) é exactamente o que o módulo gerado exporta', () => {
    assert.deepEqual(asset, THIRD_PARTY)
    for (const e of asset) {
      for (const k of [
        'name',
        'version',
        'license',
        'copyright',
        'url',
        'text'
      ]) {
        assert.ok(k in e, `${e.name}: campo ${k}`)
      }
    }
  })

  it('inclui as dependências directas de execução da app, com versão do lockfile', () => {
    for (const name of Object.keys(pkg.dependencies)) {
      const e = find(name)
      assert.equal(
        e.version,
        lock.packages[`node_modules/${name}`].version,
        name
      )
      assert.equal(e.scope, 'app-runtime')
      assert.equal(e.license, 'MIT')
      assert.match(e.text, /Permission is hereby granted, free of charge/, name)
      assert.match(e.copyright ?? '', /^Copyright/, name)
      assert.equal(e.status, 'confirmed')
    }
  })

  it('inclui a família @mlightcad (MIT), three.js e o aviso Apache do emf-converter', () => {
    for (const n of [
      '@mlightcad/data-model',
      '@mlightcad/common',
      '@mlightcad/geometry-engine',
      '@mlightcad/graphic-interface',
      '@mlightcad/mtext-parser',
      '@mlightcad/mtext-renderer'
    ]) {
      assert.equal(find(n).license, 'MIT', n)
      assert.match(find(n).copyright ?? '', /mlightcad/, n)
      assert.match(find(n).text, /Permission is hereby granted/, n)
    }
    assert.match(find('three').copyright ?? '', /three\.js authors/)
    const emf = find('@mlightcad/emf-converter')
    assert.equal(emf.license, 'Apache-2.0')
    assert.match(emf.text, /Apache License/)
    assert.match(emf.text, /Copyright \(c\) ChristopherVR and contributors/)
  })

  it('LibreDWG: GPL-3.0 com texto completo, ligações ao projecto e à fonte, pendentes explícitos', () => {
    const l = THIRD_PARTY.find(e => e.name.startsWith('LibreDWG'))
    assert.ok(l)
    assert.match(l.license, /^GPL-3\.0/)
    assert.equal(l.text, GPL_3_0_TEXT)
    assert.equal(l.url, 'https://www.gnu.org/software/libredwg/')
    assert.equal(l.sourceUrl, 'https://github.com/LibreDWG/libredwg')
    assert.equal(l.wasmSourceUrl, 'https://github.com/mlightcad/libredwg-web')
    assert.equal(l.status, 'pending')
    assert.match(l.pending.join(' '), /only.*or-later/)
    assert.match(l.pending.join(' '), /copyright/)
    for (const n of [
      '@mlightcad/libredwg-web',
      '@mlightcad/libredwg-converter'
    ]) {
      assert.equal(find(n).license, 'GPL-3.0')
      assert.equal(find(n).text, GPL_3_0_TEXT)
      assert.equal(find(n).status, 'pending', n)
    }
    assert.match(
      find('@mlightcad/libredwg-converter').pending.join(' '),
      /LICENSE .* MIT/
    )
  })

  it('o que não está provado fica pendente: transitivos, fontes, MANIFEST, titular, EXT-1/EXT-2', () => {
    const trans = THIRD_PARTY.find(e =>
      e.name.startsWith('Restantes dependências')
    )
    assert.ok(trans)
    assert.equal(trans.status, 'pending')
    assert.equal(trans.text, '')
    assert.match(trans.pending.join(' '), /runtime vs build/)
    const fonts = THIRD_PARTY.find(e => e.name.startsWith('Fontes empacotadas'))
    assert.ok(fonts)
    assert.equal(fonts.status, 'pending')
    const sec = ABOUT_SECTIONS.map(s =>
      [s.paragraphs, s.notes ?? []].flat().join(' ')
    ).join(' ')
    assert.match(sec, /EXT-1/)
    assert.match(sec, /EXT-2/)
    assert.match(sec, /MANIFEST\.json/)
    assert.match(sec, /Titular do copyright da app por confirmar/)
    for (const e of THIRD_PARTY) {
      assert.equal(e.status === 'pending', e.pending.length > 0, e.name)
    }
  })

  it('NOTICE.txt é gerado do mesmo inventário', () => {
    const notice = read('../../assets/licenses/NOTICE.txt')
    assert.match(notice, /Corresponding source: SOURCE_URL_PENDING/)
    assert.match(notice, /PENDING: Titular do copyright/)
    for (const e of THIRD_PARTY) {
      assert.ok(
        notice.includes(`- ${e.name} ${e.version} - ${e.license}`),
        e.name
      )
      for (const p of e.pending)
        assert.ok(notice.includes(`PENDING: ${p}`), e.name)
    }
    assert.match(notice, /not affiliated with Autodesk or mlightcad/)
  })

  it('sem caminhos de máquina, e-mails nem infra interna', () => {
    const blob = [
      allText,
      read('../../assets/licenses/third-party.json'),
      read('../../assets/licenses/NOTICE.txt'),
      read('./AboutLicenses.tsx'),
      read('./aboutContent.ts')
    ].join('\n')
    assert.doesNotMatch(
      blob,
      /(\/home\/|\/mnt\/|C:\\|@aitra|kanban|equipa aitra@)/i
    )
    assert.doesNotMatch(blob, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
  })

  it('o gerador está em sincronia com as saídas versionadas (generate-licenses.mjs --check)', t => {
    if (
      !existsSync(here('../../node_modules/expo/package.json')) ||
      !existsSync(here('../../../../node_modules/.pnpm/three@0.172.0'))
    ) {
      t.skip(
        'node_modules da app/raiz ausentes: o gerador precisa dos LICENSE instalados'
      )
      return
    }
    execFileSync(
      process.execPath,
      [here('../../scripts/generate-licenses.mjs').pathname, '--check'],
      { stdio: 'pipe' }
    )
  })
})

describe('AboutLicenses (fonte)', () => {
  const src = read('./AboutLicenses.tsx')
  it('papéis de acessibilidade e alvos ≥44', () => {
    assert.match(src, /minWidth: 44/)
    assert.match(src, /minHeight: 44/)
    assert.match(src, /accessibilityRole="button"/)
    assert.match(src, /accessibilityRole="link"/)
    assert.match(src, /accessibilityRole="header"/)
    assert.match(src, /'Voltar ao visualizador'/)
  })
  it('não usa rede: só Linking por acção do utilizador', () => {
    assert.doesNotMatch(src, /(fetch\(|XMLHttpRequest|https?:\/\/|WebSocket)/)
    assert.equal((src.match(/Linking\./g) ?? []).length, 1)
  })
})

describe('App / ViewerScreen (navegação e seam do viewerVersion)', () => {
  const app = read('../../App.tsx')
  const viewer = read('../screens/ViewerScreen.tsx')
  it('mantém o viewer montado e tem entrada acessível ≥44', () => {
    assert.match(app, /<ViewerScreen onViewerVersion=\{setViewerVersion\} \/>/)
    assert.match(app, /accessibilityLabel="Acerca e licenças"/)
    assert.match(app, /minHeight: 44/)
    // o overlay é condicional, o viewer nunca é desmontado por abrir o Acerca
    assert.doesNotMatch(app, /aboutOpen \? .*<ViewerScreen/s)
  })
  it('passa versão da app (app.json), viewerVersion e SHA ao ecrã', () => {
    assert.match(app, /appVersion=\{appConfig\.expo\.version\}/)
    assert.match(app, /viewerVersion=\{viewerVersion\}/)
    assert.match(app, /buildSha=\{readBuildSha\(\)\}/)
  })
  it('o seam do ViewerScreen é só leitura do estado do ready', () => {
    assert.match(viewer, /onViewerVersion\?\.\(viewerVersion\)/)
    assert.match(viewer, /const \{ viewerVersion \} = session\.shell/)
    assert.doesNotMatch(viewer, /onViewerVersion[^\n]*dispatch/)
  })
})
