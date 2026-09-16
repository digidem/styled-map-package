---
'styled-map-package-api': patch
'styled-map-package': patch
---

Limit the total amount of tile and GeoJSON data `validate()` decompresses for the glyph coverage check, so small archives that expand hugely can't make it run for hours. Download every glyph range for vector sources that are not MVT, which can't be scanned. The style passed to `fallbackGlyph` is now shared and frozen rather than copied for every request, and its documentation no longer describes a 404 default.
