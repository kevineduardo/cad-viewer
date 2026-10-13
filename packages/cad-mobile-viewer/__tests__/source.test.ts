// SPDX-License-Identifier: GPL-3.0-or-later
import { IMPORT_MESSAGES } from '../src/import/errors'
import { MAX_BASE64_BYTES } from '../src/import/limits'
import {
  decodeBase64,
  isLocalAssetUrl,
  readOpenSource
} from '../src/import/source'
import { HOSTILE_ERRORS, instanceofHostileProxy } from './helpers/hostileErrors'

const b64 = (s: string) => Buffer.from(s, 'latin1').toString('base64')

describe('isLocalAssetUrl', () => {
  test.each([
    'http://127.0.0.1:8080/f1a2b3c4',
    'http://localhost:5000/asset/abc-123',
    'http://[::1]:9000/x.dxf'
  ])('aceita %s', url => expect(isLocalAssetUrl(url)).toBe(true))

  test.each([
    'https://127.0.0.1:8080/x',
    'http://example.com/x.dwg',
    'http://127.0.0.1/x',
    'http://u:p@127.0.0.1:80/x',
    'http://127.0.0.1:80/x?a=1',
    'http://127.0.0.1:80/x#f',
    'http://127.0.0.1:80/../x',
    'http://127.0.0.1:80/a/./b',
    'http://127.0.0.1:80/a b',
    'http://127.0.0.1:80/',
    ' http://127.0.0.1:8080/f1',
    'http://127.0.0.1:8080/f1 ',
    'http://127.0.0.1:8080/f1\n',
    'http://127.0.0.1:80\t80/x',
    'file:///x.dwg',
    'content://x/y',
    'not a url',
    ''
  ])('rejeita %j', url => expect(isLocalAssetUrl(url)).toBe(false))
})

describe('decodeBase64 (estrito)', () => {
  test('round-trip de bytes arbitrários', () => {
    const raw = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i))
    const out = decodeBase64(b64(raw))
    expect(out).not.toBeNull()
    expect(Array.from(new Uint8Array(out as ArrayBuffer))).toEqual(
      Array.from({ length: 256 }, (_, i) => i)
    )
  })

  test.each(['abc', 'ab=c', 'a b c d', 'YWJj\n', 'YW-j', 'YWJjZA', '===='])(
    'rejeita %j',
    s => expect(decodeBase64(s)).toBeNull()
  )
})

