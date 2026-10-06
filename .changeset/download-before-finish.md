---
'styled-map-package-api': minor
'styled-map-package': minor
---

`download()` takes a `beforeFinish(writer, { signal, glyphRanges })` option for adding resources that aren't downloaded, such as sprites for layers added to a style object, tiles for a local overlay source, or local fonts. Reference them in the style with `smp:` URLs from the newly exported `getSpriteUri()`, `TILE_URI` and `GLYPH_URI`: `StyleDownloader` no longer tries to download sprites, tiles or glyphs with `smp:` URLs, and rejects `smp:` URLs it can't skip, such as a source `url` or GeoJSON `data`.
