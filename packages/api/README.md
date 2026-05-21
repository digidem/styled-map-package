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
// Close the underlying file descriptor when done to free system resources
await reader.close()
```

The `Reader` constructor accepts a file path (Node.js) or a `ZipReader` instance (browser), and an optional options object:

- **`maxEntries`** — maximum number of ZIP entries to process (default: 500,000). Exceeding this limit throws an error to avoid DoS attacks with maliciously crafted ZIP files containing excessive entries.
- **`maxResourceSize`** — maximum uncompressed size in bytes for a single resource (default: 20 MiB). Exceeding this limit throws an error to prevent excessive memory usage.

If you pass a file path to the `Reader` constructor, it will keep the file open until you call `reader.close()`.

### Writing an SMP file

```js
import { Writer } from 'styled-map-package-api/writer'

const writer = new Writer(style, { dedupe: true })
const stream = writer.outputStream
// Pipe stream to a file or other writable destination

await writer.addTile(tileData, { z: 0, x: 0, y: 0, sourceId: 'my-source' })
await writer.addSprite({ json: spriteJson, png: spritePng })
await writer.addGlyphs(glyphData, { font: 'Noto Sans', range: '0-255' })

await writer.finish()
```

The `Writer` constructor takes a [MapLibre style](https://maplibre.org/maplibre-style-spec/) object and an optional options object:

- **`dedupe`** — when `true`, duplicate tiles (with identical content) are stored only once, reducing file size for tilesets with many repeated tiles (e.g. ocean tiles).

  > **Warning:** This deduplication technique causes a mismatch between the filename stored in the local file header and the filename in the aliased central directory entries. While the ZIP specification does not forbid this, many general-purpose ZIP tools do not handle it correctly. macOS Finder fails to expand such archives, Info-ZIP `unzip` emits warnings, and strict readers such as `yauzl` (Node.js) and Go's `archive/zip` may reject the entries. Writers that need the resulting archive to be compatible with general-purpose ZIP tools SHOULD NOT use this technique.

Sources are added implicitly when tiles are added via `addTile()`. Use `createTileWriteStream()` and `createGlyphWriteStream()` for concurrent writes.

### Serving over HTTP

`createServer()` returns a `{ fetch }` object, where `fetch(request, reader)` is a handler that takes a [WHATWG `Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) and a `Reader` instance. On success it returns a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response). On failure it **throws** a `StatusError` (from `itty-router`) rather than returning an error response — this lets you decide how to respond to errors in your application.

A `StatusError` has a numeric `status` property (e.g. `404`) and a `message` string, so you can serialize it however you like:

```js
import { createServerAdapter } from '@whatwg-node/server'
import { Reader } from 'styled-map-package-api/reader'
import { createServer } from 'styled-map-package-api/server'

import { createServer as createHTTPServer } from 'node:http'

const reader = new Reader('path/to/map.smp')
const smpServer = createServer()

const httpServer = createHTTPServer(
  createServerAdapter(async (request) => {
    try {
      return await smpServer.fetch(request, reader)
    } catch (err) {
      const status = err.status || 500
      return new Response(JSON.stringify({ error: err.message, status }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }),
)

httpServer.listen(3000)
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
  skipLocalGlyphs: true,
  onprogress: (progress) => console.log(progress),
})
// Pipe the ReadableStream to a file
```

**Options:**

| Option              | Type        | Description                                                            |
| ------------------- | ----------- | ---------------------------------------------------------------------- |
| `styleUrl`          | `string`    | URL of the map style to download (required)                            |
| `bbox`              | `BBox`      | Bounding box `[west, south, east, north]` for tile download (required) |
| `maxzoom`           | `number`    | Maximum zoom level to download (required)                              |
| `mapboxAccessToken` | `string?`   | Mapbox access token (required for Mapbox styles)                       |
| `skipLocalGlyphs`   | `boolean?`  | Skip CJK/Hangul/Kana glyph ranges rendered client-side by MapLibre GL  |
| `dedupe`            | `boolean?`  | Store duplicate tiles only once to reduce file size                    |
| `onprogress`        | `function?` | Callback receiving a `DownloadProgress` object (see below)             |

The `skipLocalGlyphs` option skips downloading glyph ranges that MapLibre GL renders client-side via [`localIdeographFontFamily`](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/) (CJK, Hangul, Kana, Yi, and Halfwidth/Fullwidth Forms — 163 of 256 ranges). This significantly reduces download size for styles that use these scripts.

Tile sources may reference either a [TileJSON](https://github.com/mapbox/tilejson-spec) endpoint or a [PMTiles](https://docs.protomaps.com/pmtiles/) archive (`url: "pmtiles://https://…/map.pmtiles"`). PMTiles archives are read over HTTP range requests, and only the tiles within `bbox`/`maxzoom` are downloaded.

The `onprogress` callback receives a `DownloadProgress` object:

```js
{
  tiles:   { downloaded, totalBytes, total, skipped, done },
  style:   { done },
  sprites: { downloaded, done },
  glyphs:  { downloaded, total, totalBytes, done },
  output:  { totalBytes, done },
  elapsedMs: number,
}
```

### Converting from MBTiles

> **Note:** MBTiles conversion requires Node >= 20 (uses `better-sqlite3` which dropped Node 18 support). Only raster MBTiles are currently supported — vector MBTiles will throw an error.

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
| `styled-map-package-api/validator`        | `validate()` — validate `.smp` files against the spec             |
| `styled-map-package-api/utils/mapbox`     | Mapbox URL detection and API utilities                            |

### Validating an SMP file

```js
import { validate } from 'styled-map-package-api/validator'

const result = await validate('path/to/map.smp')

if (!result.usable) {
  console.error('File cannot be opened')
} else if (!result.valid) {
  console.warn('File has issues but is usable')
}

for (const issue of result.issues) {
  console.log(`[${issue.severity}] ${issue.message}`)
}
```

The validator checks an `.smp` file against the [SMP specification](../../spec/1.0/) and returns structured issues. Each issue has:

- **`kind`** — `'error'` (spec MUST violation) or `'warning'` (SHOULD/RECOMMENDED)
- **`severity`** — practical impact on the reader/renderer:
  - `'fatal'` — the reader will fail to open the file
  - `'rendering'` — the map opens but content will be visibly broken (missing tiles, glyphs, sprites)
  - `'spec'` — non-compliance that doesn't affect practical use
- **`type`** — stable identifier for programmatic filtering (e.g. `'missing_tiles'`, `'incomplete_font_glyphs'`)
- **`message`** — human-readable description
- **`path`** — location context (e.g. `'sources.test.tiles'`, `'glyphs'`)

The result includes two convenience booleans:

- **`valid`** — `true` when there are no errors (spec-compliant)
- **`usable`** — `true` when there are no fatal issues (the file can be opened)

Accepts a file path (Node.js) or a `ZipReader` instance (browser). Options:

```js
const result = await validate('map.smp', {
  maxEntries: 500_000, // max ZIP entries before aborting (default: 500,000)
})
```

### Browser support

All stream APIs use WHATWG `ReadableStream`, making the library compatible with both Node.js and browser environments. The `Reader` class accepts either a file path (Node.js) or a `ZipReader` instance (browser).

## License

MIT
