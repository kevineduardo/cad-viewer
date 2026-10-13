// SPDX-License-Identifier: GPL-3.0-or-later
//
// Valores lançados «hostis»: qualquer operação sobre eles (ler propriedades,
// `instanceof`, `String(...)`, conversão primitiva) lança. Servem para provar que
// a camada de importação nunca deixa um erro do conversor escapar como excepção.

const boom = (what: string) => (): never => {
  throw new Error(`hostil: ${what}`)
}

/** Proxy em que TODAS as armadilhas lançam (inclui `getPrototypeOf` → `instanceof`). */
export function allTrapsProxy(): object {
  const handler: ProxyHandler<object> = {}
  for (const trap of [
    'get',
    'has',
    'getPrototypeOf',
    'getOwnPropertyDescriptor',
    'ownKeys',
    'isExtensible',
    'set',
    'defineProperty'
  ] as const) {
    ;(handler as Record<string, unknown>)[trap] = boom(trap)
  }
  return new Proxy({}, handler)
}

/** Só `instanceof` lança (`getPrototypeOf`); as leituras dão uma `message` válida. */
export function instanceofHostileProxy(message: string): object {
  return new Proxy(
    { message },
    {
      getPrototypeOf: boom('getPrototypeOf')
    }
  )
}

/** `message`/`code`/`name` lançam e `String(...)` também (toString + toPrimitive). */
export function getterAndStringHostile(): object {
  return {
    get message(): string {
      return boom('message')()
    },
    get code(): string {
      return boom('code')()
    },
    get name(): string {
      return boom('name')()
    },
    toString: boom('toString'),
    [Symbol.toPrimitive]: boom('toPrimitive')
  }
}

/** `Error` real cuja `message` lança, e cuja conversão em texto também. */
export function errorWithThrowingMessage(): Error {
  const error = new Error('x')
  Object.defineProperty(error, 'message', { get: boom('message') })
  Object.defineProperty(error, 'toString', { value: boom('toString') })
  return error
}

export const HOSTILE_ERRORS: [string, () => unknown][] = [
  ['proxy com todas as armadilhas a lançar', allTrapsProxy],
  [
    'proxy com instanceof hostil (getPrototypeOf)',
    () => instanceofHostileProxy('falha com <ruído>')
  ],
  ['getters + toString + toPrimitive a lançar', getterAndStringHostile],
  ['Error com message getter a lançar', errorWithThrowingMessage]
]

/** Mensagem real do `AcDbDatabaseConverterManager` quando falta o conversor DWG. */
export const NOT_REGISTERED_MESSAGE = [
  'Converter for file type dwg isn',
  't registered'
].join(String.fromCharCode(39)) // apóstrofo: evita o conflito prettier/eslint nas aspas
