// SPDX-License-Identifier: GPL-3.0-or-later
//
// Deriva entre a camada de importação e o contrato de fio viewer → app (§5.2).
// O pacote não depende de nenhum app (a app foi removida do main): as
// constantes duplicadas e as formas dos payloads são comparadas aqui com a
// referência FIXADA em `helpers/wireContract.ts` (literais independentes de
// `src/`) e o seu validador fail-closed.

import { acapListFindLayouts } from '@mlightcad/cad-simple-viewer/find'

import { IMPORT_MESSAGES, toOpenFailedPayload } from '../src/import/errors'
import { detectImportFormat } from '../src/import/format'
import {
  importDocument,
  listLayouts,
  toOpenedPayload
} from '../src/import/importer'
import { MAX_BASE64_BYTES, MAX_DOCUMENT_BYTES } from '../src/import/limits'
import { IMPORT_ERROR_CODES } from '../src/import/types'
import { buildDxf, toBuffer } from './helpers/syntheticDxf'
import {
  WIRE_MAX_BASE64_BYTES,
  WIRE_MAX_DOCUMENT_BYTES,
  WIRE_OPEN_FAILED_CODES,
  wireDetectFormat,
  wireParseViewerMessage
} from './helpers/wireContract'

const envelope = (type: string, payload: unknown) =>
  JSON.stringify({ v: 1, id: 'w-1', type, replyTo: 'a-1', payload })

describe('constantes iguais às do contrato de fio', () => {
  test('códigos de openFailed', () => {
    expect([...IMPORT_ERROR_CODES]).toEqual([...WIRE_OPEN_FAILED_CODES])
  })

  test('limites de tamanho', () => {
    expect(MAX_DOCUMENT_BYTES).toEqual(WIRE_MAX_DOCUMENT_BYTES)
    expect(MAX_BASE64_BYTES).toBe(WIRE_MAX_BASE64_BYTES)
  })

  test.each([
    'a.dwg',
    'A.DWG',
    'a.dxf',
    'a.b.dxf',
    'a.pdf',
    'a',
    '.dwg',
    'a.dwg.txt',
    'a.dwg ',
    ''
  ])('detecção de formato por extensão coincide: %j', name => {
    expect(detectImportFormat(name)).toBe(wireDetectFormat(name))
  })
})

describe('payloads aceites pelo validador do contrato de fio', () => {
  test('opened gerado de um DXF real', async () => {
    const out = await importDocument(
      {
        name: 'synthetic.dxf',
        bytes: toBuffer(buildDxf({ texts: [{ text: 'Parede norte' }] }))
      },
      { dwg: 'ok' }
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const parsed = wireParseViewerMessage(
      envelope('opened', toOpenedPayload(out.document))
    )
    expect(parsed.ok).toBe(true)
  })

  test.each(IMPORT_ERROR_CODES)('openFailed «%s»', code => {
    const parsed = wireParseViewerMessage(
      envelope('openFailed', {
        code,
        message: IMPORT_MESSAGES[code]
      })
    )
    expect(parsed.ok).toBe(true)
  })

  test('toOpenFailedPayload de uma falha real é aceite', async () => {
    const out = await importDocument(
      { name: 'x.pdf', bytes: new ArrayBuffer(4) },
      { dwg: 'ok' }
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(
      wireParseViewerMessage(
        envelope('openFailed', toOpenFailedPayload(out.failure))
      ).ok
    ).toBe(true)
  })

  test('o validador do contrato rejeita um payload deformado (a prova não é vácua)', () => {
    expect(
      wireParseViewerMessage(
        envelope('openFailed', { code: 'nope', message: 'x' })
      ).ok
    ).toBe(false)
  })
})

describe('contrato de fio local: o validador é fail-closed', () => {
  const ok = { name: 'a.dxf', format: 'dxf', layouts: [], activeLayoutId: '' }

  test.each([
    ['não é string', 42, 'invalid-json'],
    ['JSON inválido', '{', 'invalid-json'],
    [
      'sem payload',
      JSON.stringify({ v: 1, id: 'x', type: 'opened' }),
      'invalid-envelope'
    ],
    [
      'versão desconhecida',
      JSON.stringify({ v: 2, id: 'x', type: 'opened', payload: ok }),
      'unsupported-version'
    ],
    [
      'tipo app → viewer vindo do viewer',
      JSON.stringify({ v: 1, id: 'x', type: 'open', payload: ok }),
      'unknown-type'
    ],
    [
      'formato desconhecido em opened',
      envelope('opened', { ...ok, format: 'pdf' }),
      'invalid-payload'
    ],
    [
      'tabOrder negativo em opened',
      envelope('opened', {
        ...ok,
        layouts: [{ name: 'M', btrId: 'B', tabOrder: -1 }]
      }),
      'invalid-payload'
    ],
    [
      'findResult com total ≠ hits.length',
      envelope('findResult', {
        findId: 1,
        total: 1,
        truncated: false,
        layoutCount: 0,
        hits: []
      }),
      'invalid-payload'
    ],
    [
      'findResult com hits.index fora de ordem',
      envelope('findResult', {
        findId: 1,
        total: 1,
        truncated: false,
        layoutCount: 1,
        hits: [
          {
            index: 3,
            text: 't',
            excerpt: 't',
            layoutName: 'M',
            layoutId: 'B',
            layer: '0',
            kind: 'text'
          }
        ]
      }),
      'invalid-payload'
    ]
  ])('rejeita: %s', (_n, raw, code) => {
    expect(wireParseViewerMessage(raw)).toMatchObject({ ok: false, code })
  })

  test('aceita um opened mínimo válido', () => {
    expect(wireParseViewerMessage(envelope('opened', ok))).toMatchObject({
      ok: true,
      type: 'opened'
    })
  })

  test('literais fixados do contrato (§4/§5.2)', () => {
    expect([...WIRE_OPEN_FAILED_CODES]).toEqual([
      'unsupported-ext',
      'too-large',
      'read-failed',
      'parse',
      'dwg-unavailable',
      'oom',
      'timeout'
    ])
    expect(WIRE_MAX_DOCUMENT_BYTES).toEqual({
      dxf: 20 * 1024 * 1024,
      dwg: 10 * 1024 * 1024
    })
    expect(WIRE_MAX_BASE64_BYTES).toBe(8 * 1024 * 1024)
  })
})

describe('layouts iguais a acapListFindLayouts', () => {
  test('mesma lista, ordem e campos sobre uma base real', async () => {
    const out = await importDocument(
      { name: 'l.dxf', bytes: toBuffer(buildDxf()) },
      { dwg: 'ok' }
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const db = out.document.database
    expect(listLayouts(db)).toEqual(acapListFindLayouts(db as never))
  })

  test('mesma regra de ordenação e filtro sobre uma base sintética', () => {
    const db = {
      objects: {
        layout: {
          newIterator: () => [
            { layoutName: 'Z', tabOrder: 1, blockTableRecordId: 'B3' },
            { layoutName: 'A', tabOrder: 1, blockTableRecordId: 'B2' },
            { layoutName: 'sem-btr', tabOrder: 0 },
            { layoutName: 'Model', tabOrder: 0, blockTableRecordId: 'B1' }
          ]
        }
      }
    }
    expect(listLayouts(db)).toEqual(acapListFindLayouts(db))
  })
})
