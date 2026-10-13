const store = {
  dialogs: { activePaletteTab: '', layerManager: false, findFocusTick: 0 }
}

jest.mock('@mlightcad/cad-simple-viewer', () => ({ AcEdCommand: class {} }))
jest.mock('../src/app', () => ({ store }))

import { isFindShortcut, openFindPalette } from '../src/command/AcApFindCmd'

const key = (over: Partial<Parameters<typeof isFindShortcut>[0]>) => ({
  key: 'f',
  code: 'KeyF',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over
})

describe('Find shortcut (Ctrl/Cmd+F)', () => {
  it('matches Ctrl+F and Cmd+F, in either case or layout', () => {
    expect(isFindShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isFindShortcut(key({ metaKey: true }))).toBe(true)
    expect(isFindShortcut(key({ ctrlKey: true, key: 'F' }))).toBe(true)
    expect(isFindShortcut(key({ ctrlKey: true, key: 'а', code: 'KeyF' }))).toBe(
      true
    )
  })

  it('ignores plain F, other keys and extra modifiers', () => {
    expect(isFindShortcut(key({}))).toBe(false)
    expect(isFindShortcut(key({ ctrlKey: true, key: 'g', code: 'KeyG' }))).toBe(
      false
    )
    expect(isFindShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(isFindShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('opens the Find tab of the palette and requests focus', () => {
    openFindPalette()
    expect(store.dialogs.activePaletteTab).toBe('find')
    expect(store.dialogs.layerManager).toBe(true)
    expect(store.dialogs.findFocusTick).toBe(1)
  })
})
