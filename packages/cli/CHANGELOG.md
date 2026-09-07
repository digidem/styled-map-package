# styled-map-package

## 6.0.1

### Patch Changes

- Updated dependencies [[`a8252f3`](https://github.com/digidem/styled-map-package/commit/a8252f3d620839f850ac21055aa79421dae32de5), [`c628935`](https://github.com/digidem/styled-map-package/commit/c628935ebe1fd200d4c4eb61fd7e4ccf2ed7eae2)]:
  - styled-map-package-api@6.0.1

## 6.0.0

### Major Changes

- [#116](https://github.com/digidem/styled-map-package/pull/116) [`afe8531`](https://github.com/digidem/styled-map-package/commit/afe8531fb721853875f96e9daadf44470de0790c) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Drop support for Node 18 and Node 20, both of which are past end of life. All
  packages now declare `"engines": { "node": ">=22" }` and are tested against Node
  22 and 24 only.

### Patch Changes

- [#117](https://github.com/digidem/styled-map-package/pull/117) [`e4920e8`](https://github.com/digidem/styled-map-package/commit/e4920e82cd664dd08dc5d26c73785595ce6c3f51) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Update dependencies now that Node 18 and 20 are no longer supported. Notably
  Vitest 4, Vite 8, ESLint 10, `@maplibre/maplibre-gl-style-spec` 26, `ky` 2,
  `commander` 15, `@inquirer/prompts` 8 and `@mapbox/sphericalmercator` 2.
- Updated dependencies [[`00b4d19`](https://github.com/digidem/styled-map-package/commit/00b4d191a76dc016d244e3171da760cccf706df4), [`c8b9c21`](https://github.com/digidem/styled-map-package/commit/c8b9c212ab8162223370f9e20d2d34518754e5cb), [`afe8531`](https://github.com/digidem/styled-map-package/commit/afe8531fb721853875f96e9daadf44470de0790c), [`e44d64b`](https://github.com/digidem/styled-map-package/commit/e44d64b602c64aa72085f88eda27976202b774b4), [`e4920e8`](https://github.com/digidem/styled-map-package/commit/e4920e82cd664dd08dc5d26c73785595ce6c3f51)]:
  - styled-map-package-api@6.0.0
  - smp-noto-glyphs@2.0.0

## 5.0.0

### Major Changes

- [#72](https://github.com/digidem/styled-map-package/pull/72) [`9ec4b11`](https://github.com/digidem/styled-map-package/commit/9ec4b11e6ca254535b3d99714918e264837096d5) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Restructure into npm workspaces monorepo with separate packages for the JS API (`styled-map-package-api`) and CLI (`styled-map-package`).

- [#105](https://github.com/digidem/styled-map-package/pull/105) [`45e1767`](https://github.com/digidem/styled-map-package/commit/45e17678d68c9fc25010d66d93f409d077aa0c3e) Thanks [@gmaclennan](https://github.com/gmaclennan)! - API cleanup for consistency: accessToken -> mapboxAccessToken and download now cleans up resources on cancel.

### Minor Changes

- [#92](https://github.com/digidem/styled-map-package/pull/92) [`799c2fd`](https://github.com/digidem/styled-map-package/commit/799c2fd1169d8efc84db310557d7b5d6a8f5ddc9) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add fallback tile and glyph handlers for serving missing resources from SMP files. `emptyTileFallback` returns format-aware empty tiles (gzipped MVT, transparent PNG/WebP). `emptyGlyphFallback` returns empty PBFs so MapLibre renders blank space instead of 404 errors. Add `--fallback` flag to `smp view` command.

- [#108](https://github.com/digidem/styled-map-package/pull/108) [`cdf12bb`](https://github.com/digidem/styled-map-package/commit/cdf12bb10c800ad2dac95d3d4cdc988d3098731b) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Optionally add a tile buffer to improve offline viewing.

  Buffer tiles are extra tile rings downloaded around the requested area at each zoom level below maxzoom, so the map is not clipped at the edges of the downloaded area when zooming out. The buffer is not applied at maxzoom, where it would add disk overhead without improving viewport coverage.
  - Adds a `bufferTiles` option (a non-negative integer ring count, default `0`) to `download()`, `StyleDownloader#getTiles`, `downloadTiles`, `downloadPmtilesTiles`, and `tileIterator`. Replaces the previous boolean `boundsBuffer`. Exposed on the CLI as the boolean flag `smp download --buffer-tiles` (one ring).
  - Records the buffer in the style metadata as `smp:bufferTiles` (new spec §4.3.4). The `Writer` infers this value from the tiles it receives — the number of extra tile rings that extend beyond the max-zoom `bounds`.
  - Adds an `expandBounds` option to `createServer`, enabled by default. When the package has `smp:bufferTiles` metadata, each tile source's `bounds` is widened to the whole world in the served `style.json` (the stored file is unchanged), so the lower-zoom buffer tiles are rendered. Combined with the default empty-tile fallback, this serves empty tiles outside the downloaded area. Pass `expandBounds: false` to disable.
  - `createServer` now defaults `fallbackTile`/`fallbackGlyph` to the built-in empty fallbacks, so a plain `createServer()` serves empty tiles/glyphs for missing resources instead of returning 404. Pass `null` for either option to restore 404 behavior.
  - `smp view` now enables `expandBounds` and serves empty-tile/glyph fallbacks by default. The previous `-f, --fallback` flag is replaced by `--no-fallback` to opt out.

- [#97](https://github.com/digidem/styled-map-package/pull/97) [`4cc7a88`](https://github.com/digidem/styled-map-package/commit/4cc7a88f2ce4696711210b71feeffb414b61c8c4) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add `--dedupe` flag to `smp download` CLI command and `dedupe` option to the `download()` API, exposing the Writer's tile deduplication to reduce file size for maps with many repeated tiles.

- [#110](https://github.com/digidem/styled-map-package/pull/110) [`71ef5ab`](https://github.com/digidem/styled-map-package/commit/71ef5ab9e36be13e89729ab0fb0c4961abd684f9) Thanks [@gmaclennan](https://github.com/gmaclennan)! - serve fallback glyphs for packages whose style has no glyphs

  When a style has no labels it is packaged without a `glyphs` property, and the
  server previously returned 404 for any glyph request. With `fallbackGlyph` set
  (the default), glyph requests are now served at the standard SMP glyph path and
  the served `style.json` advertises that path, so a client can add its own symbol
  layer to such a map and get fallback glyphs. The stored `style.json` is
  unchanged, and `fallbackGlyph: null` restores the previous behaviour.

- [#93](https://github.com/digidem/styled-map-package/pull/93) [`8efbb36`](https://github.com/digidem/styled-map-package/commit/8efbb36d0b96977b83c687339429fa92a62737a3) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add `validate()` function and `smp validate` CLI command for checking `.smp` files against the specification.

  The validator returns structured issues with `kind` (error/warning), `severity` (fatal/rendering/spec), a stable `type` identifier, and a `path` for location context. Results include `valid` (spec-compliant) and `usable` (no fatal issues) booleans.

  Checks include: ZIP validity, VERSION file, style.json conformance, SMP metadata validation, tile completeness and format consistency, glyph template and per-font range coverage, sprite file verification, external resource detection, and entry name safety.

  Spec updates:
  - §4.2.2: resource URLs MUST use SMP URIs (upgraded from SHOULD)
  - §4.3.2: `smp:maxzoom` value MUST be between 0 and 30
  - §8.2: writers MUST fetch and store external GeoJSON data (upgraded from SHOULD)

- [#95](https://github.com/digidem/styled-map-package/pull/95) [`9fc6faf`](https://github.com/digidem/styled-map-package/commit/9fc6faf6a120e0a5bed5157a681226ea1353a280) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Exclude locally-rendered glyph ranges from validation and downloads. MapLibre GL renders CJK, Hangul, Kana, Yi, and Halfwidth/Fullwidth glyphs client-side via `localIdeographFontFamily`, so SMP files do not need to include these 163 of 256 glyph ranges. Adds `skipLocalGlyphs` option to `download()` and `--skip-local-glyphs` CLI flag. Validator glyph completeness check now only counts the 93 required ranges.

### Patch Changes

- [#75](https://github.com/digidem/styled-map-package/pull/75) [`14cf062`](https://github.com/digidem/styled-map-package/commit/14cf06279b934b6e8619e4772e21470ca9cc4d54) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add package READMEs

- [#106](https://github.com/digidem/styled-map-package/pull/106) [`8f47ccc`](https://github.com/digidem/styled-map-package/commit/8f47ccc4a0dc2cb893a9eb2c75f0fa5011994def) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Document map source `attribution` in the format spec (Section 5.7) and display a compact attribution control in `smp view`. Source `attribution` — including credits inlined from TileJSON and MBTiles metadata — is preserved through write/read, and the map viewer now renders it.

- Updated dependencies [[`d30d241`](https://github.com/digidem/styled-map-package/commit/d30d241e301a985c0f74ef36d8129fa097008445), [`799c2fd`](https://github.com/digidem/styled-map-package/commit/799c2fd1169d8efc84db310557d7b5d6a8f5ddc9), [`cdf12bb`](https://github.com/digidem/styled-map-package/commit/cdf12bb10c800ad2dac95d3d4cdc988d3098731b), [`5ec8ecf`](https://github.com/digidem/styled-map-package/commit/5ec8ecfba91cef52ce9d2a60a9e640a0efa42505), [`609af6d`](https://github.com/digidem/styled-map-package/commit/609af6d0c795901d089022d158cdeb50bdace5a9), [`c8b219c`](https://github.com/digidem/styled-map-package/commit/c8b219cffb35a3a45ff58d814d233420dd0c77a8), [`4cc7a88`](https://github.com/digidem/styled-map-package/commit/4cc7a88f2ce4696711210b71feeffb414b61c8c4), [`71ef5ab`](https://github.com/digidem/styled-map-package/commit/71ef5ab9e36be13e89729ab0fb0c4961abd684f9), [`911d64d`](https://github.com/digidem/styled-map-package/commit/911d64dfd4b20ada924f2a038abdf333c1c8259a), [`6ce4486`](https://github.com/digidem/styled-map-package/commit/6ce44864e4a8f971f92840547f452da58a13072c), [`9ec4b11`](https://github.com/digidem/styled-map-package/commit/9ec4b11e6ca254535b3d99714918e264837096d5), [`4e1f56c`](https://github.com/digidem/styled-map-package/commit/4e1f56ce8c58a06545636a8fba4153b812bced67), [`14cf062`](https://github.com/digidem/styled-map-package/commit/14cf06279b934b6e8619e4772e21470ca9cc4d54), [`b64c456`](https://github.com/digidem/styled-map-package/commit/b64c45635363d034afd61cb5a6e62284c4a94666), [`45e1767`](https://github.com/digidem/styled-map-package/commit/45e17678d68c9fc25010d66d93f409d077aa0c3e), [`8efbb36`](https://github.com/digidem/styled-map-package/commit/8efbb36d0b96977b83c687339429fa92a62737a3), [`9fc6faf`](https://github.com/digidem/styled-map-package/commit/9fc6faf6a120e0a5bed5157a681226ea1353a280), [`0513081`](https://github.com/digidem/styled-map-package/commit/0513081582e8e1ba3887a565a3f1615dcb664692), [`8f47ccc`](https://github.com/digidem/styled-map-package/commit/8f47ccc4a0dc2cb893a9eb2c75f0fa5011994def), [`03e43f6`](https://github.com/digidem/styled-map-package/commit/03e43f613a1835b45ae4938c96bb7363d8053566), [`799c2fd`](https://github.com/digidem/styled-map-package/commit/799c2fd1169d8efc84db310557d7b5d6a8f5ddc9), [`5f23127`](https://github.com/digidem/styled-map-package/commit/5f23127b496791d79d195507f2142c4d6c7fc2b6)]:
  - styled-map-package-api@5.0.0
  - smp-noto-glyphs@1.0.0

## 5.0.0-pre.5

### Major Changes

- [#105](https://github.com/digidem/styled-map-package/pull/105) [`45e1767`](https://github.com/digidem/styled-map-package/commit/45e17678d68c9fc25010d66d93f409d077aa0c3e) Thanks [@gmaclennan](https://github.com/gmaclennan)! - API cleanup for consistency: accessToken -> mapboxAccessToken and download now cleans up resources on cancel.

### Minor Changes

- [#108](https://github.com/digidem/styled-map-package/pull/108) [`cdf12bb`](https://github.com/digidem/styled-map-package/commit/cdf12bb10c800ad2dac95d3d4cdc988d3098731b) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Optionally add a tile buffer to improve offline viewing.

  Buffer tiles are extra tile rings downloaded around the requested area at each zoom level below maxzoom, so the map is not clipped at the edges of the downloaded area when zooming out. The buffer is not applied at maxzoom, where it would add disk overhead without improving viewport coverage.
  - Adds a `bufferTiles` option (a non-negative integer ring count, default `0`) to `download()`, `StyleDownloader#getTiles`, `downloadTiles`, `downloadPmtilesTiles`, and `tileIterator`. Replaces the previous boolean `boundsBuffer`. Exposed on the CLI as the boolean flag `smp download --buffer-tiles` (one ring).
  - Records the buffer in the style metadata as `smp:bufferTiles` (new spec §4.3.4). The `Writer` infers this value from the tiles it receives — the number of extra tile rings that extend beyond the max-zoom `bounds`.
  - Adds an `expandBounds` option to `createServer`, enabled by default. When the package has `smp:bufferTiles` metadata, each tile source's `bounds` is widened to the whole world in the served `style.json` (the stored file is unchanged), so the lower-zoom buffer tiles are rendered. Combined with the default empty-tile fallback, this serves empty tiles outside the downloaded area. Pass `expandBounds: false` to disable.
  - `createServer` now defaults `fallbackTile`/`fallbackGlyph` to the built-in empty fallbacks, so a plain `createServer()` serves empty tiles/glyphs for missing resources instead of returning 404. Pass `null` for either option to restore 404 behavior.
  - `smp view` now enables `expandBounds` and serves empty-tile/glyph fallbacks by default. The previous `-f, --fallback` flag is replaced by `--no-fallback` to opt out.

### Patch Changes

- [#106](https://github.com/digidem/styled-map-package/pull/106) [`8f47ccc`](https://github.com/digidem/styled-map-package/commit/8f47ccc4a0dc2cb893a9eb2c75f0fa5011994def) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Document map source `attribution` in the format spec (Section 5.7) and display a compact attribution control in `smp view`. Source `attribution` — including credits inlined from TileJSON and MBTiles metadata — is preserved through write/read, and the map viewer now renders it.

- Updated dependencies [[`cdf12bb`](https://github.com/digidem/styled-map-package/commit/cdf12bb10c800ad2dac95d3d4cdc988d3098731b), [`b64c456`](https://github.com/digidem/styled-map-package/commit/b64c45635363d034afd61cb5a6e62284c4a94666), [`45e1767`](https://github.com/digidem/styled-map-package/commit/45e17678d68c9fc25010d66d93f409d077aa0c3e), [`0513081`](https://github.com/digidem/styled-map-package/commit/0513081582e8e1ba3887a565a3f1615dcb664692), [`8f47ccc`](https://github.com/digidem/styled-map-package/commit/8f47ccc4a0dc2cb893a9eb2c75f0fa5011994def)]:
  - styled-map-package-api@5.0.0-pre.5
  - smp-noto-glyphs@1.0.0-pre.1

## 5.0.0-pre.4

### Minor Changes

- [#92](https://github.com/digidem/styled-map-package/pull/92) [`799c2fd`](https://github.com/digidem/styled-map-package/commit/799c2fd1169d8efc84db310557d7b5d6a8f5ddc9) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add fallback tile and glyph handlers for serving missing resources from SMP files. `emptyTileFallback` returns format-aware empty tiles (gzipped MVT, transparent PNG/WebP). `emptyGlyphFallback` returns empty PBFs so MapLibre renders blank space instead of 404 errors. Add `--fallback` flag to `smp view` command.

- [#97](https://github.com/digidem/styled-map-package/pull/97) [`4cc7a88`](https://github.com/digidem/styled-map-package/commit/4cc7a88f2ce4696711210b71feeffb414b61c8c4) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add `--dedupe` flag to `smp download` CLI command and `dedupe` option to the `download()` API, exposing the Writer's tile deduplication to reduce file size for maps with many repeated tiles.

- [#93](https://github.com/digidem/styled-map-package/pull/93) [`8efbb36`](https://github.com/digidem/styled-map-package/commit/8efbb36d0b96977b83c687339429fa92a62737a3) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add `validate()` function and `smp validate` CLI command for checking `.smp` files against the specification.

  The validator returns structured issues with `kind` (error/warning), `severity` (fatal/rendering/spec), a stable `type` identifier, and a `path` for location context. Results include `valid` (spec-compliant) and `usable` (no fatal issues) booleans.

  Checks include: ZIP validity, VERSION file, style.json conformance, SMP metadata validation, tile completeness and format consistency, glyph template and per-font range coverage, sprite file verification, external resource detection, and entry name safety.

  Spec updates:
  - §4.2.2: resource URLs MUST use SMP URIs (upgraded from SHOULD)
  - §4.3.2: `smp:maxzoom` value MUST be between 0 and 30
  - §8.2: writers MUST fetch and store external GeoJSON data (upgraded from SHOULD)

- [#95](https://github.com/digidem/styled-map-package/pull/95) [`9fc6faf`](https://github.com/digidem/styled-map-package/commit/9fc6faf6a120e0a5bed5157a681226ea1353a280) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Exclude locally-rendered glyph ranges from validation and downloads. MapLibre GL renders CJK, Hangul, Kana, Yi, and Halfwidth/Fullwidth glyphs client-side via `localIdeographFontFamily`, so SMP files do not need to include these 163 of 256 glyph ranges. Adds `skipLocalGlyphs` option to `download()` and `--skip-local-glyphs` CLI flag. Validator glyph completeness check now only counts the 93 required ranges.

### Patch Changes

- Updated dependencies [[`799c2fd`](https://github.com/digidem/styled-map-package/commit/799c2fd1169d8efc84db310557d7b5d6a8f5ddc9), [`5ec8ecf`](https://github.com/digidem/styled-map-package/commit/5ec8ecfba91cef52ce9d2a60a9e640a0efa42505), [`4cc7a88`](https://github.com/digidem/styled-map-package/commit/4cc7a88f2ce4696711210b71feeffb414b61c8c4), [`911d64d`](https://github.com/digidem/styled-map-package/commit/911d64dfd4b20ada924f2a038abdf333c1c8259a), [`6ce4486`](https://github.com/digidem/styled-map-package/commit/6ce44864e4a8f971f92840547f452da58a13072c), [`4e1f56c`](https://github.com/digidem/styled-map-package/commit/4e1f56ce8c58a06545636a8fba4153b812bced67), [`8efbb36`](https://github.com/digidem/styled-map-package/commit/8efbb36d0b96977b83c687339429fa92a62737a3), [`9fc6faf`](https://github.com/digidem/styled-map-package/commit/9fc6faf6a120e0a5bed5157a681226ea1353a280), [`03e43f6`](https://github.com/digidem/styled-map-package/commit/03e43f613a1835b45ae4938c96bb7363d8053566), [`799c2fd`](https://github.com/digidem/styled-map-package/commit/799c2fd1169d8efc84db310557d7b5d6a8f5ddc9)]:
  - styled-map-package-api@5.0.0-pre.4
  - smp-noto-glyphs@1.0.0-pre.0

## 5.0.0-pre.3

### Patch Changes

- Updated dependencies [[`d30d241`](https://github.com/digidem/styled-map-package/commit/d30d241e301a985c0f74ef36d8129fa097008445)]:
  - styled-map-package-api@5.0.0-pre.3

## 5.0.0-pre.2

### Patch Changes

- Updated dependencies [[`609af6d`](https://github.com/digidem/styled-map-package/commit/609af6d0c795901d089022d158cdeb50bdace5a9), [`c8b219c`](https://github.com/digidem/styled-map-package/commit/c8b219cffb35a3a45ff58d814d233420dd0c77a8)]:
  - styled-map-package-api@5.0.0-pre.2

## 5.0.0-pre.1

### Patch Changes

- [#75](https://github.com/digidem/styled-map-package/pull/75) [`14cf062`](https://github.com/digidem/styled-map-package/commit/14cf06279b934b6e8619e4772e21470ca9cc4d54) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add package READMEs

- Updated dependencies [[`14cf062`](https://github.com/digidem/styled-map-package/commit/14cf06279b934b6e8619e4772e21470ca9cc4d54), [`5f23127`](https://github.com/digidem/styled-map-package/commit/5f23127b496791d79d195507f2142c4d6c7fc2b6)]:
  - styled-map-package-api@5.0.0-pre.1

## 5.0.0-pre.0

### Major Changes

- [#72](https://github.com/digidem/styled-map-package/pull/72) [`9ec4b11`](https://github.com/digidem/styled-map-package/commit/9ec4b11e6ca254535b3d99714918e264837096d5) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Restructure into npm workspaces monorepo with separate packages for the JS API (`styled-map-package-api`) and CLI (`styled-map-package`).

### Patch Changes

- Updated dependencies [[`9ec4b11`](https://github.com/digidem/styled-map-package/commit/9ec4b11e6ca254535b3d99714918e264837096d5)]:
  - styled-map-package-api@5.0.0-pre.0
