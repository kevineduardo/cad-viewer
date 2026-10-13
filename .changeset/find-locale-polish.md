---
'@mlightcad/cad-simple-ui-plugin': patch
'@mlightcad/cad-viewer': patch
---

fix(find): polish the FIND UI text. Block text, dimension, leader and table hit types are translated in the plugin (they showed raw keys before) and a message missing from the active locale falls back to English. The FIND hints and command description list everything that is searched. Arabic result counts use the six CLDR plural forms in the Vue UI (`pluralRules`). A layout with an empty name is shown as a localized "(unnamed layout)" placeholder, and the "could not open layout" note still appears for it. Ctrl/Cmd+F with the page body focused still opens the Find palette (now covered by a test)
