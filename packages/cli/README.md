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

| Option                 | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `-o, --output <file>`  | Output file (writes to stdout if omitted)        |
| `-b, --bbox <w,s,e,n>` | Bounding box (west, south, east, north)          |
| `-z, --zoom <number>`  | Max zoom level (0-22)                            |
| `-t, --token <token>`  | Mapbox access token (required for Mapbox styles) |

When run interactively, missing options are prompted for.

### `smp view`

Preview a `.smp` file in a web browser.

```sh
smp view demotiles.smp --open
```

**Options:**

| Option                | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `-o, --open`          | Open in the default web browser                                   |
| `-p, --port <number>` | Port to serve on (default: 3000)                                  |
| `-f, --fallback`      | Serve empty tiles and glyphs for missing resources instead of 404 |

The `--fallback` flag is useful for previewing SMP files that don't contain every tile or glyph range referenced by the style. Missing vector tiles are served as empty MVTs, missing raster tiles as transparent pixels. Missing glyph ranges are served using bundled [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) glyphs (via [GoNotoKurrent](https://github.com/satbyy/go-noto-universal), covering 80+ scripts including Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, and more). CJK and Hangul ranges are not bundled since MapLibre renders these client-side via `localIdeographFontFamily`.

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
