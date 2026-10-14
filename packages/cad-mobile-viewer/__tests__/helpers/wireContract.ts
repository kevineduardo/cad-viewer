// SPDX-License-Identifier: GPL-3.0-or-later
//
// Referência LOCAL do contrato de fio viewer → app (§5.2), usada só pelos
// testes. Substitui a antiga leitura/importação do contrato da app móvel
// (a app foi removida do main, 1f71cf8a): o pacote não depende de nenhum app.
//
// É um instantâneo FIXADO e independente do código em `src/`: os valores abaixo
// são literais escritos à mão (não derivados de `src`), por isso os testes de
// deriva continuam a falhar quando `src` se afasta do contrato. Se o contrato
// de fio mudar de forma deliberada, este ficheiro e `src` mudam no mesmo
// commit. O validador espelha a política fail-closed do original: campo a
// campo, nunca «corrige» nem ignora em silêncio.

export const WIRE_PROTOCOL_VERSION = 1

export type WireFormat = 'dwg' | 'dxf'

export const WIRE_OPEN_FAILED_CODES = [
  'unsupported-ext',
  'too-large',
  'read-failed',
  'parse',
  'dwg-unavailable',
  'oom',
  'timeout'
] as const

/** Tipos de entidade que produzem hits (`AcApFindHitKind`). */
export const WIRE_FIND_HIT_KINDS = [
  'text',
  'mtext',
  'attribute',
  'block',
  'dimension',
  'leader',
  'table'
] as const

export const WIRE_MAX_DOCUMENT_BYTES: Record<WireFormat, number> = {
  dxf: 20 * 1024 * 1024,
  dwg: 10 * 1024 * 1024
}
export const WIRE_MAX_BASE64_BYTES = 8 * 1024 * 1024

/** Extensão → formato; `.dwg` sem nome e sufixos a seguir à extensão não valem. */
export function wireDetectFormat(name: string): WireFormat | null {
  const m = /\.(dwg|dxf)$/i.exec(name)
  if (!m || m.index === 0) return null
  return m[1].toLowerCase() as WireFormat
}

export type WireParseResult =
  | { ok: true; type: string; payload: Record<string, unknown> }
  | { ok: false; code: string; type?: string }

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const isString = (x: unknown): x is string => typeof x === 'string'
const isInt = (x: unknown): x is number =>
  typeof x === 'number' && Number.isInteger(x)
const isNonNegInt = (x: unknown): x is number => isInt(x) && x >= 0
const oneOf = (list: readonly string[], x: unknown) =>
  typeof x === 'string' && list.includes(x)

const GUARDS: Record<string, (p: unknown) => boolean> = {
  opened: p =>
    isRecord(p) &&
    isString(p.name) &&
    p.name.length > 0 &&
    oneOf(['dwg', 'dxf'], p.format) &&
    isString(p.activeLayoutId) &&
    Array.isArray(p.layouts) &&
    p.layouts.every(
      l =>
        isRecord(l) &&
        isString(l.name) &&
        isString(l.btrId) &&
        isNonNegInt(l.tabOrder)
    ),
  openFailed: p =>
    isRecord(p) && oneOf(WIRE_OPEN_FAILED_CODES, p.code) && isString(p.message),
  findResult: p =>
    isRecord(p) &&
    isNonNegInt(p.findId) &&
    isNonNegInt(p.total) &&
    typeof p.truncated === 'boolean' &&
    isNonNegInt(p.layoutCount) &&
    Array.isArray(p.hits) &&
    p.hits.length === p.total &&
    p.hits.every(
      (h, i) =>
        isRecord(h) &&
        h.index === i &&
        isString(h.text) &&
        isString(h.excerpt) &&
        isString(h.layoutName) &&
        isString(h.layoutId) &&
        isString(h.layer) &&
        oneOf(WIRE_FIND_HIT_KINDS, h.kind) &&
        (h.tag === undefined || isString(h.tag)) &&
        (h.blockName === undefined || isString(h.blockName))
    )
}

/** Valida uma mensagem viewer → app (string JSON); nunca lança. */
export function wireParseViewerMessage(raw: unknown): WireParseResult {
  if (typeof raw !== 'string') return { ok: false, code: 'invalid-json' }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, code: 'invalid-json' }
  }
  if (
    !isRecord(data) ||
    typeof data.id !== 'string' ||
    typeof data.type !== 'string' ||
    typeof data.v !== 'number' ||
    !isRecord(data.payload) ||
    (data.replyTo !== undefined && typeof data.replyTo !== 'string')
  ) {
    return { ok: false, code: 'invalid-envelope' }
  }
  if (data.v !== WIRE_PROTOCOL_VERSION) {
    return { ok: false, code: 'unsupported-version' }
  }
  const guard = GUARDS[data.type]
  if (!guard) return { ok: false, code: 'unknown-type' }
  if (!guard(data.payload)) {
    return { ok: false, code: 'invalid-payload', type: data.type }
  }
  return { ok: true, type: data.type, payload: data.payload }
}
