---
'styled-map-package-api': patch
'styled-map-package': patch
---

Limit how far each tile and GeoJSON file may expand when `validate()` decompresses it for the glyph coverage check, instead of capping the total across the archive, and stream the decompression rather than buffering the compressed data first.
