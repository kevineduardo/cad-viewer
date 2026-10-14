// SPDX-License-Identifier: GPL-3.0-or-later
//
// SHA de build mostrado no ecrã Acerca. O Metro substitui
// `process.env.EXPO_PUBLIC_BUILD_SHA` em tempo de bundle; sem valor, o ecrã
// diz «não definido» (nunca se inventa um SHA).

/** Aceita só um SHA hexadecimal (7–64); qualquer outra coisa é «não definido». */
export function parseBuildSha(raw: string | undefined): string | null {
  const v = raw?.trim().toLowerCase()
  return v && /^[0-9a-f]{7,64}$/.test(v) ? v : null
}

export function readBuildSha(): string | null {
  return parseBuildSha(process.env.EXPO_PUBLIC_BUILD_SHA)
}
