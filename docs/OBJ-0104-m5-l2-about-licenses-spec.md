# OBJ-0104 M5-L2 — Ecrã Acerca/Licenças: especificação e plano

Fontes: `docs/OBJ-0104-architecture.md` D-1, D-6, D-7, §8.2; conteúdo de `docs/OBJ-0104-licenses.md` (inventário L1). **Não é parecer jurídico.**

## Âmbito

- Ecrã nativo `AboutLicenses` (React Native) acessível a partir do ecrã principal, offline, em PT-PT.
- Conteúdo em módulo puro `src/about/aboutContent.ts`, transcrito do inventário L1 (atribuições aprovadas); sem rede.
- Fora de âmbito: parser/bridge, `third-party.json` gerado e GPL-3.0.txt (L2 completo da arquitectura / itens L1 §6 pendentes), publicação, contacto upstream, decisão jurídica.
- Nota de fronteira: o cartão cita `apps/viewer/**`; no repositório a app é `apps/freedom-mobile/**` (único local do ecrã nativo, arquitectura §3). Web/API intactos.

## Decisões

1. **Não bloqueia fluxos (D-1):** o ecrã é um overlay; `ViewerScreen` fica montado (sessão, servidor e WebView não são reiniciados). Fechar devolve ao estado anterior.
2. **Sem aconselhamento jurídico:** aviso explícito no ecrã; itens [H] do L1 aparecem como "por confirmar", nunca como afirmação.
3. **Pendentes visíveis:** `SOURCE_URL_PENDING` e titular de copyright `Equipa Aitra` marcados como por decidir (EXT-1).
4. **Acessibilidade:** botões `accessibilityRole="button"` com etiqueta, cabeçalhos `accessibilityRole="header"`, alvos >= 44 px, botão Voltar; scroll para conteúdo longo (390 px).

## Plano

1. Este documento (commit).
2. `aboutContent.ts` + testes (`aboutContent.node-test.ts`): secções §8.2, licenças esperadas, avisos, ausência de caminhos absolutos/e-mails, alvos 44 px na folha de estilos.
3. `AboutLicenses.tsx`, ligação em `App.tsx` (botão "Acerca" + overlay).
4. Gates: `tsc --noEmit`, `npm test`, eslint/prettier no delta, `git diff --check`, prova em browser (desktop/390 px) com react-native-web se disponível, senão registar limitação.

## Rework t_7340332b — completar §8.2 (a implementação `5989aa8b` foi rejeitada)

A primeira entrega transcrevia à mão um resumo do inventário, sem versões, sem texto GPL-3.0, sem textos de licença e sem ligações. Este rework cumpre `docs/OBJ-0104-architecture.md` §8.2 por inteiro, mantendo o desenho aprovado (overlay nativo, offline, sem tocar em parser/bridge/web/API).

### Decisões adicionais

5. **Metadados «Acerca»**: versão da app (`app.json`), `viewerVersion` recebido no `ready` e SHA de build (`EXPO_PUBLIC_BUILD_SHA`, inlined pelo Metro; ausente ⇒ «não definido», nunca inventado). O `viewerVersion` já existe em `session.shell` (reducer do `ready`); `ViewerScreen` expõe-no por um prop opcional `onViewerVersion` (só leitura, efeito sem retorno; não altera ponte, servidor nem ciclo de vida) e o `App.tsx` passa-o ao overlay. Antes do `ready`: «a aguardar o viewer».
6. **GPL-3.0 local**: `apps/freedom-mobile/assets/licenses/GPL-3.0.txt` (texto canónico, `sha256` verificado pelo gerador). O botão «Ver texto completo da GPL-3.0» abre uma vista de texto interna com «Voltar» (≥44 px) e o botão físico «Voltar» do Android (`BackHandler`): na vista de texto regressa ao Acerca; no Acerca fecha o overlay.
7. **Créditos gerados, não escritos à mão**: `apps/freedom-mobile/scripts/generate-licenses.mjs` lê `apps/freedom-mobile/package.json` + `package-lock.json`, os `LICENSE`/`package.json` instalados (app e store pnpm do viewer), o `LICENSE` da raiz e a entrada curada `scripts/third-party-inventory.json` (espelho máquina-legível de `docs/OBJ-0104-licenses.md`, com proveniência por campo) e escreve `assets/licenses/third-party.json` (formato §8.2 `{name, version, license, copyright, url, text}` + `scope`, `status`, `pending[]`, `sourceUrl`), `assets/licenses/NOTICE.txt` e `src/about/licenseData.generated.ts` (o que o RN consome; sem `fs` em runtime). `--check` falha se os ficheiros commitados divergirem.
8. **Sem fabricação**: o que o tarball não prova fica `status: "pending"` com o motivo explícito (variante `only`/`or-later` e linha de copyright FSF do LibreDWG — o tarball `@mlightcad/libredwg-web@0.8.0` não traz `LICENSE`/`AUTHORS`; incoerência `license: GPL-3.0` vs `LICENSE` MIT em `@mlightcad/libredwg-converter`; separação runtime/build dos transitivos; fontes §6.3; `MANIFEST.json` do bundle; titular da app). `SOURCE_URL_PENDING` mantém-se (EXT-1); EXT-2 (parecer lojas) é referido como pendente, nunca respondido.
9. **Ligações**: URL do projecto e da fonte por entrada, mostradas como texto seleccionável e abertas só por acção do utilizador (`Linking.openURL`, injectável); sem pedidos de rede automáticos.

### Plano do rework

1. Este addendum (commit docs).
2. Gerador + inventário + `GPL-3.0.txt` + saídas geradas (commit).
3. `aboutContent.ts` (metadados + itens gerados), `AboutLicenses.tsx` (GPL, detalhe de licença, ligações, Back), `ViewerScreen`/`App.tsx` (seam `viewerVersion`) (commit).
4. Testes comportamentais com `react-test-renderer` + shim de `react-native` (loader de teste que transpila TSX com `typescript`), conteúdo/inventário/pendentes, alvos ≥44 px, navegação, sincronia do gerador.
5. Evidência de superfície: ver `docs/evidence/OBJ-0104-m5-l2/README.md` — desktop 1280 e 390 px com a árvore RN real renderizada por `react-native-web` no Chromium do Playwright, medições de alvos tácteis por `getBoundingClientRect`; limitação declarada (não é dispositivo/emulador: sem KVM/AVD neste host).
