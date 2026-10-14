// SPDX-License-Identifier: GPL-3.0-or-later
//
// Substituto de `server/nativeServer` e de `files/expoFileAdapters` SÓ para
// testes em Node (o original precisa de módulos nativos). O servidor é o
// `LocalAssetServer` REAL sobre um listener falso, por isso a sessão arranca,
// obtém o `viewerUrl` com token e o `ViewerScreen` monta a (falsa) WebView.
import { FakeAssetStore, FakePicker } from '../../fixtures/fakeFiles.ts'
import { makeRig } from '../../fixtures/fakeServer.ts'
import type { ServerFactory } from '../../screens/viewerSession.ts'

export const createNativeServer: ServerFactory = onEvent =>
  makeRig({ onEvent }).server

export const createExpoPicker = () => new FakePicker()
export const createExpoAssetStore = () => new FakeAssetStore()
