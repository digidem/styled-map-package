# styled-map-package-api

## 5.0.0-pre.5

### Major Changes

- [#105](https://github.com/digidem/styled-map-package/pull/105) [`45e1767`](https://github.com/digidem/styled-map-package/commit/45e17678d68c9fc25010d66d93f409d077aa0c3e) Thanks [@gmaclennan](https://github.com/gmaclennan)! - API cleanup for consistency: accessToken -> mapboxAccessToken and download now cleans up resources on cancel.

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

- [#100](https://github.com/digidem/styled-map-package/pull/100) [`5ec8ecf`](https://github.com/digidem/styled-map-package/commit/5ec8ecfba91cef52ce9d2a60a9e640a0efa42505) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Drop CJS support - ESM only from now on

- [#98](https://github.com/digidem/styled-map-package/pull/98) [`911d64d`](https://github.com/digidem/styled-map-package/commit/911d64dfd4b20ada924f2a038abdf333c1c8259a) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Fix uncaught error in `download()` when the style URL is unreachable — errors now propagate through the returned stream instead of becoming unhandled rejections. Accept `Readonly<BBox>` in public API type signatures.

- [#96](https://github.com/digidem/styled-map-package/pull/96) [`6ce4486`](https://github.com/digidem/styled-map-package/commit/6ce44864e4a8f971f92840547f452da58a13072c) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Fix: automatically migrate v7 styles to v8 when downloading or constructing a StyleDownloader, instead of rejecting them as invalid.

- [#91](https://github.com/digidem/styled-map-package/pull/91) [`4e1f56c`](https://github.com/digidem/styled-map-package/commit/4e1f56ce8c58a06545636a8fba4153b812bced67) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Update implementation to strictly conform with spec

- [#89](https://github.com/digidem/styled-map-package/pull/89) [`03e43f6`](https://github.com/digidem/styled-map-package/commit/03e43f613a1835b45ae4938c96bb7363d8053566) Thanks [@gmaclennan](https://github.com/gmaclennan)! - add fallbackTile and fallbackGlyph options to createServer

## 5.0.0-pre.3

### Patch Changes

- [#87](https://github.com/digidem/styled-map-package/pull/87) [`d30d241`](https://github.com/digidem/styled-map-package/commit/d30d241e301a985c0f74ef36d8129fa097008445) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Fix: Add missing tileSize for mbtiles imports and fix invalid source properties from mbtiles metadata

## 5.0.0-pre.2

### Patch Changes

- [#84](https://github.com/digidem/styled-map-package/pull/84) [`609af6d`](https://github.com/digidem/styled-map-package/commit/609af6d0c795901d089022d158cdeb50bdace5a9) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add browser support to fromMBTiles, including reading mbtiles from OPFS

- [#85](https://github.com/digidem/styled-map-package/pull/85) [`c8b219c`](https://github.com/digidem/styled-map-package/commit/c8b219cffb35a3a45ff58d814d233420dd0c77a8) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add dedupe option to SMP Writer, which writes duplicate tiles once to the Zip, resulting in significantly smaller files when used with maps with many duplicate tiles.

## 5.0.0-pre.1

### Patch Changes

- [#75](https://github.com/digidem/styled-map-package/pull/75) [`14cf062`](https://github.com/digidem/styled-map-package/commit/14cf06279b934b6e8619e4772e21470ca9cc4d54) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add package READMEs

- [#79](https://github.com/digidem/styled-map-package/pull/79) [`5f23127`](https://github.com/digidem/styled-map-package/commit/5f23127b496791d79d195507f2142c4d6c7fc2b6) Thanks [@gmaclennan](https://github.com/gmaclennan)! - fix: Writer should not extend node EventEmitter

## 5.0.0-pre.0

### Major Changes

- [#72](https://github.com/digidem/styled-map-package/pull/72) [`9ec4b11`](https://github.com/digidem/styled-map-package/commit/9ec4b11e6ca254535b3d99714918e264837096d5) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Restructure into npm workspaces monorepo with separate packages for the JS API (`styled-map-package-api`) and CLI (`styled-map-package`).
