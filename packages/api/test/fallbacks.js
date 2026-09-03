import { describe, test } from 'vitest'

import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'

import { emptyTileFallback, emptyGlyphFallback } from '../lib/fallbacks.js'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * @param {'vector' | 'raster'} type
 * @param {string} ext
 * @returns {{ sourceId: string, source: any }}
 */
function sourceInfo(type, ext) {
  return {
    sourceId: 'test',
    source: {
      type,
      tiles: [`http://example.com/tiles/{z}/{x}/{y}${ext}`],
      bounds: [-180, -85, 180, 85],
      minzoom: 0,
      maxzoom: 10,
    },
  }
}

/** @param {Response} response */
async function readBody(response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(
    Number(response.headers.get('content-length')),
    bytes.byteLength,
    'content-length matches body',
  )
  return bytes
}

/** @param {Uint8Array} bytes */
function assertEmptyGzip(bytes) {
  assert.equal(gunzipSync(bytes).byteLength, 0, 'gunzips to an empty payload')
}

/** @param {Uint8Array} bytes */
function assertPng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE, 'PNG signature')
  const trailer = new TextDecoder().decode(bytes.subarray(-8, -4))
  assert.equal(trailer, 'IEND', 'PNG ends with IEND chunk')
}

/** @param {Uint8Array} bytes */
function assertWebp(bytes) {
  const ascii = new TextDecoder().decode(bytes.subarray(0, 12))
  assert.equal(ascii.slice(0, 4), 'RIFF', 'RIFF header')
  assert.equal(ascii.slice(8, 12), 'WEBP', 'WEBP fourcc')
  const riffSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(
    4,
    true,
  )
  assert.equal(riffSize, bytes.byteLength - 8, 'RIFF size matches body')
}

describe('emptyTileFallback', () => {
  const cases = [
    {
      name: 'vector .mvt.gz',
      type: 'vector',
      ext: '.mvt.gz',
      contentType: 'application/vnd.mapbox-vector-tile',
      contentEncoding: 'gzip',
      check: assertEmptyGzip,
    },
    {
      name: 'vector .pbf',
      type: 'vector',
      ext: '.pbf',
      contentType: 'application/vnd.mapbox-vector-tile',
      contentEncoding: 'gzip',
      check: assertEmptyGzip,
    },
    {
      name: 'vector with unrecognised extension',
      type: 'vector',
      ext: '',
      contentType: 'application/vnd.mapbox-vector-tile',
      contentEncoding: 'gzip',
      check: assertEmptyGzip,
    },
    {
      name: 'raster .png',
      type: 'raster',
      ext: '.png',
      contentType: 'image/png',
      contentEncoding: null,
      check: assertPng,
    },
    {
      name: 'raster .jpg (served as transparent PNG)',
      type: 'raster',
      ext: '.jpg',
      contentType: 'image/png',
      contentEncoding: null,
      check: assertPng,
    },
    {
      name: 'raster .webp',
      type: 'raster',
      ext: '.webp',
      contentType: 'image/webp',
      contentEncoding: null,
      check: assertWebp,
    },
    {
      name: 'raster with unrecognised extension',
      type: 'raster',
      ext: '',
      contentType: 'image/png',
      contentEncoding: null,
      check: assertPng,
    },
  ]

  for (const {
    name,
    type,
    ext,
    contentType,
    contentEncoding,
    check,
  } of cases) {
    test(`serves a valid empty tile for ${name}`, async () => {
      const response = emptyTileFallback(
        { x: 0, y: 0, z: 0 },
        sourceInfo(/** @type {'vector' | 'raster'} */ (type), ext),
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), contentType)
      assert.equal(response.headers.get('content-encoding'), contentEncoding)
      check(await readBody(response))
    })
  }

  test('returns 404 when the source has no tile URLs', () => {
    const response = emptyTileFallback(
      { x: 0, y: 0, z: 0 },
      {
        sourceId: 'test',
        source: /** @type {any} */ ({
          type: 'raster',
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 10,
        }),
      },
    )
    assert.equal(response.status, 404)
  })
})

describe('emptyGlyphFallback', () => {
  test('serves a valid empty gzipped PBF', async () => {
    const response = emptyGlyphFallback('Open Sans Regular', '0-255')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-protobuf')
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assertEmptyGzip(await readBody(response))
  })
})
