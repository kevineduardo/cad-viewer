// SPDX-License-Identifier: GPL-3.0-or-later
//
// Prova de superfície do ecrã Acerca/Licenças (M5-L2 rework, t_7340332b).
// Renderiza a árvore React Native REAL (`AboutLicenses.tsx`) com
// `react-native-web` no Chromium do Playwright, a 1280×800 e a 390×844, e mede
// os alvos tácteis com `getBoundingClientRect`. NÃO é dispositivo nem emulador
// (limitação em README.md); `BackHandler`/`Linking` nativos não são exercidos.
//
// Uso (a partir de qualquer pasta):
//   node docs/evidence/OBJ-0104-m5-l2/about-surface-proof.mjs <pasta-de-trabalho> [pasta-de-saída]
// A pasta de trabalho recebe `npm install react-native-web react-dom react`
// (fora do repo) e o bundle esbuild; a saída por omissão é esta pasta.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const app = join(repo, 'apps/freedom-mobile')
const work = resolve(process.argv[2] ?? '')
const outDir = resolve(process.argv[3] ?? here)
if (!process.argv[2]) throw new Error('indicar a pasta de trabalho')
mkdirSync(work, { recursive: true })
mkdirSync(outDir, { recursive: true })

// 1. Dependências só para esta prova (não entram no repo).
const wreq = createRequire(join(work, 'noop.js'))
try {
  wreq.resolve('react-native-web/package.json')
} catch {
  writeFileSync(join(work, 'package.json'), '{"private":true}\n')
  execFileSync(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      'react@19.2.3',
      'react-dom@19.2.3',
      'react-native-web@0.21.4'
    ],
    { cwd: work, stdio: 'inherit' }
  )
}
const nm = join(work, 'node_modules')

// 2. Bundle: `react-native` → `react-native-web`, um só React.
const esbuild = createRequire(join(repo, 'noop.js'))(
  join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild')
)
const entry = join(work, 'entry.tsx')
const buildSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo })
  .toString()
  .trim()
const appVersion = JSON.parse(readFileSync(join(app, 'app.json'), 'utf8')).expo
  .version
writeFileSync(
  entry,
  `import { createRoot } from 'react-dom/client'
import { AboutLicenses } from ${JSON.stringify(join(app, 'src/about/AboutLicenses.tsx'))}
const w = window as unknown as Record<string, unknown>
w.__links = [] as string[]
w.__closed = 0
let root: ReturnType<typeof createRoot>
w.__render = (viewerVersion: string | null) => {
  root ??= createRoot(document.getElementById('root')!)
  root.render(
    <AboutLicenses
      appVersion=${JSON.stringify(appVersion)}
      viewerVersion={viewerVersion}
      buildSha=${JSON.stringify(buildSha)}
      onClose={() => { (w.__closed as number)++ }}
      onOpenLink={u => (w.__links as string[]).push(u)}
    />
  )
}
`
)
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: join(work, 'bundle.js'),
  jsx: 'automatic',
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
  alias: {
    'react-native': join(nm, 'react-native-web'),
    react: join(nm, 'react'),
    'react-dom': join(nm, 'react-dom')
  },
  nodePaths: [nm],
  logLevel: 'warning'
})
writeFileSync(
  join(work, 'index.html'),
  '<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{position:relative;display:flex}</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>'
)

