# OBJ-0104 — M6 L3: higiene de publicação e prontidão

Estado: **PRONTO PARA PR-ONLY, PUBLICAÇÃO CONDICIONAL** — sem bloqueios de código/higiene; restam pendências externas e uma decisão de docs (§4). P1 fechado. Nada foi publicado, nem aberto PR, nem contactado o upstream. Reverifica a árvore sobre o HEAD-base `92433e93` (a versão preliminar foi feita sobre `5989aa8b` e está **substituída**). Este relatório e a redacção em `docs/OBJ-0104-scoping.md` são entregues num commit docs-only (t_fad4b74) por cima de `92433e93`; o SHA desse commit não pode constar do próprio ficheiro — é o `HEAD` do ramo (`git rev-parse HEAD`) e `git rev-parse HEAD^` = `92433e930b413003017d6447bdf68bc5b8d9f037`.

## 1. Base verificada

- HEAD-base verificado: `92433e930b413003017d6447bdf68bc5b8d9f037` (ramo `cad-viewer/t_69c32932-obj-0104-scoping-expo-mobile-freedom-dwg`).
- Base `main`: merge-base `a39bab9b16892fa9d49101035579a022a03a8fc6`; `origin/main` = `d7e3e121e7070e8febf4e88b20d79df55a4cbb7a`.
- Remotos: `origin` = mlightcad/cad-viewer (upstream, **sem acções**); `fork` = fork do Kevin.
- Rework t_7340332b (6 commits `a793b7a6..94b7f4be`, 38 ficheiros): GPL-3.0 local, NOTICE/third-party gerados (`scripts/generate-licenses.mjs`), ecrã §8.2 completo, higiene (sem nome pessoal), prova desktop/390 px em `docs/evidence/OBJ-0104-m5-l2/`.
- Follow-up t_c0050506 (1 commit, `92433e93`: teste de integração App→ready→Acerca e proveniência da evidência M5-L2) já está commitado; **não há ficheiros concorrentes na árvore viva**. Os 2 ficheiros deste card (t_c4d96768, corrigidos em t_fad4b74) — `docs/OBJ-0104-scoping.md` (linha 9) e este relatório — **não tinham sido commitados** na revisão final; agora são commitados explicitamente e a árvore fica limpa (`git status --porcelain=v1` vazio).

## 2. Scan §9 — re-executado sobre HEAD

| Categoria | Resultado |
| --- | --- |
| Chaves PEM/`AKIA`/`ghp_`/`sk-`/`xox`, e-mails (endereços pessoais e de equipa) | **0** em `apps`, `packages/cad-mobile-viewer`, `docs/OBJ-0104-*`, `docs/evidence` (padrões exactos aplicados no gate do commit; não repetidos aqui para o relatório não se auto-detectar) |
| Ficheiros de credenciais em `apps/freedom-mobile` | **0** (`.gitignore` cobre `.env*`, keystores, `.p8/.p12/.jks`, `credentials.json`) |
| `token`/`secret` | Token de sessão efémero do servidor loopback; constantes `SECRET_*` são nomes de fixtures de teste (caminhos sintéticos `/data/user/0/pt.aitra.freedom/...`, `/home/kevin/obra.dwg` em testes de redacção). Justificado |
| Caminhos `/home`, `/mnt`, `C:\Users` | Só em testes (entradas sintéticas de `redactPaths`) e em texto que descreve a regra (`architecture.md` §9, `m2-i1` spec). Justificado |
| `Equipa Aitra` | `NOTICE.txt`, `third-party-inventory.json`, `licenseData.generated.ts`, `fixtures/PROVENANCE.md`: nome de equipa como titular provisório, marcado `PENDING` (titular por confirmar). Decisão de Kevin; ver P2 |
| "hermes" | `hermes-parser`/`hermes-estree` (RN, npm). Justificado |
| Kanban / IDs `t_xxxxxxxx` no app | 0 |
| Evidência M5-L2 | sem caminhos absolutos |
| `docs/OBJ-0104-scoping.md:9` | Caminho interno do workspace **redigido** para `<workspace checkout>` e **commitado** (P1 fechado); `git grep -F` do caminho exacto sobre o HEAD entregue, em `docs`: 0 ocorrências. O valor rejeitado não é reproduzido aqui, para o relatório não o voltar a conter |

## 3. Critérios

1. **Segredos/caminhos internos** — OK: sem segredos; caminho interno removido (P1); restantes ocorrências justificadas em §2.
2. **Licença/NOTICE vs L1/L2** — OK: `package.json` do app `GPL-3.0-or-later` (D-6), `LICENSE` raiz MIT upstream preservado, `GPL-3.0.txt`/`NOTICE.txt`/`third-party.json` presentes e gerados do inventário L1; `generate-licenses.mjs --check` → "em sincronia". Publicação permanece condicional (D-1): `SOURCE_URL_PENDING`, LibreDWG com variante/copyright não confirmados, titular da app por confirmar, inclusão no bundle por confirmar (MANIFEST.json do bundle ausente), incoerência `license` GPL vs `LICENSE` MIT no tarball.
3. **DWG+DXF/libredwg/FIND preservados; sem acção upstream** — OK: `fixtureGate.node-test.ts`/`guards.test.ts` proíbem `@mlightcad/dwg-converter`/`use-dwg-converter`; suite completa inclui FIND; sem push/PR/contacto a `origin`.

## 4. Pendências (nenhuma bloqueia o handoff pr-only)

- **P1** FECHADO: caminho em `scoping.md:9` redigido e commitado (docs apenas). O commit anterior (`92433e93`) ainda contém o caminho no histórico (não se reescreve histórico); o HEAD entregue não o contém.
- **P2** Kevin: titular do copyright da app; EXT-1 (URL do código-fonte); SPDX/copyright LibreDWG; esclarecer upstream-licença do `libredwg-web` (apenas por quem tem autorização, não este card).
- **P3** decisão L3: `docs/.vitepress/config.ts` não tem `srcExclude`; docs `OBJ-0104-*` e `docs/evidence` entrariam no site vitepress se publicados.
- **P4** build de loja bloqueado enquanto existirem `PENDING`/`SOURCE_URL_PENDING` (por desenho, §8.2).
- Limitações de evidência (declaradas no README da evidência): prova de superfície via react-native-web+Chromium, não dispositivo (sem KVM/AVD); capturas `desktop-2/4/5` e `390-4/5` são idênticas (md5), pois mostram a mesma vista de topo — os 41 alvos tácteis ≥44 px e o texto GPL foram validados por `metrics.json`, não pelas imagens.

## 5. Gates (não pesados)

- `apps/freedom-mobile`: `tsc --noEmit` OK; `npm test` 771/771 pass; `node scripts/generate-licenses.mjs --check` OK.
- `git diff --check` OK; `git status --short` vazio após o commit.
- Ficheiros alterados neste card (commitados, docs apenas): `docs/OBJ-0104-m6-l3-readiness.md`, `docs/OBJ-0104-scoping.md`. Sem código de produto, sem push/PR/merge/deploy/acção upstream.
