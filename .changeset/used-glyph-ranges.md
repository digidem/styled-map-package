---
'styled-map-package-api': minor
'styled-map-package': minor
---

`download()` now only downloads the glyph ranges needed for labels in the downloaded tiles, which can cut glyph data by more than half, and marks the package with `metadata['smp:glyphRanges']: 'used'`. Pass `allGlyphRanges: true` (or `--all-glyph-ranges` on the CLI) to download every range as before. Adds `GlyphRangeCollector`, a `ranges` option to `StyleDownloader#getGlyphs()` and an `onTileData` option to `getTiles()`, `downloadTiles()` and `downloadPmtilesTiles()`.

Custom `fallbackGlyph` handlers now receive the package style as a third argument, e.g. to handle missing ranges in packages marked with `smp:glyphRanges: 'used'`. Adds `Writer#setMetadata()`.

`validate()` now reads the vector tiles and GeoJSON in a package and only warns about missing glyph ranges (`incomplete_font_glyphs`) that labels actually use, instead of requiring every range. Pass `glyphCoverage: false` (or `smp validate --no-glyph-coverage`) to skip reading tiles. `validate()` also no longer throws on packages written with `dedupe: true`.
