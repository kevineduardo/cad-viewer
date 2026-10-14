# OBJ-0104 · M5-L2 rework — Evidência de superfície do ecrã Acerca/Licenças

Card `t_7340332b`. Complementa os testes comportamentais (`apps/freedom-mobile/src/about/*.node-test.ts`) com píxeis e medições reais. **Não é parecer jurídico.**

## O que foi executado (e o que não foi)

| Executado                                                                                                                                                                                                                                                                                  | Não executado                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A árvore React Native **real** (`AboutLicenses.tsx`, `aboutContent.ts`, `licenseData.generated.ts`) renderizada com `react-native-web 0.21.4` num **Chromium real** (Playwright, canal `chromium`, versão em `metrics.json`) a **1280×800 @1x** e **390×844 @3x** (`isMobile`, `hasTouch`) | Dispositivo físico ou emulador Android/iOS (ver limitação)                                                                                                                                                                                                                                                                                                                          |
| Toques/cliques por papel e etiqueta de acessibilidade: «Ver texto completo da GPL-3.0», «Voltar ao Acerca e licenças», «Voltar ao visualizador», ligação LibreDWG, «Ver texto da licença de @mlightcad/libredwg-web»                                                                       | `BackHandler` nativo (botão físico) e `Linking.openURL` nativo: só cobertos nos testes unitários com shim                                                                                                                                                                                                                                                                           |
| Medição de **41 alvos tácteis** (`role=button`/`link`) por `getBoundingClientRect` em cada viewport e na vista GPL; sem overflow horizontal                                                                                                                                                | Integração com um viewer real: `viewerVersion` `1.15.7` é um valor **sintético do harness** (o ecrã mostra primeiro «a aguardar o viewer»); a ligação `ready → shell.viewerVersion → onViewerVersion → App → Acerca` não é exercitada por esta prova de píxeis mas pelo teste de integração `apps/freedom-mobile/src/about/appReadyAbout.node-test.ts` (ver «Gates complementares») |

### Limitação exacta

Este host (WSL2) não tem `/dev/kvm`, nem `adb`/`emulator`/AVD (o SDK em cache só tem build-tools/platform-tools), pelo que **não foi possível** repetir a prova de dispositivo da M4-I6 (`docs/evidence/OBJ-0104-m4-i6/android/`). `react-native-web` é uma aproximação: o motor de layout e o texto são os do browser, não os do Yoga/Android. Estas capturas provam conteúdo, navegação interna, alvos ≥44 e ausência de overflow a 390 px **na renderização web da mesma árvore**, não a aparência num telemóvel.

## Proveniência (commit de código vs. commit de evidência)

`metrics.json` guarda, em `buildSha`, o `git rev-parse HEAD` **no momento da execução**: `12ef05bb` — o último commit de código/testes do ecrã Acerca/Licenças neste rework. As capturas e o `metrics.json` entraram depois, em `94b7f4be`, um commit **só de docs** (`git diff 12ef05bb 94b7f4be` não toca em `apps/`). Logo, `buildSha` identifica o código medido e **não** o HEAD actual do ramo, que é sempre posterior (inclui o commit de evidência e os do follow-up `t_c0050506`, que só acrescentam testes/docs). O bloco `provenance` de `metrics.json` regista esta relação.

## Resultados (`metrics.json`)

| Verificação                                         | desktop 1280                     | 390 px (@3x)        |
| --------------------------------------------------- | -------------------------------- | ------------------- |
| Versão da app (`app.json`)                          | `0.0.0`                          | `0.0.0`             |
| Build SHA (= `git rev-parse HEAD` na execução)      | ver `metrics.json` (`12ef05bb`)  | idem                |
| `viewerVersion` antes / depois do `ready` sintético | «a aguardar o viewer» → `1.15.7` | idem                |
| Alvos tácteis medidos                               | 41, mín. 72,9×44 px              | 41, mín. 72,9×44 px |
| Alvos < 44 px                                       | 0                                | 0                   |
| Overflow horizontal (`scrollWidth` > largura)       | não                              | não                 |
| GPL-3.0 na vista de texto vs `GPL-3.0.txt`          | igual (sem espaços)              | igual (sem espaços) |
| Ligação LibreDWG aberta só ao tocar                 | sim                              | sim                 |
| `SOURCE_URL_PENDING` visível                        | sim                              | sim                 |
| Pedidos de rede durante a prova                     | 0                                | 0                   |

Capturas (`desktop-*.png`, `390-*.png`): 1 antes do `ready`; 2 Acerca com `viewerVersion`; 3 entrada LibreDWG (links e pendentes); 4 código-fonte `SOURCE_URL_PENDING`; 5 botão GPL; 6/7 início e fim da GPL-3.0; 8 texto de licença de uma entrada.

## Reproduzir

```bash
# a partir da raiz do repo; <work> = pasta fora do repo (recebe `npm install react-native-web react-dom react`)
node docs/evidence/OBJ-0104-m5-l2/about-surface-proof.mjs <work> [<out>]
```

Falha (`exit 1`) se alguma asserção da prova falhar; não há asserções saltadas. Sem Chromium do Playwright ou sem rede para o `npm install` o comando falha — não há resultado «presumido».

## Gates complementares (testes, não píxeis)

`cd apps/freedom-mobile && npm test` inclui `appReadyAbout.node-test.ts` (o `App.tsx` de produção renderizado com `react-test-renderer`: o viewer sintético envia o `ready` pela ponte real e o `viewerVersion` aparece no Acerca, antes/depois de abrir; WebView, safe-area e servidor nativo substituídos por fakes em `src/about/testing/`), e ainda `AboutLicenses.node-test.ts` (renderização por `react-test-renderer` sobre um shim de `react-native`, handlers, `BackHandler`, alvos ≥44 por estilo, pendentes) e `aboutContent.node-test.ts` (inventário, NOTICE, GPL canónica por `sha256`, sincronia do gerador `generate-licenses.mjs --check`).