// 3. Chromium real.
// Playwright vive nas dependências do exemplo (pnpm), como em `surfaceProof.node-test.ts`.
const { chromium } = createRequire(
  realpathSync(
    join(
      repo,
      'packages/cad-viewer-example/node_modules/@playwright/test/package.json'
    )
  )
)('playwright')
const browser = await chromium.launch({ channel: 'chromium' })
const metrics = {
  provenance: {
    buildShaMeaning:
      'git rev-parse HEAD no momento da execução = commit de código/testes sob prova; não é o HEAD do commit que guarda esta evidência'
  },
  buildSha,
  appVersion,
  chromium: browser.version(),
  viewports: {}
}
const failures = []
const ok = (cond, msg) => {
  if (!cond) failures.push(msg)
}

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, dsf: 1, mobile: false },
  { name: '390px', width: 390, height: 844, dsf: 3, mobile: true }
]
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dsf,
    isMobile: vp.mobile,
    hasTouch: vp.mobile
  })
  const page = await ctx.newPage()
  const external = []
  page.on('request', r => {
    if (!r.url().startsWith('file:') && !r.url().startsWith('data:'))
      external.push(r.url())
  })
  const shot = name =>
    page.screenshot({
      path: join(
        outDir,
        `${vp.name === 'desktop' ? 'desktop' : '390'}-${name}.png`
      )
    })
  await page.goto(pathToFileURL(join(work, 'index.html')).href)
  await page.evaluate(() => window.__render(null))
  await page.waitForSelector('[data-testid="about-root"]')

  const text = id => page.locator(`[data-testid="${id}"]`).innerText()
  const m = { steps: {} }
  // 3a. antes do `ready`
  ok(
    (await text('about-viewer-version')).includes('a aguardar o viewer'),
    `${vp.name}: aguardar viewer`
  )
  await shot('1-antes-ready')
  // 3b. viewerVersion chega (valor sintético do harness, não de um viewer real)
  await page.evaluate(() => window.__render('1.15.7'))
  ok(
    (await text('about-viewer-version')) === 'Versão do viewer: 1.15.7',
    `${vp.name}: viewerVersion`
  )
  ok(
    (await text('about-app-version')) === `Versão da app: ${appVersion}`,
    `${vp.name}: versão da app`
  )
  ok(
    (await text('about-build-sha')) === `Build (SHA): ${buildSha}`,
    `${vp.name}: SHA`
  )
  m.meta = {
    app: await text('about-app-version'),
    viewer: await text('about-viewer-version'),
    sha: await text('about-build-sha')
  }
  await shot('2-acerca-ready')

  // 3c. alvos tácteis do ecrã principal (scroll para cada um, medir)
  const measure = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[role="button"],[role="link"]')].map(e => {
        const r = e.getBoundingClientRect()
        return {
          role: e.getAttribute('role'),
          label: e.getAttribute('aria-label'),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10
        }
      })
    )
  const targets = await measure()
  m.targets = {
    count: targets.length,
    minW: Math.min(...targets.map(t => t.w)),
    minH: Math.min(...targets.map(t => t.h)),
    below44: targets.filter(t => t.w < 44 || t.h < 44)
  }
  ok(targets.length > 20, `${vp.name}: ${targets.length} alvos`)
  ok(
    m.targets.below44.length === 0,
    `${vp.name}: alvos < 44: ${JSON.stringify(m.targets.below44)}`
  )
  m.overflow = await page.evaluate(() => ({
    docScrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    mainScrollW: document.querySelector('[data-testid="about-main"]')
      .scrollWidth,
    mainClientW: document.querySelector('[data-testid="about-main"]')
      .clientWidth
  }))
  ok(
    m.overflow.docScrollW <= m.overflow.innerW &&
      m.overflow.mainScrollW <= m.overflow.mainClientW,
    `${vp.name}: overflow horizontal ${JSON.stringify(m.overflow)}`
  )

  // 3d. secção de créditos: LibreDWG, links, pendentes
  const libre = page.locator('[data-testid^="about-entry-LibreDWG"]')
  await libre.scrollIntoViewIfNeeded()
  await shot('3-libredwg')
  const libreText = await libre.innerText()
  for (const s of [
    'GPL-3.0',
    'https://www.gnu.org/software/libredwg/',
    'https://github.com/LibreDWG/libredwg',
    'https://github.com/mlightcad/libredwg-web',
    'Pendente:'
  ])
    ok(libreText.includes(s), `${vp.name}: LibreDWG sem ${s}`)
  await libre.locator('[role="link"]').first().click()
  ok(
    (await page.evaluate(() => window.__links)).join() ===
      'https://www.gnu.org/software/libredwg/',
    `${vp.name}: link só ao tocar`
  )
  const srcPending = page.getByText('SOURCE_URL_PENDING').first()
  await srcPending.scrollIntoViewIfNeeded()
  await shot('4-fonte-pendente')
  ok(await srcPending.isVisible(), `${vp.name}: SOURCE_URL_PENDING visível`)

  // 3e. GPL-3.0 completa e Voltar
  const gpl = page.getByRole('button', {
    name: 'Ver texto completo da GPL-3.0'
  })
  await gpl.scrollIntoViewIfNeeded()
  await shot('5-botao-gpl')
  await gpl.click()
  await page.waitForSelector('[data-testid="about-text"]')
  const gplText = await text('about-text')
  const canonical = readFileSync(
    join(app, 'assets/licenses/GPL-3.0.txt'),
    'utf8'
  )
  const norm = s => s.replace(/\s+/g, '')
  ok(norm(gplText) === norm(canonical), `${vp.name}: texto GPL completo`)
  m.gpl = {
    chars: gplText.length,
    completeVsFile: norm(gplText) === norm(canonical)
  }
  await shot('6-gpl-topo')
  await page.locator('[data-testid="about-text"]').evaluate(e => {
    e.scrollTop = e.scrollHeight
  })
  await shot('7-gpl-fim')
  const textTargets = await measure()
  ok(
    textTargets.every(t => t.w >= 44 && t.h >= 44),
    `${vp.name}: alvos na vista GPL`
  )
  m.gplViewTargets = textTargets
  await page
    .getByRole('button', { name: 'Voltar ao Acerca e licenças' })
    .click()
  await page.waitForSelector('[data-testid="about-main"]')
  ok(
    (await page.evaluate(() => window.__closed)) === 0,
    `${vp.name}: Voltar na vista GPL não fecha`
  )

  // 3f. texto de licença de uma entrada
  await page
    .getByRole('button', {
      name: 'Ver texto da licença de @mlightcad/libredwg-web'
    })
    .click()
  ok(
    (await text('about-text')).includes('GNU GENERAL PUBLIC LICENSE'),
    `${vp.name}: licença da entrada`
  )
  await shot('8-licenca-entrada')
  await page
    .getByRole('button', { name: 'Voltar ao Acerca e licenças' })
    .click()
  await page.getByRole('button', { name: 'Voltar ao visualizador' }).click()
  ok(
    (await page.evaluate(() => window.__closed)) === 1,
    `${vp.name}: Voltar fecha o ecrã`
  )

  m.externalRequests = external
  ok(external.length === 0, `${vp.name}: pedidos externos ${external}`)
  metrics.viewports[vp.name] = {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.dsf,
    ...m
  }
  await ctx.close()
}
await browser.close()
metrics.failures = failures
writeFileSync(
  join(outDir, 'metrics.json'),
  `${JSON.stringify(metrics, null, 2)}\n`
)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(
  `OK: ${Object.keys(metrics.viewports).join(', ')} — ver metrics.json`
)
