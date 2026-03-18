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

| Option                | Description                      |
| --------------------- | -------------------------------- |
| `-o, --open`          | Open in the default web browser  |
| `-p, --port <number>` | Port to serve on (default: 3000) |

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

## License

MIT
