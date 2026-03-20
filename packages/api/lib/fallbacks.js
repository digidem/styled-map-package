/** @import { SMPSource } from './types.js' */

/**
 * Minimal valid 1×1 transparent PNG (67 bytes).
 * @type {Uint8Array}
 */
const EMPTY_PNG = /* @__PURE__ */ fromHex(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c626000000002000198e195280000000049454e44ae426082',
)

/**
 * Minimal valid 1×1 transparent WebP (VP8L lossless, 34 bytes).
 * @type {Uint8Array}
 */
const EMPTY_WEBP = /* @__PURE__ */ fromHex(
  '524946461a000000574542505650384c0d0000002f00000010071011118888fe0700',
)

/**
 * Empty gzip stream (gzipped empty buffer, 20 bytes). Used for empty MVT
 * tiles and empty glyph PBF ranges.
 * @type {Uint8Array}
 */
const EMPTY_GZ = /* @__PURE__ */ fromHex(
  '1f8b080000000000001303000000000000000000',
)

/**
 * Empty GeoJSON FeatureCollection as UTF-8 bytes.
 * @type {Uint8Array}
 */
const EMPTY_JSON = /* @__PURE__ */ new TextEncoder().encode(
  '{"type":"FeatureCollection","features":[]}',
)

/** @type {Record<string, { body: Uint8Array, contentType: string, contentEncoding?: string }>} */
const TILE_FORMATS = {
  mvt: {
    body: EMPTY_GZ,
    contentType: 'application/vnd.mapbox-vector-tile',
    contentEncoding: 'gzip',
  },
  png: {
    body: EMPTY_PNG,
    contentType: 'image/png',
  },
  jpg: {
    // No such thing as "empty" JPEG — serve a transparent PNG instead.
    // MapLibre handles the content-type mismatch gracefully.
    body: EMPTY_PNG,
    contentType: 'image/png',
  },
  webp: {
    body: EMPTY_WEBP,
    contentType: 'image/webp',
  },
  json: {
    body: EMPTY_JSON,
    contentType: 'application/json; charset=utf-8',
  },
}

/**
 * Detect the tile format from a source's tile URL template.
 *
 * @param {SMPSource} source
 * @returns {string | null}
 */
function detectTileFormat(source) {
  const tiles = 'tiles' in source ? source.tiles : undefined
  if (!tiles || tiles.length === 0) return null
  const url = tiles[0]
  if (
    url.endsWith('.mvt.gz') ||
    url.endsWith('.mvt') ||
    url.endsWith('.pbf.gz') ||
    url.endsWith('.pbf')
  )
    return 'mvt'
  if (url.endsWith('.png')) return 'png'
  if (url.endsWith('.jpg') || url.endsWith('.jpeg')) return 'jpg'
  if (url.endsWith('.webp')) return 'webp'
  if (url.endsWith('.json') || url.endsWith('.geojson')) return 'json'
  // Default based on source type
  if (source.type === 'vector') return 'mvt'
  if (source.type === 'raster') return 'png'
  return null
}

/**
 * Fallback tile handler for use with `createServer({ fallbackTile })`.
 * Returns an appropriate empty tile based on the source's tile format:
 * - vector sources → empty gzipped MVT
 * - raster PNG sources → 1×1 transparent PNG
 * - raster WebP sources → 1×1 transparent WebP
 * - raster JPEG sources → 1×1 transparent PNG (no such thing as transparent JPEG)
 *
 * @param {{ x: number, y: number, z: number }} _tileId
 * @param {{ sourceId: string, source: SMPSource }} sourceInfo
 * @returns {Response}
 */
export function emptyTileFallback(_tileId, { source }) {
  const format = detectTileFormat(source)
  const tile = format && TILE_FORMATS[format]
  if (!tile) {
    return new Response('Not Found', { status: 404 })
  }
  /** @type {HeadersInit} */
  const headers = {
    'Content-Type': tile.contentType,
    'Content-Length': String(tile.body.byteLength),
    'Cache-Control': 'public, max-age=604800',
  }
  if (tile.contentEncoding) {
    headers['Content-Encoding'] = tile.contentEncoding
  }
  return new Response(/** @type {BodyInit} */ (tile.body), {
    status: 200,
    headers,
  })
}

/**
 * Fallback glyph handler for use with `createServer({ fallbackGlyph })`.
 * Returns an empty gzipped PBF (valid protobuf with no glyph entries), which
 * causes MapLibre to render missing characters as blank space instead of
 * erroring on a 404.
 *
 * @param {string} _fontstack
 * @param {string} _range
 * @returns {Response}
 */
// eslint-disable-next-line no-unused-vars
export function emptyGlyphFallback(_fontstack, _range) {
  return new Response(/** @type {BodyInit} */ (EMPTY_GZ), {
    status: 200,
    headers: {
      'Content-Type': 'application/x-protobuf',
      'Content-Encoding': 'gzip',
      'Content-Length': String(EMPTY_GZ.byteLength),
      'Cache-Control': 'public, max-age=604800',
    },
  })
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}
