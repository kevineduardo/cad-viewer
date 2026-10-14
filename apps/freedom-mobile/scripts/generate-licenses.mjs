// SPDX-License-Identifier: GPL-3.0-or-later
//
// Gera o inventário de licenças consumido pelo ecrã Acerca/Licenças
// (docs/OBJ-0104-architecture.md §8.2). Nada é escrito à mão nas saídas:
//
//   assets/licenses/third-party.json   [{name, version, license, copyright, url, text, ...}]
//   assets/licenses/NOTICE.txt         proposta de NOTICE (L1 §4) derivada do JSON
//   src/about/licenseData.generated.ts módulo que o React Native importa (sem fs em runtime)
//
// Entradas: package.json + package-lock.json da app, LICENSE/package.json
// instalados (app e store pnpm do viewer), LICENSE da raiz, GPL-3.0.txt e a
// entrada curada `scripts/third-party-inventory.json` (espelho de
// docs/OBJ-0104-licenses.md). O que não está provado fica `status: "pending"`.
//
// Uso (a partir de apps/freedom-mobile):
//   node scripts/generate-licenses.mjs           escreve as saídas
//   node scripts/generate-licenses.mjs --check   falha se as saídas divergirem
// Não é parecer jurídico.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = join(appDir, '..', '..')
const outJson = join(appDir, 'assets/licenses/third-party.json')
const outNotice = join(appDir, 'assets/licenses/NOTICE.txt')
const outTs = join(appDir, 'src/about/licenseData.generated.ts')

const readText = p => readFileSync(p, 'utf8')
const readJson = p => JSON.parse(readText(p))
const withNewline = s => (s.endsWith('\n') ? s : `${s}\n`)

function licenseFile(dir, names = ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
  for (const n of names) {
    const p = join(dir, n)
    if (existsSync(p)) return withNewline(readText(p).trimEnd())
  }
  return null
}

/** Primeira linha «Copyright …» do texto (a que o próprio pacote declara). */
function copyrightLine(text) {
  const m = text?.match(/^\s*(Copyright\b.*)$/im)
  return m ? m[1].trim() : null
}

