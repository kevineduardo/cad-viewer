import { AcDbDatabase } from '@mlightcad/data-model'

import { acapRepairBlockTableOwners } from '../src/util/AcApRepairBlockTableOwners'

describe('acapRepairBlockTableOwners', () => {
  it('re-parents a block table record whose owner id is wrong', () => {
    const db = new AcDbDatabase()
    const blockTable = db.tables.blockTable
    const modelSpace = blockTable.modelSpace
    // Seen in real DWG files: *MODEL_SPACE owned by its own handle.
    modelSpace.ownerId = modelSpace.objectId
    expect(blockTable.getIdAt(modelSpace.objectId)).toBeUndefined()

    expect(acapRepairBlockTableOwners(db)).toBe(1)

    expect(modelSpace.ownerId).toBe(blockTable.objectId)
    expect(blockTable.getIdAt(modelSpace.objectId)).toBe(modelSpace)
    expect(() => {
      db.currentSpaceId = modelSpace.objectId
    }).not.toThrow()
  })

  it('leaves well-formed block tables untouched', () => {
    const db = new AcDbDatabase()
    const modelSpace = db.tables.blockTable.modelSpace
    expect(acapRepairBlockTableOwners(db)).toBe(0)
    expect(modelSpace.ownerId).toBe(db.tables.blockTable.objectId)
  })
})
