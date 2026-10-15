---
'@mlightcad/cad-simple-viewer': patch
---

fix: FIND now searches model space in DWG files whose `*MODEL_SPACE` block table record has a wrong owner id (previously such drawings returned no model-space results, and switching back to the Model layout threw). Block table record owners are repaired when a document opens, and the find module resolves layout records even when `blockTable.getIdAt` rejects them