/** `git+https://x/y.git` → `https://x/y`. */
function cleanUrl(u) {
  if (!u) return null
  const s = typeof u === 'string' ? u : u.url
  return s
    ? s
        .replace(/^git\+/, '')
        .replace(/\.git$/, '')
        .replace(/^git:\/\//, 'https://')
    : null
}

function pkgUrls(pkg) {
  const home = pkg.homepage ? pkg.homepage.replace(/#readme$/, '') : null
  const repo = cleanUrl(pkg.repository)
  return { url: home ?? repo, sourceUrl: repo }
}

/** Pacote instalado no store pnpm da raiz: `<name>@<version>…/node_modules/<name>`. */
function storePackageDir(name, version) {
  const store = join(repoDir, 'node_modules/.pnpm')
  const prefix = `${name.replace('/', '+')}@${version}`
  const hit = readdirSync(store)
    .filter(d => d === prefix || d.startsWith(`${prefix}_`))
    .sort()
    .map(d => join(store, d, 'node_modules', name))
    .find(d => existsSync(join(d, 'package.json')))
  if (!hit) {
    throw new Error(
      `${name}@${version} não está instalado no store pnpm (pnpm install na raiz)`
    )
  }
  return hit
}

/** Pacotes do lockfile alcançáveis a partir das dependências de execução da app. */
function runtimeClosure(lock, rootDeps) {
  const pkgs = lock.packages
  const resolve = (from, dep) => {
    let base = from
    for (;;) {
      const key = `${base ? `${base}/` : ''}node_modules/${dep}`
      if (pkgs[key]) return key
      if (!base) return null
      const i = base.lastIndexOf('/node_modules/')
      base = i === -1 ? '' : base.slice(0, i)
    }
  }
  const seen = new Set()
  const queue = rootDeps.map(d => resolve('', d)).filter(Boolean)
  while (queue.length) {
    const key = queue.pop()
    if (seen.has(key)) continue
    seen.add(key)
    const p = pkgs[key]
    for (const dep of [
      ...Object.keys(p.dependencies ?? {}),
      ...Object.keys(p.optionalDependencies ?? {}),
      ...Object.keys(p.peerDependencies ?? {})
    ]) {
      const next = resolve(key, dep)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return [...seen].sort().map(k => pkgs[k])
}

function sortedDistribution(packages) {
  const counts = new Map()
  for (const v of packages) {
    const lic =
      typeof v.license === 'string'
        ? v.license
        : v.license?.type
          ? v.license.type
          : '(sem campo license)'
    counts.set(lic, (counts.get(lic) ?? 0) + 1)
  }
  const parts = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )
  return {
    total: packages.length,
    text: parts.map(([l, n]) => `${l} ${n}`).join(', ')
  }
}

export function collect() {
  const inv = readJson(join(appDir, 'scripts/third-party-inventory.json'))
  const appPkg = readJson(join(appDir, 'package.json'))
  const lock = readJson(join(appDir, 'package-lock.json'))
  const pnpmLock = readText(join(repoDir, 'pnpm-lock.yaml'))
  const rootLicense = withNewline(readText(join(repoDir, 'LICENSE')).trimEnd())

  const gplText = readText(join(appDir, inv.gpl.file))
  const gplSha = createHash('sha256').update(gplText).digest('hex')
  if (gplSha !== inv.gpl.sha256) {
    throw new Error(
      `GPL-3.0.txt não corresponde ao texto canónico (sha256 ${gplSha})`
    )
  }

  const entries = []

  // 1. Dependências directas de execução da app (versão do lock, texto instalado).
  for (const name of Object.keys(appPkg.dependencies).sort()) {
    const dir = join(appDir, 'node_modules', name)
    const pkg = readJson(join(dir, 'package.json'))
    const lockVersion = lock.packages[`node_modules/${name}`]?.version
    if (lockVersion !== pkg.version) {
      throw new Error(
        `${name}: lock (${lockVersion}) ≠ instalado (${pkg.version})`
      )
    }
    const text = licenseFile(dir)
    if (!text) throw new Error(`${name}: sem ficheiro LICENSE instalado`)
    entries.push({
      name,
      version: pkg.version,
      license: pkg.license,
      copyright: copyrightLine(text),
      url: pkgUrls(pkg).url,
      sourceUrl: null,
      text,
      scope: 'app-runtime',
      status: 'confirmed',
      pending: []
    })
  }

  // 2. Bundle do viewer (store pnpm; versões confirmadas no pnpm-lock.yaml).
  for (const spec of inv.viewerPackages) {
    if (
      !pnpmLock.includes(`${spec.name}@${spec.version}`) &&
      !pnpmLock.includes(`'${spec.name}@${spec.version}`)
    ) {
      throw new Error(`${spec.name}@${spec.version} ausente do pnpm-lock.yaml`)
    }
    const dir = storePackageDir(spec.name, spec.version)
    const pkg = readJson(join(dir, 'package.json'))
    if (pkg.version !== spec.version) {
      throw new Error(
        `${spec.name}: instalado ${pkg.version} ≠ ${spec.version}`
      )
    }
    let text
    if (spec.textFrom === 'gpl') text = gplText
    else if (spec.textFrom === 'root-license') text = rootLicense
    else {
      text = licenseFile(dir)
      if (!text) throw new Error(`${spec.name}: sem LICENSE no tarball`)
    }
    const pkgLicense = licenseFile(dir)
    const copyright =
      spec.copyright ??
      (spec.copyrightFromPackageLicense
        ? copyrightLine(pkgLicense)
        : spec.textFrom === 'gpl'
          ? null
          : copyrightLine(text))
    if (!copyright) {
      throw new Error(
        `${spec.name}: copyright não determinado a partir do tarball`
      )
    }
    const notice = spec.noticeFile ? licenseFile(dir, [spec.noticeFile]) : null
    const pending = [...(spec.pending ?? [])]
    if (!spec.direct) {
      pending.push(
        'Inclusão efectiva no bundle por confirmar (dependência transitiva; MANIFEST.json do bundle ausente).'
      )
    }
    entries.push({
      name: spec.name,
      version: pkg.version,
      license: pkg.license,
      copyright,
      ...pkgUrls(pkg),
      text: notice ? `${text}\n--- ${spec.noticeFile} ---\n${notice}` : text,
      scope: 'viewer-bundle',
      status: pending.length ? 'pending' : 'confirmed',
      pending,
      ...(spec.note ? { note: spec.note } : {})
    })
  }

  // 3. LibreDWG upstream (o wasm): ligações ao projecto e à fonte.
  const l = inv.libredwg
  entries.push({
    name: l.name,
    version: l.version,
    license: l.license,
    copyright: l.copyright,
    url: l.url,
    sourceUrl: l.sourceUrl,
    wasmSourceUrl: l.wasmSourceUrl,
    text: gplText,
    scope: 'viewer-bundle',
    status: 'pending',
    pending: l.pending
  })

  // 4. Restantes transitivos e fontes: sem fabricar listas.
  const dist = sortedDistribution(
    runtimeClosure(lock, Object.keys(appPkg.dependencies))
  )
  entries.push({
    name: inv.transitive.name,
    version: `${dist.total} pacotes (fecho das dependências de execução no lockfile)`,
    license: dist.text,
    copyright: null,
    url: null,
    sourceUrl: null,
    text: '',
    scope: 'app-runtime',
    status: 'pending',
    pending: inv.transitive.pending
  })
  entries.push({
    name: inv.fonts.name,
    version: '—',
    license: '—',
    copyright: null,
    url: null,
    sourceUrl: null,
    text: '',
    scope: 'viewer-bundle',
    status: 'pending',
    pending: inv.fonts.pending
  })

  return {
    app: inv.app,
    projectPending: inv.projectPending,
    gplText,
    entries
  }
}

function renderNotice({ app, projectPending, entries }) {
  const lines = [
    app.name,
    app.copyright,
    `PENDING: ${app.copyrightPending}`,
    '',
    'This program is free software: you can redistribute it and/or modify it',
    'under the terms of the GNU General Public License as published by the',
    'Free Software Foundation, either version 3 of the License, or (at your',
    'option) any later version. It is distributed WITHOUT ANY WARRANTY.',
    `Corresponding source: ${app.sourceUrl}`,
    '',
    'Third-party components (full licence texts in third-party.json):',
    ''
  ]
  for (const e of entries) {
    lines.push(`- ${e.name} ${e.version} - ${e.license}`)
    if (e.copyright) lines.push(`  ${e.copyright}`)
    if (e.url) lines.push(`  Project: ${e.url}`)
    if (e.sourceUrl) lines.push(`  Source: ${e.sourceUrl}`)
    if (e.wasmSourceUrl) lines.push(`  Wasm package source: ${e.wasmSourceUrl}`)
    for (const p of e.pending) lines.push(`  PENDING: ${p}`)
  }
  lines.push('', 'Pending items:')
  lines.push(`- ${app.sourceUrlPending}`)
  for (const p of projectPending) lines.push(`- ${p}`)
  lines.push(
    '',
    '"DWG" is a file format; this app is not affiliated with Autodesk or mlightcad.',
    'This notice is informational and is not legal advice.',
    ''
  )
  return lines.join('\n')
}

function renderTs({ app, projectPending, gplText, entries }) {
  const j = v => JSON.stringify(v, null, 2)
  return `// SPDX-License-Identifier: GPL-3.0-or-later
//
// GERADO por scripts/generate-licenses.mjs (node scripts/generate-licenses.mjs).
// NÃO editar à mão: alterar o inventário (scripts/third-party-inventory.json) e regenerar.
/* eslint-disable */

export interface ThirdPartyEntry {
  readonly name: string
  readonly version: string
  readonly license: string
  readonly copyright: string | null
  readonly url: string | null
  readonly sourceUrl: string | null
  readonly wasmSourceUrl?: string
  readonly text: string
  readonly scope: 'app-runtime' | 'viewer-bundle'
  readonly status: 'confirmed' | 'pending'
  readonly pending: readonly string[]
  readonly note?: string
}

export const APP_LICENSE_INFO = ${j(app)} as const

export const PROJECT_PENDING: readonly string[] = ${j(projectPending)}

export const GPL_3_0_TEXT: string = ${j(gplText)}

export const THIRD_PARTY: readonly ThirdPartyEntry[] = ${j(entries)}
`
}

export function render() {
  const data = collect()
  return {
    [outJson]: `${JSON.stringify(data.entries, null, 2)}\n`,
    [outNotice]: renderNotice(data),
    [outTs]: renderTs(data)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = render()
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files)
      .filter(([p, c]) => !existsSync(p) || readText(p) !== c)
      .map(([p]) => p.replace(`${appDir}/`, ''))
    if (stale.length) {
      console.error(
        `Desactualizado (correr generate-licenses.mjs): ${stale.join(', ')}`
      )
      process.exit(1)
    }
    console.log('Inventário de licenças em sincronia.')
  } else {
    for (const [p, c] of Object.entries(files)) writeFileSync(p, c)
    console.log(`Gerados: ${Object.keys(files).length} ficheiros.`)
  }
}
