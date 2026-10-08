import {
  acdbHostApplicationServices,
  AcGeBox2d,
  AcGePoint2d
} from '@mlightcad/data-model'

import type { AcApDocManager } from '../app/AcApDocManager'
import { acapFindHitBox, type AcApFindLayoutHit } from './findDrawing'

/** Options for {@link acapNavigateToFindHit}. */
export interface AcApFindNavigateOptions {
  /**
   * Activate the hit's layout when it is not the active one. Default `true`.
   * When `false` a cross-layout hit is not navigated and `layout-mismatch`
   * is returned.
   */
  activateLayout?: boolean
  /** Margin passed to `zoomTo`. Default `1.1`. */
  margin?: number
  /**
   * Maximum time (ms) to wait for the freshly activated layout to finish
   * converting before zooming and selecting. Default 15000.
   */
  idleTimeoutMs?: number
}

/**
 * Outcome of {@link acapNavigateToFindHit}.
 *
 * - `navigated`: layout (if needed) activated, view zoomed, entity selected
 * - `layout-mismatch`: hit is in another layout and `activateLayout` is false
 * - `layout-missing`: the hit's layout no longer exists in the drawing
 * - `layout-switch-failed`: the layout manager refused / did not switch
 * - `no-document`: no open drawing or view
 * - `stale`: a newer navigation started while waiting; nothing was done
 */
export type AcApFindNavigateResult =
  | 'navigated'
  | 'layout-mismatch'
  | 'layout-missing'
  | 'layout-switch-failed'
  | 'no-document'
  | 'stale'

const navigationTokens = new WeakMap<object, number>()

/**
 * Navigates to a FIND hit: activates its layout when needed, zooms to the text
 * and selects the owning entity.
 *
 * Same-layout hits are handled synchronously (before the first `await`), so
 * callers may ignore the returned promise in that case. For a hit in another
 * layout the layout is activated through the document's layout manager; the
 * first-visit auto zoom of that layout is suppressed (it would otherwise
 * override this zoom), then the function waits for the layout's entities to
 * be converted before selecting, because selection highlighting needs the
 * entity to be present in the scene.
 *
 * @param editor - Document manager that owns the active view and drawing.
 * @param hit - Hit returned by `acapFindText`.
 */
export async function acapNavigateToFindHit(
  editor: AcApDocManager,
  hit: AcApFindLayoutHit,
  options: AcApFindNavigateOptions = {}
): Promise<AcApFindNavigateResult> {
  const view = editor.curView
  const db = editor.curDocument?.database
  if (!view || !db) return 'no-document'

  const token = (navigationTokens.get(view) ?? 0) + 1
  navigationTokens.set(view, token)

  if (view.activeLayoutBtrId !== hit.layoutId) {
    if (options.activateLayout === false) return 'layout-mismatch'
    if (!db.tables.blockTable.getIdAt(hit.layoutId)) return 'layout-missing'

    if (!view.isLayoutInitialized(hit.layoutId)) {
      // We frame the layout ourselves; keep its first-visit auto zoom from
      // running afterwards and overriding the zoom to the hit.
      view.markLayoutAsInitialized(hit.layoutId)
    }
    acdbHostApplicationServices().layoutManager.setCurrentLayoutBtrId(
      hit.layoutId,
      db
    )
    if (view.activeLayoutBtrId !== hit.layoutId) return 'layout-switch-failed'

    await view.waitUntilIdle(options.idleTimeoutMs ?? 15_000)
    if (navigationTokens.get(view) !== token) return 'stale'
    if (view.activeLayoutBtrId !== hit.layoutId) return 'stale'
  }

  const box = acapFindHitBox(db, hit.layoutId, hit)
  view.zoomTo(
    new AcGeBox2d(
      new AcGePoint2d(box.min.x, box.min.y),
      new AcGePoint2d(box.max.x, box.max.y)
    ),
    options.margin ?? 1.1
  )
  view.selectionSet.clear()
  view.selectionSet.add(hit.entityId)
  return 'navigated'
}
