// SPDX-License-Identifier: GPL-3.0-or-later
//
// Conteúdo do ecrã Acerca/Licenças (arquitectura §8.2). Os créditos e o texto
// GPL-3.0 NÃO são escritos aqui: vêm de `licenseData.generated.ts`, gerado por
// `scripts/generate-licenses.mjs` a partir do inventário L1. Informativo: não
// é parecer jurídico e não condiciona nenhum fluxo técnico (D-1). O que o
// inventário não prova aparece como «pendente», nunca como afirmação.
import {
  APP_LICENSE_INFO,
  GPL_3_0_TEXT,
  PROJECT_PENDING,
  THIRD_PARTY,
  type ThirdPartyEntry
} from './licenseData.generated.ts'

export type { ThirdPartyEntry }
export { GPL_3_0_TEXT, THIRD_PARTY }

export interface AboutSection {
  readonly id: string
  readonly title: string
  readonly paragraphs: readonly string[]
  readonly items?: readonly ThirdPartyEntry[]
  readonly notes?: readonly string[]
}

export interface AboutMeta {
  readonly appVersion: string
  /** `viewerVersion` do `ready` (null até o viewer estar pronto). */
  readonly viewerVersion: string | null
  /** SHA de build (`EXPO_PUBLIC_BUILD_SHA`); null se não definido. */
  readonly buildSha: string | null
}

export interface AboutMetaRow {
  readonly id: 'app-version' | 'viewer-version' | 'build-sha'
  readonly label: string
  readonly value: string
}

export const SOURCE_URL_PENDING = APP_LICENSE_INFO.sourceUrl

export const ABOUT_TITLE = 'Acerca e licenças'
export const APP_NAME = 'Freedom DWG/CAD Viewer'

export const NOT_LEGAL_ADVICE =
  'Informação para transparência. Não constitui aconselhamento jurídico.'

export const VIEWER_VERSION_WAITING = 'a aguardar o viewer (ainda não pronto)'
export const BUILD_SHA_UNSET = 'não definido neste build'

export const GPL_BUTTON_LABEL = 'Ver texto completo da GPL-3.0'
export const GPL_VIEW_TITLE = 'GNU General Public License, versão 3'
export const PENDING_PREFIX = 'Pendente: '

/** Linhas «Acerca» (versão da app, `viewerVersion` do `ready`, SHA de build). */
export function aboutMetaRows(meta: AboutMeta): readonly AboutMetaRow[] {
  return [
    { id: 'app-version', label: 'Versão da app', value: meta.appVersion },
    {
      id: 'viewer-version',
      label: 'Versão do viewer',
      value: meta.viewerVersion ?? VIEWER_VERSION_WAITING
    },
    {
      id: 'build-sha',
      label: 'Build (SHA)',
      value: meta.buildSha ?? BUILD_SHA_UNSET
    }
  ]
}

/** Texto longo em parágrafos (separados por linha em branco) para o ecrã. */
export function splitParagraphs(text: string): readonly string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s+$/, ''))
    .filter(p => p.trim().length > 0)
}

export const ABOUT_SECTIONS: readonly AboutSection[] = [
  {
    id: 'about',
    title: 'Acerca',
    paragraphs: [
      `${APP_NAME} — visualizador offline de DWG/DXF; não envia ficheiros para nenhum serviço.`
    ]
  },
  {
    id: 'license',
    title: 'Licença desta app',
    paragraphs: [
      'Este programa é software livre: pode redistribuí-lo e/ou modificá-lo nos termos da GNU General Public License, versão 3 ou (à sua escolha) qualquer versão posterior, publicada pela Free Software Foundation.',
      `É distribuído SEM QUALQUER GARANTIA. Licença declarada: ${APP_LICENSE_INFO.license}. ${APP_LICENSE_INFO.copyright}.`
    ],
    notes: [APP_LICENSE_INFO.copyrightPending]
  },
  {
    id: 'source',
    title: 'Código-fonte',
    paragraphs: [
      `Oferta de código-fonte correspondente: ${SOURCE_URL_PENDING}.`
    ],
    notes: [APP_LICENSE_INFO.sourceUrlPending]
  },
  {
    id: 'third-party',
    title: 'Créditos e avisos de terceiros',
    paragraphs: [
      'Componentes de terceiros, gerados a partir do inventário de licenças do projecto. As entradas «Pendente» aguardam verificação e não são afirmações.'
    ],
    items: THIRD_PARTY,
    notes: PROJECT_PENDING
  },
  {
    id: 'marks',
    title: 'Marcas',
    paragraphs: [
      'DWG é um formato de ficheiro; esta app não é afiliada à Autodesk nem ao projecto mlightcad.'
    ]
  },
  {
    id: 'privacy',
    title: 'Privacidade',
    paragraphs: ['Sem rede, sem contas, sem telemetria.']
  }
]
