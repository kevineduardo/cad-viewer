/** @jest-environment jsdom */

type Ent = Record<string, unknown>

const mockSelection = { clear: jest.fn(), add: jest.fn() }
const mockZoomTo = jest.fn()
const mockView = {
  activeLayoutBtrId: 'layout-a',
  zoomTo: (...args: unknown[]) => mockZoomTo(...args),
  selectionSet: mockSelection
}
let entities: Ent[] = []
const mockDoc = {
  database: {
    tables: {
      layerTable: { getAt: () => undefined },
      blockTable: {
        getIdAt: () => ({
          newIterator: () => entities,
          getIdAt: (id: string) => entities.find(e => e.objectId === id)
        })
      }
    }
  }
}
let hasDocument = true

jest.mock('@mlightcad/cad-simple-viewer', () => {
  const { createCadSimpleViewerMock } = require('./helpers/mockCadSimpleViewer')
  return createCadSimpleViewerMock({
    AcApDocManager: {
      instance: {
        get curView() {
          return hasDocument ? mockView : undefined
        },
        get curDocument() {
          return hasDocument ? mockDoc : undefined
        }
      }
    },
    AcApI18n: {
      t: (_key: string, opts?: { fallback?: string }) => opts?.fallback ?? _key,
      mergeLocaleMessage: jest.fn()
    }
  })
})

// The real data-model bundle needs TextDecoder, which jsdom does not provide.
jest.mock('@mlightcad/data-model', () => ({
  AcGePoint2d: class {
    constructor(
      public x: number,
      public y: number
    ) {}
  },
  AcGeBox2d: class {
    constructor(
      public min: { x: number; y: number },
      public max: { x: number; y: number }
    ) {}
  }
}))

import { AcApDocManager } from '@mlightcad/cad-simple-viewer'

import { AcUiI18n, acuiRegisterSimpleUiI18n } from '../src/i18n'
import { AcUiFindPaletteView } from '../src/ui/AcUiFindPaletteView'

function text(id: string, textString: string, x: number): Ent {
  return {
    objectId: id,
    dxfTypeName: 'TEXT',
    textString,
    layer: 'NOTES',
    position: { x, y: 0 },
    geometricExtents: { min: { x, y: 0 }, max: { x: x + 4, y: 1 } }
  }
}

function createView() {
  acuiRegisterSimpleUiI18n()
  const view = new AcUiFindPaletteView({
    editor: AcApDocManager.instance,
    i18n: new AcUiI18n()
  })
  document.body.appendChild(view.element)
  return view
}

const rows = (view: AcUiFindPaletteView) =>
  Array.from(view.element.querySelectorAll<HTMLElement>('.ml-ex-ui-find-row'))
const status = (view: AcUiFindPaletteView) =>
  view.element.querySelector('.ml-ex-ui-find-status')?.textContent

describe('AcUiFindPaletteView', () => {
  beforeEach(() => {
    entities = [text('t1', 'Alpha beta', 10), text('t2', 'beta GAMMA', 20)]
    hasDocument = true
    mockView.activeLayoutBtrId = 'layout-a'
    jest.clearAllMocks()
  })

  afterEach(() => {
    document.body.replaceChildren()
    document.getElementById('ml-ex-ui-styles')?.remove()
  })

  it('shows a hint before any search and does not scan on construction', () => {
    const view = createView()
    expect(status(view)).toBe('findPalette.hint')
    expect(rows(view)).toHaveLength(0)
    view.destroy()
  })

  it('lists matches with type, layer and location labels', () => {
    const view = createView()
    view.search('BETA')
    expect(rows(view)).toHaveLength(2)
    expect(
      rows(view)[0].querySelector('.ml-ex-ui-find-meta')?.textContent
    ).toBe('findPalette.kind.text · NOTES · (10, 0)')
    expect(status(view)).toBe('findPalette.count')
    view.destroy()
  })

  it('reports when nothing matches', () => {
    const view = createView()
    view.search('zzz')
    expect(rows(view)).toHaveLength(0)
    expect(status(view)).toBe('findPalette.noResults')
    view.destroy()
  })

  it('reports a missing document instead of throwing', () => {
    hasDocument = false
    const view = createView()
    view.search('x')
    expect(status(view)).toBe('findPalette.noDocument')
    view.destroy()
  })

  it('zooms to the hit and selects only that entity on row click', () => {
    const view = createView()
    view.search('gamma')
    rows(view)[0].click()

    expect(mockZoomTo).toHaveBeenCalledTimes(1)
    const [box] = mockZoomTo.mock.calls[0]
    expect(box.min.x).toBeLessThan(20)
    expect(box.max.x).toBeGreaterThan(24)
    expect(mockSelection.clear).toHaveBeenCalledTimes(1)
    expect(mockSelection.add).toHaveBeenCalledWith('t2')
    expect(rows(view)[0].classList.contains('is-selected')).toBe(true)
    view.destroy()
  })

  it('steps through results with Enter and Shift+Enter', () => {
    const view = createView()
    const input = view.element.querySelector(
      'input[type="search"]'
    ) as HTMLInputElement
    input.value = 'beta'
    const press = (shiftKey = false) =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true })
      )

    press() // first Enter searches and goes to the first hit
    expect(mockSelection.add).toHaveBeenLastCalledWith('t1')
    press() // next
    expect(mockSelection.add).toHaveBeenLastCalledWith('t2')
    press() // wraps
    expect(mockSelection.add).toHaveBeenLastCalledWith('t1')
    press(true) // previous wraps backwards
    expect(mockSelection.add).toHaveBeenLastCalledWith('t2')
    view.destroy()
  })

  it('re-runs the search instead of navigating when the layout changed', () => {
    const view = createView()
    view.search('beta')
    mockView.activeLayoutBtrId = 'layout-b'
    entities = [text('t9', 'beta only here', 0)]
    rows(view)[0].click()

    expect(mockZoomTo).not.toHaveBeenCalled()
    expect(mockSelection.add).not.toHaveBeenCalled()
    expect(rows(view)).toHaveLength(1)
    view.destroy()
  })

  it('does not touch the view for blank queries', () => {
    const view = createView()
    view.search('   ')
    expect(status(view)).toBe('findPalette.hint')
    expect(mockSelection.clear).not.toHaveBeenCalled()
    view.destroy()
  })
})
