import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import { AcGeBox2d, AcGePoint2d } from '@mlightcad/data-model'

import {
  acuiFindExcerpt,
  type AcUiFindHit,
  type AcUiFindResult,
  acuiFindTextInLayout
} from '../find/findText'
import type { AcUiI18n } from '../i18n'
import { acuiEnsureUiStyles } from './styles'

/** Constructor options for {@link AcUiFindPaletteView}. */
export interface AcUiFindPaletteViewOptions {
  /** Document manager used to resolve the active view and database. */
  editor: AcApDocManager
  /** i18n helper for panel labels. */
  i18n: AcUiI18n
}

/**
 * Text search view for the dock panel (FIND).
 *
 * Searches TEXT, MTEXT and block attribute values of the **active layout**
 * when the user submits a query (Enter or the Find button) — never while
 * typing and never in the background. Clicking a result (or Enter / Shift+Enter
 * in the input to step through them) zooms to the text and selects its entity.
 */
export class AcUiFindPaletteView {
  /** Root element mounted in the dock panel find tab. */
  readonly element: HTMLDivElement
  private inputEl!: HTMLInputElement
  private findButton!: HTMLButtonElement
  private matchCaseEl!: HTMLInputElement
  private matchCaseLabelEl!: HTMLLabelElement
  private statusEl!: HTMLDivElement
  private listEl!: HTMLUListElement
  private readonly editor: AcApDocManager
  private readonly i18n: AcUiI18n
  /** Hits of the last search. */
  private result: AcUiFindResult = { hits: [], truncated: false }
  /** Query and layout used for the last search. */
  private searched?: { query: string; matchCase: boolean; layoutId: string }
  /** Index of the hit last navigated to. */
  private activeIndex = -1
  private searchState: 'idle' | 'done' | 'no-document' = 'idle'

  constructor(options: AcUiFindPaletteViewOptions) {
    this.editor = options.editor
    this.i18n = options.i18n
    acuiEnsureUiStyles()

    this.element = document.createElement('div')
    this.element.className = 'ml-ex-ui-find-palette'
    this.buildDom()
    this.refreshLocale()
  }

  /** Updates labels after a locale change. */
  refreshLocale() {
    this.inputEl.placeholder = this.i18n.t('findPalette.placeholder')
    this.inputEl.setAttribute('aria-label', this.i18n.t('findPalette.input'))
    this.findButton.textContent = this.i18n.t('findPalette.find')
    this.matchCaseLabelEl.lastChild!.textContent = this.i18n.t(
      'findPalette.matchCase'
    )
    this.renderResults()
  }

  /** Focuses the query field (called when the tab is opened). */
  focus() {
    this.inputEl.focus()
    this.inputEl.select()
  }

  /** Runs a search programmatically (used by tests and integrations). */
  search(query: string, matchCase = this.matchCaseEl.checked) {
    this.inputEl.value = query
    this.matchCaseEl.checked = matchCase
    this.runSearch()
  }

  /** Hits of the last search. */
  get hits(): readonly AcUiFindHit[] {
    return this.result.hits
  }

  /** Nothing to unsubscribe; kept for symmetry with the other palettes. */
  destroy() {
    this.result = { hits: [], truncated: false }
  }

