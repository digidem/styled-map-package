# styled-map-package-api

JavaScript API for reading, writing, and serving Styled Map Package (`.smp`) files. Works in both Node.js and browsers.

An `.smp` file is a ZIP archive containing all the resources needed to serve a MapLibre vector styled map offline: style JSON, vector and raster tiles, glyphs (fonts), sprites, and metadata.

## Installation

```sh
npm install styled-map-package-api
```

## Usage

### Reading an SMP file

```js
import { Reader } from 'styled-map-package-api/reader'

const reader = new Reader('path/to/map.smp')
const style = await reader.getStyle()
```

### Writing an SMP file

```js
import { Writer } from 'styled-map-package-api/writer'

const writer = new Writer(style, sources)
const stream = writer.outputStream
// Pipe stream to a file or other writable destination
await writer.finish()
```

### Serving over HTTP

```js
import { Reader } from 'styled-map-package-api/reader'
import { createServer } from 'styled-map-package-api/server'

const reader = new Reader('path/to/map.smp')
const server = createServer()
// server.fetch(request, reader) returns a WHATWG Response
```

### Fallback tiles and glyphs

When an SMP file doesn't contain every tile or glyph range that the style references, `createServer` can call fallback handlers instead of returning a 404. This is useful for previewing incomplete packages or packages that only cover a partial area/zoom range.

Built-in fallback handlers are provided:

```js
import {
  emptyTileFallback,
  emptyGlyphFallback,
} from 'styled-map-package-api/fallbacks'
import { createServer } from 'styled-map-package-api/server'

const server = createServer({
  fallbackTile: emptyTileFallback,
  fallbackGlyph: emptyGlyphFallback,
})
```

- **`emptyTileFallback(tileId, sourceInfo)`** — Returns an appropriate empty tile based on the source's tile format: empty gzipped MVT for vector sources, 1×1 transparent PNG/WebP for raster sources.
- **`emptyGlyphFallback(fontstack, range)`** — Returns an empty gzipped PBF (valid protobuf with no glyph entries), causing MapLibre to render missing characters as blank space instead of erroring on a 404.

For real glyph rendering with Noto Sans (80+ scripts), use the [`smp-noto-glyphs`](../glyphs/) package:

```js
import { notoGlyphFallback } from 'smp-noto-glyphs'

const server = createServer({
  fallbackTile: emptyTileFallback,
  fallbackGlyph: notoGlyphFallback,
})
```

You can also provide custom fallback handlers, for example to proxy missing tiles from an online source:

```js
const server = createServer({
  fallbackTile: async (tileId, { sourceId, source }) => {
    const url = `https://tiles.example.com/${tileId.z}/${tileId.x}/${tileId.y}.mvt`
    return fetch(url)
  },
  fallbackGlyph: async (fontstack, range) => {
    return fetch(`https://fonts.example.com/${fontstack}/${range}.pbf`)
  },
})
```

### Downloading a map for offline use

```js
import { download } from 'styled-map-package-api/download'

const stream = download({
  styleUrl: 'https://demotiles.maplibre.org/style.json',
  bbox: [-180, -80, 180, 80],
  maxzoom: 5,
})
// Pipe the ReadableStream to a file
```

### Converting from MBTiles

> **Note:** MBTiles conversion requires Node >= 20 (uses `better-sqlite3` which dropped Node 18 support).

```js
import { fromMBTiles } from 'styled-map-package-api/from-mbtiles'

// From a file path (Node.js)
const stream = fromMBTiles('path/to/tiles.mbtiles')

// From an ArrayBuffer or Uint8Array (Node.js and browsers)
const stream = fromMBTiles(buffer)

// Pipe the ReadableStream to an .smp file
```

## API

### Exports

| Export path                               | Description                                                       |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `styled-map-package-api`                  | Main entry — `Reader`, `Writer`, `createServer`, `download`, etc. |
| `styled-map-package-api/reader`           | `Reader` class for reading `.smp` files                           |
| `styled-map-package-api/writer`           | `Writer` class for creating `.smp` files                          |
| `styled-map-package-api/server`           | `createServer()` — HTTP handler using WHATWG Request/Response     |
| `styled-map-package-api/fallbacks`        | `emptyTileFallback`, `emptyGlyphFallback` — built-in fallbacks    |
| `styled-map-package-api/download`         | `download()` — download an online map style for offline use       |
| `styled-map-package-api/style-downloader` | `StyleDownloader` — downloads styles, sprites, and glyphs         |
| `styled-map-package-api/tile-downloader`  | `downloadTiles()` — downloads tile data                           |
| `styled-map-package-api/from-mbtiles`     | `fromMBTiles()` — convert MBTiles to SMP stream                   |
| `styled-map-package-api/utils/mapbox`     | Mapbox URL detection and API utilities                            |

### Browser support

All stream APIs use WHATWG `ReadableStream`, making the library compatible with both Node.js and browser environments. The `Reader` class accepts either a file path (Node.js) or a `ZipReader` instance (browser).

## License

MIT