describe('base64 grande (regressão: RangeError da regex em ~8 MiB)', () => {
  const full = Buffer.alloc(MAX_BASE64_BYTES, 7)

  test('decodeBase64 aceita exactamente o limite sem RangeError', () => {
    const out = decodeBase64(full.toString('base64'))
    expect(out).not.toBeNull()
    const view = new Uint8Array(out as ArrayBuffer)
    expect(view.byteLength).toBe(MAX_BASE64_BYTES)
    expect(view[0]).toBe(7)
    expect(view[view.length - 1]).toBe(7)
  })

  test.each([MAX_BASE64_BYTES, MAX_BASE64_BYTES - 1, MAX_BASE64_BYTES - 2])(
    'readOpenSource aceita %d bytes (limite e padding 0/1/2)',
    async size => {
      const raw = Buffer.from(
        Array.from({ length: 5 }, (_, i) => i + 1)
          .join('')
          .repeat(Math.ceil(size / 5))
      ).subarray(0, size)
      const r = await readOpenSource({
        kind: 'base64',
        data: raw.toString('base64')
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.bytes.byteLength).toBe(size)
        expect(Buffer.from(r.bytes).equals(raw)).toBe(true)
      }
    }
  )

  test('um byte acima do limite → too-large sem decodificar', async () => {
    const spy = jest.spyOn(globalThis, 'atob')
    const r = await readOpenSource({
      kind: 'base64',
      data: Buffer.alloc(MAX_BASE64_BYTES + 1, 7).toString('base64')
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.code).toBe('too-large')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('inválido grande (carácter ilegal no fim) → read-failed sem decodificar', async () => {
    // múltiplo de 3 bytes (sem padding) para ficar dentro do limite
    const size = Math.floor(MAX_BASE64_BYTES / 3) * 3
    const data = Buffer.alloc(size, 7).toString('base64').slice(0, -4) + 'AA!A'
    const spy = jest.spyOn(globalThis, 'atob')
    const r = await readOpenSource({ kind: 'base64', data })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.failure.code).toBe('read-failed')
      expect(r.failure.detail).toMatch(/inválido/)
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('padding no meio / comprimento não múltiplo de 4 → rejeitado', () => {
    expect(decodeBase64('YW=j')).toBeNull()
    expect(decodeBase64('YQ==YQ==')).toBeNull()
    expect(decodeBase64('YWJ')).toBeNull()
    expect(decodeBase64('A'.repeat(MAX_BASE64_BYTES) + '=')).toBeNull()
  })
})

describe('readOpenSource', () => {
  test('base64 válido → bytes', async () => {
    const r = await readOpenSource({
      kind: 'base64',
      data: b64('0\nSECTION\n')
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(new Uint8Array(r.bytes)).toHaveLength(10)
  })

  test('base64 vazio / inválido → read-failed', async () => {
    for (const data of ['', 'não é base64!']) {
      const r = await readOpenSource({ kind: 'base64', data })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.failure.code).toBe('read-failed')
        expect(r.failure.stage).toBe('source')
      }
    }
  })

  test('base64 acima de 8 MB → too-large ANTES de decodificar', async () => {
    const data = 'A'.repeat(Math.ceil(((MAX_BASE64_BYTES + 4) * 4) / 3 / 4) * 4)
    const spy = jest.spyOn(globalThis, 'atob')
    const r = await readOpenSource({ kind: 'base64', data })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.code).toBe('too-large')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('url loopback usa o porto injectado (e só ele)', async () => {
    const fetchBytes = jest.fn(async () => new ArrayBuffer(4))
    const r = await readOpenSource(
      { kind: 'url', url: 'http://127.0.0.1:8080/f123' },
      { fetchBytes }
    )
    expect(r.ok).toBe(true)
    expect(fetchBytes).toHaveBeenCalledWith('http://127.0.0.1:8080/f123')
  })

  test('url externo nunca chega ao porto (zero rede)', async () => {
    const fetchBytes = jest.fn(async () => new ArrayBuffer(4))
    const r = await readOpenSource(
      { kind: 'url', url: 'https://cdn.jsdelivr.net/gh/x.dwg' },
      { fetchBytes }
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.code).toBe('read-failed')
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  test('sem porto (I5 ainda não existe) → read-failed explícito', async () => {
    const r = await readOpenSource({
      kind: 'url',
      url: 'http://127.0.0.1:8080/f1'
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.code).toBe('read-failed')
  })

  test('excepção do porto → read-failed com detalhe redigido', async () => {
    const fetchBytes = async () => {
      throw new Error('falhou http://127.0.0.1:8080/f1 em /data/x')
    }
    const r = await readOpenSource(
      { kind: 'url', url: 'http://127.0.0.1:8080/f1' },
      { fetchBytes }
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.failure.code).toBe('read-failed')
      expect(r.failure.detail).not.toMatch(/127\.0\.0\.1|\/data/)
    }
  })

  test('fonte desconhecida → read-failed (nunca lança)', async () => {
    const r = await readOpenSource({ kind: 'ftp' } as never)
    expect(r.ok).toBe(false)
  })

  test.each(HOSTILE_ERRORS)(
    'erro hostil do porto (%s) → read-failed sem lançar (nem String(error))',
    async (_name, make) => {
      const fetchBytes = async (): Promise<ArrayBuffer> => {
        throw make()
      }
      const r = await readOpenSource(
        { kind: 'url', url: 'http://127.0.0.1:8080/f1' },
        { fetchBytes }
      )
      expect(r).toMatchObject({
        ok: false,
        failure: { code: 'read-failed', stage: 'source' }
      })
      if (!r.ok) {
        // o texto ao utilizador é o fixo do código
        expect(r.failure.message).toBe(IMPORT_MESSAGES['read-failed'])
        expect(typeof (r.failure.detail ?? '')).toBe('string')
      }
    }
  )

  test('erro hostil lançado de forma síncrona pelo porto também é contido', async () => {
    const fetchBytes = (): Promise<ArrayBuffer> => {
      throw instanceofHostileProxy('falhou /data/x')
    }
    const r = await readOpenSource(
      { kind: 'url', url: 'http://127.0.0.1:8080/f1' },
      { fetchBytes }
    )
    expect(r).toMatchObject({ ok: false, failure: { code: 'read-failed' } })
    // a `message` string do proxy ainda é aproveitada, já redigida
    if (!r.ok) expect(r.failure.detail).toBe('falhou <path>')
  })

  test('erro string e Error normais mantêm o detalhe (redigido)', async () => {
    for (const thrown of ['texto livre', new Error('texto livre')]) {
      const r = await readOpenSource(
        { kind: 'url', url: 'http://127.0.0.1:8080/f1' },
        {
          fetchBytes: async () => {
            throw thrown
          }
        }
      )
      expect(r).toMatchObject({
        ok: false,
        failure: { code: 'read-failed', detail: 'texto livre' }
      })
    }
  })
})
