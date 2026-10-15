import { AcDbDatabase } from '@mlightcad/data-model'

/**
 * Makes every block table record owned by the block table.
 *
 * Some DWG files store `*MODEL_SPACE` with a wrong owner id (its own handle).
 * `blockTable.getIdAt` checks the owner, so such a record cannot be looked up
 * by id although it is in the table and drawn: FIND never searched model
 * space, and switching back to the Model layout threw from
 * `database.currentSpaceId`.
 *
 * @returns Number of records that were re-parented.
 */
export function acapRepairBlockTableOwners(db: AcDbDatabase): number {
  const blockTable = db.tables.blockTable
  let repaired = 0
  for (const record of blockTable.newIterator()) {
    if (record.ownerId !== blockTable.objectId) {
      record.ownerId = blockTable.objectId
      repaired++
    }
  }
  return repaired
}
