/**
 * Text search over the entities of one layout (FIND).
 *
 * Shared by every UI (cad-simple-ui-plugin, the full Vue cad-viewer) so that
 * both behave identically. Pure TypeScript with no runtime imports, published
 * as the `@mlightcad/cad-simple-viewer/find` subpath.
 *
 * Searched fields (see the cad-simple-ui-plugin `README.md` → "Find text"):
 * - `TEXT` — `textString`
 * - `MTEXT` — `contents` with MTEXT formatting codes removed
 * - `ATTRIB` — attribute value (`textString`) of every `INSERT` in the layout
 *   (the tag is reported for display but is not searched)
 *
 * Only top-level entities of the given block table record are visited, in one
 * synchronous pass per search. Text inside block definitions (non-attribute),
 * dimension text, leaders, tables and xrefs is not searched.
 *
 * The module is structural (no `instanceof`) so it can be unit tested with
 * plain objects.
 */

/** Maximum number of hits returned by one search. */
export const ACAP_FIND_MAX_RESULTS = 500

/** Kind of entity that produced a hit. */
export type AcApFindHitKind = 'text' | 'mtext' | 'attribute'

/** Options for {@link acapFindTextInLayout}. */
export interface AcApFindOptions {
  /**
   * When true the query must match case and accents exactly. When false
   * (default) case, accents (diacritics) and runs of whitespace are ignored.
   */
  matchCase?: boolean
  /** Maximum hits to return; defaults to {@link ACAP_FIND_MAX_RESULTS}. */
  maxResults?: number
}

/** One match returned by {@link acapFindTextInLayout}. */
export interface AcApFindHit {
  /** Entity that is zoomed to and selected (the `INSERT` for attributes). */
  entityId: string
  /** Entity that owns the matched text (the attribute itself for attributes). */
  textEntityId: string
  kind: AcApFindHitKind
  /** Plain text that matched (formatting codes removed, whitespace collapsed). */
  text: string
  /** Attribute tag, for `attribute` hits. */
  tag?: string
  /** Block name of the owning `INSERT`, for `attribute` hits. */
  blockName?: string
  layer: string
  /** Insertion point of the text in WCS. */
  position: { x: number; y: number }
}

