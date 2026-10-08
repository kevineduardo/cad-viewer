import { AcApContext, AcEdCommand } from '@mlightcad/cad-simple-viewer'

import { store } from '../app'

/**
 * Opens the Find palette (FIND).
 *
 * The palette searches text, multiline text and block attributes in the whole
 * drawing (all layouts) by default, or in the current layout only, and
 * navigates to a result (activating its layout when needed).
 */
export class AcApFindCmd extends AcEdCommand {
  async execute(_context: AcApContext) {
    store.dialogs.activePaletteTab = 'find'
    store.dialogs.layerManager = true
    store.dialogs.findFocusTick++
  }
}
