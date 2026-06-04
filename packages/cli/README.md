# styled-map-package

CLI for creating, viewing, and converting Styled Map Package (`.smp`) files.

An `.smp` file is a ZIP archive containing all the resources needed to serve a MapLibre vector styled map offline: style JSON, vector and raster tiles, glyphs (fonts), sprites, and metadata.

## Installation

```sh
npm install --global styled-map-package
```

## Commands

### `smp download`

Download an online map style to a `.smp` file for offline use.

```sh
smp download https://demotiles.maplibre.org/style.json \
  --bbox '-180,-80,180,80' \
  --zoom 5 \
  --output demotiles.smp
```

**Options:**

| Option                 | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `-o, --output <file>`  | Output file (writes to stdout if omitted)                              |
| `-b, --bbox <w,s,e,n>` | Bounding box (west, south, east, north)                                |
| `-z, --zoom <number>`  | Max zoom level (0-22)                                                  |
| `-t, --token <token>`  | Mapbox access token (required for Mapbox styles)                       |
| `-d, --dedupe`         | Deduplicate tiles with identical content to reduce file size           |
| `--skip-local-glyphs`  | Skip CJK/Hangul/Kana glyph ranges rendered locally by MapLibre GL      |
| `--buffer-tiles`       | Download an extra tile ring around the bbox at each zoom below maxzoom |

When run interactively, missing options are prompted for.

The `--buffer-tiles` flag downloads one extra tile ring around the bbox at every
zoom level below maxzoom, so the map is not clipped at the edges of the
downloaded area when zooming out. The buffer is not added at maxzoom. `smp view`
automatically renders these buffer tiles.

### `smp view`

Preview a `.smp` file in a web browser.

```sh
smp view demotiles.smp --open
```

**Options:**

| Option                | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `-o, --open`          | Open in the default web browser                                            |
| `-p, --port <number>` | Port to serve on (default: 3000)                                           |
| `--no-fallback`       | Return 404 for missing tiles and glyphs instead of serving empty fallbacks |

By default the viewer serves empty tiles and Noto Sans glyphs for any resource not present in the file, so incomplete packages (those covering a partial area or zoom range) preview without 404 errors. Missing vector tiles are served as empty MVTs, missing raster tiles as transparent pixels. Missing glyph ranges are served using bundled [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) glyphs (via [GoNotoKurrent](https://github.com/satbyy/go-noto-universal), covering 80+ scripts including Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, and more). CJK and Hangul ranges are not bundled since MapLibre renders these client-side via `localIdeographFontFamily`. Pass `--no-fallback` to return 404s instead.

For packages downloaded with buffer tiles (recorded as `smp:bufferTiles` in the style metadata), the viewer also widens each source's `bounds` so the lower-zoom buffer tiles that extend beyond the data area are rendered rather than clipped. Combined with the empty-tile fallback, panning beyond the downloaded area shows blank tiles instead of console errors.

### `smp mbtiles`

> **Note:** Requires Node >= 20 (uses `better-sqlite3` which dropped Node 18 support).

Convert an MBTiles file to a `.smp` file.

```sh
smp mbtiles tiles.mbtiles --output map.smp
```

**Options:**

| Option                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `-o, --output <file>` | Output `.smp` file (writes to stdout if omitted) |

### `smp validate`

Validate a `.smp` file against the [SMP specification](../../spec/1.0/).

```sh
smp validate map.smp
```

Reports errors (spec MUST violations) and warnings (SHOULD/RECOMMENDED), each annotated with a severity level:

- **fatal** — the file cannot be opened by the reader
- **rendering** — the map opens but content will be visibly broken (missing tiles, glyphs, sprites)
- **spec** — non-compliance that doesn't affect practical use

Exits with code 0 if valid, 1 if errors are found.

## License

MIT
