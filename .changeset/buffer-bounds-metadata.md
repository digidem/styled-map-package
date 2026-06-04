---
'styled-map-package-api': minor
'styled-map-package': minor
---

Optionally add a tile buffer to improve offline viewing.

Buffer tiles are extra tile rings downloaded around the requested area at each zoom level below maxzoom, so the map is not clipped at the edges of the downloaded area when zooming out. The buffer is not applied at maxzoom, where it would add disk overhead without improving viewport coverage.

- Adds a `bufferTiles` option (a non-negative integer ring count, default `0`) to `download()`, `StyleDownloader#getTiles`, `downloadTiles`, `downloadPmtilesTiles`, and `tileIterator`. Replaces the previous boolean `boundsBuffer`. Exposed on the CLI as the boolean flag `smp download --buffer-tiles` (one ring).
- Records the buffer in the style metadata as `smp:bufferTiles` (new spec §4.3.4). The `Writer` infers this value from the tiles it receives — the number of extra tile rings that extend beyond the max-zoom `bounds`.
- Adds an `expandBounds` option to `createServer`, enabled by default. When the package has `smp:bufferTiles` metadata, each tile source's `bounds` is widened to the whole world in the served `style.json` (the stored file is unchanged), so the lower-zoom buffer tiles are rendered. Combined with the default empty-tile fallback, this serves empty tiles outside the downloaded area. Pass `expandBounds: false` to disable.
- `createServer` now defaults `fallbackTile`/`fallbackGlyph` to the built-in empty fallbacks, so a plain `createServer()` serves empty tiles/glyphs for missing resources instead of returning 404. Pass `null` for either option to restore 404 behavior.
- `smp view` now enables `expandBounds` and serves empty-tile/glyph fallbacks by default. The previous `-f, --fallback` flag is replaced by `--no-fallback` to opt out.