/** Result of one search. */
export interface AcApFindResult {
  hits: AcApFindHit[]
  /** True when more than `maxResults` entities matched. */
  truncated: boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type EntityLike = any
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Minimal database shape used by the search. */
export interface AcApFindDatabaseLike {
  tables: {
    blockTable: {
      getIdAt(id: string):
        | {
            newIterator(): Iterable<EntityLike>
            /** Used to resolve the matched entity for zoom extents. */
            getIdAt?(id: string): EntityLike
          }
        | undefined
    }
    layerTable?: {
      getAt(name: string): { isOff?: boolean; isFrozen?: boolean } | undefined
    }
  }
}

const DIACRITICS = /[̀-ͯ]/g
const WHITESPACE = /\s+/g

/**
 * Normalizes text or a query for comparison.
 *
 * - always: NFKC, whitespace runs → one space, trimmed
 * - unless `matchCase`: accents removed, lower-cased
 */
export function acapNormalizeFindText(
  value: string,
  matchCase = false
): string {
  let result = value.normalize('NFKC').replace(WHITESPACE, ' ').trim()
  if (!matchCase) {
    result = result.normalize('NFD').replace(DIACRITICS, '').toLowerCase()
  }
  return result
}

/**
 * Converts MTEXT contents to plain text: removes formatting codes
 * (`\f…;`, `\H…;`, `\C…;`, `\L \l \O \o \K \k`, braces), turns `\P` into a
 * space, decodes `\~`, `\U+XXXX`, stacked fractions and `%%c %%d %%p`.
 */
export function acapMTextToPlainText(contents: string): string {
  const text = contents.replace(
    /\\(U\+[0-9a-fA-F]{4}|[PX~]|S[^;]*;|[fFHWTQCcAaRrp][^;]*;|[LlOoKk]|[\\{}])|[{}]/g,
    (_match, code: string | undefined) => {
      if (!code) return '' // bare group brace
      if (code.startsWith('U+'))
        return String.fromCharCode(parseInt(code.slice(2), 16))
      if (code === 'P' || code === 'X' || code === '~') return ' '
      if (code === '\\' || code === '{' || code === '}') return code
      if (code[0] === 'S') {
        const stack = /^S([^;^#/]*)[\^#/]?([^;]*);$/.exec(code)
        return stack ? (stack[2] ? `${stack[1]}/${stack[2]}` : stack[1]) : ''
      }
      return '' // font, height, colour, underline… codes
    }
  )
  return decodeControlCodes(text).replace(WHITESPACE, ' ').trim()
}

/** Decodes `%%c`, `%%d`, `%%p` special-character codes. */
function decodeControlCodes(value: string): string {
  return value
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
}

function plainText(value: unknown): string {
  return typeof value === 'string'
    ? decodeControlCodes(value)
        .normalize('NFKC')
        .replace(WHITESPACE, ' ')
        .trim()
    : ''
}

function isLayerSearchable(
  db: AcApFindDatabaseLike,
  layerName: string,
  cache: Map<string, boolean>
): boolean {
  const cached = cache.get(layerName)
  if (cached !== undefined) return cached
  const layer = db.tables.layerTable?.getAt(layerName)
  const searchable = !(layer?.isOff || layer?.isFrozen)
  cache.set(layerName, searchable)
  return searchable
}

function pointOf(entity: EntityLike): { x: number; y: number } {
  const p = entity.position ?? entity.location ?? { x: 0, y: 0 }
  return { x: Number(p.x) || 0, y: Number(p.y) || 0 }
}

/**
 * Finds text in the entities of one block table record (a layout).
 *
 * Entities that are invisible or sit on an off/frozen layer are skipped so
 * that results always correspond to something the user can see.
 *
 * @param db - Database owning the layout.
 * @param layoutBtrId - Block table record id of the layout (model/paper space).
 * @param query - User query; blank queries return no hits.
 */
export function acapFindTextInLayout(
  db: AcApFindDatabaseLike,
  layoutBtrId: string,
  query: string,
  options: AcApFindOptions = {}
): AcApFindResult {
  const matchCase = options.matchCase === true
  const max = options.maxResults ?? ACAP_FIND_MAX_RESULTS
  const needle = acapNormalizeFindText(query, matchCase)
  const result: AcApFindResult = { hits: [], truncated: false }
  if (!needle) return result

  const btr = db.tables.blockTable.getIdAt(layoutBtrId)
  if (!btr) return result

  const layers = new Map<string, boolean>()
  const matches = (text: string) =>
    text !== '' && acapNormalizeFindText(text, matchCase).includes(needle)

  const push = (hit: AcApFindHit): boolean => {
    if (result.hits.length >= max) {
      result.truncated = true
      return false
    }
    result.hits.push(hit)
    return true
  }

  for (const entity of btr.newIterator()) {
    const type: string | undefined = entity.dxfTypeName
    if (type !== 'TEXT' && type !== 'MTEXT' && type !== 'INSERT') continue
    if (entity.visibility === false) continue
    if (!isLayerSearchable(db, entity.layer, layers)) continue

    if (type === 'INSERT') {
      const attributes = entity.attributeIterator?.()
      if (!attributes) continue
      for (const attribute of attributes) {
        if (attribute.visibility === false || attribute.isInvisible) continue
        const text = plainText(attribute.textString)
        if (!matches(text)) continue
        const ok = push({
          entityId: entity.objectId,
          textEntityId: attribute.objectId,
          kind: 'attribute',
          text,
          tag: attribute.tag,
          blockName: entity.blockName,
          layer: entity.layer,
          position: pointOf(attribute)
        })
        if (!ok) return result
      }
      continue
    }

    const text =
      type === 'MTEXT'
        ? acapMTextToPlainText(String(entity.contents ?? ''))
        : plainText(entity.textString)
    if (!matches(text)) continue
    const ok = push({
      entityId: entity.objectId,
      textEntityId: entity.objectId,
      kind: type === 'MTEXT' ? 'mtext' : 'text',
      text,
      layer: entity.layer,
      position: pointOf(entity)
    })
    if (!ok) return result
  }
  return result
}

/** Returns a short excerpt of `text` centred on the first match of `query`. */
export function acapFindExcerpt(
  text: string,
  query: string,
  matchCase = false,
  width = 60
): string {
  if (text.length <= width) return text
  const needle = acapNormalizeFindText(query, matchCase)
  // Normalization may change length (accents, NFKC); fall back to the head.
  const index = acapNormalizeFindText(text, matchCase).indexOf(needle)
  const start = Math.max(0, Math.min(index - 15, text.length - width))
  const slice = text.slice(start, start + width)
  return `${start > 0 ? '…' : ''}${slice}${start + width < text.length ? '…' : ''}`
}