  private buildDom() {
    const form = document.createElement('div')
    form.className = 'ml-ex-ui-find-form'

    this.inputEl = document.createElement('input')
    this.inputEl.type = 'search'
    this.inputEl.className = 'ml-ex-ui-find-input'
    this.inputEl.autocomplete = 'off'
    this.inputEl.spellcheck = false
    this.inputEl.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      this.handleEnter(event.shiftKey)
    })
    // Keep typing from reaching canvas/viewer keyboard shortcuts.
    this.inputEl.addEventListener('keyup', event => event.stopPropagation())

    this.findButton = document.createElement('button')
    this.findButton.type = 'button'
    this.findButton.className = 'ml-ex-ui-measure-btn ml-ex-ui-find-btn'
    this.findButton.addEventListener('click', () => this.runSearch())

    form.append(this.inputEl, this.findButton)

    this.matchCaseLabelEl = document.createElement('label')
    this.matchCaseLabelEl.className = 'ml-ex-ui-find-option'
    this.matchCaseEl = document.createElement('input')
    this.matchCaseEl.type = 'checkbox'
    this.matchCaseEl.addEventListener('change', () => {
      if (this.searched) this.runSearch()
    })
    this.matchCaseLabelEl.append(this.matchCaseEl, document.createTextNode(''))

    this.statusEl = document.createElement('div')
    this.statusEl.className = 'ml-ex-ui-find-status'
    this.statusEl.setAttribute('role', 'status')
    this.statusEl.setAttribute('aria-live', 'polite')

    this.listEl = document.createElement('ul')
    this.listEl.className = 'ml-ex-ui-find-list'
    this.listEl.addEventListener('click', event => {
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest('li[data-find-index]')
      if (!(row instanceof HTMLElement) || !this.listEl.contains(row)) return
      this.navigateTo(Number(row.dataset.findIndex))
    })

    this.element.append(form, this.matchCaseLabelEl, this.statusEl, this.listEl)
  }

  private handleEnter(backwards: boolean) {
    const query = this.inputEl.value
    const same =
      this.searched &&
      this.searched.query === query &&
      this.searched.matchCase === this.matchCaseEl.checked
    if (!same || this.result.hits.length === 0) {
      this.runSearch()
      if (this.result.hits.length > 0) this.navigateTo(0)
      return
    }
    const count = this.result.hits.length
    const next =
      this.activeIndex < 0
        ? 0
        : (this.activeIndex + (backwards ? count - 1 : 1)) % count
    this.navigateTo(next)
  }

  /** Searches the active layout of the current document. */
  private runSearch() {
    const view = this.editor.curView
    const db = this.editor.curDocument?.database
    const query = this.inputEl.value
    this.activeIndex = -1
    if (!view || !db || !query.trim()) {
      this.result = { hits: [], truncated: false }
      this.searched = undefined
      this.searchState = view && db ? 'idle' : 'no-document'
      this.renderResults()
      return
    }
    const layoutId = view.activeLayoutBtrId
    const matchCase = this.matchCaseEl.checked
    this.result = acuiFindTextInLayout(db, layoutId, query, { matchCase })
    this.searched = { query, matchCase, layoutId }
    this.searchState = 'done'
    this.renderResults()
  }

  private renderResults() {
    this.listEl.replaceChildren()
    const hits = this.result.hits
    if (this.searchState === 'no-document') {
      this.statusEl.textContent = this.i18n.t('findPalette.noDocument')
      return
    }
    if (this.searchState === 'idle') {
      this.statusEl.textContent = this.i18n.t('findPalette.hint')
      return
    }
    if (hits.length === 0) {
      this.statusEl.textContent = this.i18n.t('findPalette.noResults')
      return
    }
    const key = this.result.truncated
      ? 'findPalette.countTruncated'
      : 'findPalette.count'
    this.statusEl.textContent = this.i18n.t(key, { count: String(hits.length) })

    const query = this.searched?.query ?? ''
    const matchCase = this.searched?.matchCase ?? false
    hits.forEach((hit, index) => {
      const li = document.createElement('li')
      li.className = 'ml-ex-ui-find-row'
      li.dataset.findIndex = String(index)
      li.tabIndex = 0
      li.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          this.navigateTo(index)
        }
      })
      if (index === this.activeIndex) li.classList.add('is-selected')

      const text = document.createElement('div')
      text.className = 'ml-ex-ui-find-text'
      text.textContent = acuiFindExcerpt(hit.text, query, matchCase)
      text.title = hit.text

      const meta = document.createElement('div')
      meta.className = 'ml-ex-ui-find-meta'
      meta.textContent = this.describeHit(hit)

      li.append(text, meta)
      this.listEl.appendChild(li)
    })
  }

  /** `Type · layer · (x, y)` label for a hit. */
  private describeHit(hit: AcUiFindHit): string {
    let kind = this.i18n.t(`findPalette.kind.${hit.kind}`)
    if (hit.kind === 'attribute') {
      const owner = [hit.blockName, hit.tag].filter(Boolean).join(' / ')
      if (owner) kind = `${kind} ${owner}`
    }
    const at = `(${round(hit.position.x)}, ${round(hit.position.y)})`
    return `${kind} · ${hit.layer} · ${at}`
  }

  /** Zooms to the hit and selects its entity. */
  private navigateTo(index: number) {
    const view = this.editor.curView
    const db = this.editor.curDocument?.database
    const hit = this.result.hits[index]
    if (!view || !db || !hit || !this.searched) return

    // The layout changed since the search: results no longer apply.
    if (view.activeLayoutBtrId !== this.searched.layoutId) {
      this.runSearch()
      return
    }

    this.activeIndex = index
    const box = this.hitBox(hit, db)
    if (box) view.zoomTo(box, 1.1)
    view.selectionSet.clear()
    view.selectionSet.add(hit.entityId)

    this.listEl
      .querySelectorAll<HTMLElement>('li[data-find-index]')
      .forEach(row => {
        const active = Number(row.dataset.findIndex) === index
        row.classList.toggle('is-selected', active)
        if (active) row.scrollIntoView?.({ block: 'nearest' })
      })
  }

  /**
   * View box for a hit: the text extents, widened so a short label does not
   * zoom in absurdly far (at least ~10 text heights wide).
   */
  private hitBox(
    hit: AcUiFindHit,
    db: NonNullable<AcApDocManager['curDocument']>['database']
  ): AcGeBox2d | undefined {
    const btr = db.tables.blockTable.getIdAt(this.searched!.layoutId)
    const owner = btr?.getIdAt(hit.entityId)
    let target: { geometricExtents: { min: XY; max: XY } } | undefined =
      owner as unknown as { geometricExtents: { min: XY; max: XY } } | undefined
    const withAttributes = owner as unknown as
      | {
          attributeIterator?: () => Iterable<
            NonNullable<typeof target> & { objectId: string }
          >
        }
      | undefined
    if (hit.kind === 'attribute' && withAttributes?.attributeIterator) {
      for (const attribute of withAttributes.attributeIterator()) {
        if (attribute.objectId === hit.textEntityId) {
          target = attribute
          break
        }
      }
    }
    let min: XY
    let max: XY
    try {
      const extents = target?.geometricExtents
      if (!extents || !isFinite(extents.min.x) || !isFinite(extents.max.x)) {
        throw new Error('no extents')
      }
      min = extents.min
      max = extents.max
    } catch {
      min = max = hit.position
    }
    const cx = (min.x + max.x) / 2
    const cy = (min.y + max.y) / 2
    const w = max.x - min.x
    const h = max.y - min.y
    const width = Math.max(w * 3, h * 10, 1e-3)
    const height = Math.max(h * 3, width / 4, 1e-3)
    return new AcGeBox2d(
      new AcGePoint2d(cx - width / 2, cy - height / 2),
      new AcGePoint2d(cx + width / 2, cy + height / 2)
    )
  }
}

type XY = { x: number; y: number }

function round(value: number): string {
  return String(Math.round(value * 100) / 100)
}
