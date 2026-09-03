---
'styled-map-package-api': patch
---

Fix `createTileWriteStream()` and `createGlyphWriteStream()` silently dropping errors thrown by `addTile()` / `addGlyphs()` when the error settled before the stream was closed.
