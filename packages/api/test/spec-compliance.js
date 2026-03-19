import { ZipReader } from '@gmaclennan/zip-reader'
import { BufferSource } from '@gmaclennan/zip-reader/buffer-source'
import { describe, test } from 'vitest'
import { ZipWriter } from 'zip-writer'

import assert from 'node:assert/strict'

import { Reader } from '../lib/reader.js'
import { createServer } from '../lib/server.js'
import { Writer } from '../lib/writer.js'
import { streamToBuffer } from './utils/stream-consumers.js'

const enc = new TextEncoder()

/**
 * Create a zip buffer with given entries using zip-writer.
 * @param {Array<{ name: string, data: string | Uint8Array, store?: boolean }>} entries
 * @returns {Promise<Uint8Array>}
 */
async function createZipBuffer(entries) {
  const zw = new ZipWriter()
  const outputPromise = streamToBuffer(
    /** @type {ReadableStream<Uint8Array>} */ (zw.readable),
  )
  for (const { name, data, store } of entries) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    await zw.addEntry({
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
      name,
      store,
    })
  }
  await zw.finalize()
  return outputPromise
}

/**
 * Create a Reader from a zip buffer.
 * @param {Uint8Array} zipBuffer
 * @param {import('../lib/reader.js').ReaderOptions} [options]
 * @returns {Promise<Reader>}
 */
async function readerFromBuffer(zipBuffer, options) {
  const zip = await ZipReader.from(new BufferSource(zipBuffer))
  return new Reader(zip, options)
}

/**
 * Create a minimal valid style.json string.
 * @param {object} [overrides]
 * @returns {string}
 */
function minimalStyle(overrides = {}) {
  return JSON.stringify({
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background' }],
    ...overrides,
  })
}

/**
 * Create a valid SMP buffer using the Writer, for use as a baseline.
 * @param {object} [opts]
 * @param {object} [opts.style]
 * @param {Array<{z: number, x: number, y: number, sourceId: string, format?: string}>} [opts.tiles]
 * @returns {Promise<Uint8Array>}
 */
async function createValidSmp(opts = {}) {
  const style = opts.style || {
    version: 8,
    sources: { test: { type: 'vector' } },
    layers: [{ id: 'bg', type: 'background' }],
  }
  const writer = new Writer(style)
  const smpBufPromise = streamToBuffer(writer.outputStream)
  const tiles = opts.tiles || [
    {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: /** @type {const} */ ('mvt'),
    },
  ]
  for (const tile of tiles) {
    await writer.addTile(new Uint8Array(1024), /** @type {any} */ (tile))
  }
  await writer.finish()
  return smpBufPromise
}

// ============================================================================
// Section 3.1: VERSION file
// ============================================================================
describe('Spec §3.1: VERSION file', () => {
  test('Reader returns "1.0" when VERSION file is absent', async () => {
    const zipBuffer = await createZipBuffer([
      { name: 'style.json', data: minimalStyle() },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const version = await reader.getVersion()
    assert.equal(version, '1.0')
    await reader.close()
  })

  test('Reader reads VERSION file content', async () => {
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: minimalStyle() },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const version = await reader.getVersion()
    assert.equal(version, '1.0')
    await reader.close()
  })

  test('Reader trims whitespace from VERSION file', async () => {
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '  1.0  \n' },
      { name: 'style.json', data: minimalStyle() },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const version = await reader.getVersion()
    assert.equal(version, '1.0')
    await reader.close()
  })

  test('Reader reads minor version bumps', async () => {
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.1\n' },
      { name: 'style.json', data: minimalStyle() },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const version = await reader.getVersion()
    assert.equal(version, '1.1')
    await reader.close()
  })
})

// ============================================================================
// Section 3.4: ZIP Entry Constraints — path traversal
// ============================================================================
describe('Spec §3.4: ZIP entry name validation', () => {
  test('Reader rejects ZIP entries with .. path segments', async () => {
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: minimalStyle() },
      { name: 'fonts/../etc/passwd', data: 'malicious' },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    // The zip library or our check rejects this
    await assert.rejects(reader.opened(), /Relative path|Unsafe ZIP entry name/)
    await reader.close()
  })

  test('Reader rejects ZIP entries with absolute paths', async () => {
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: minimalStyle() },
      { name: '/etc/passwd', data: 'malicious' },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    await assert.rejects(reader.opened(), /Absolute path|Unsafe ZIP entry name/)
    await reader.close()
  })

  test('Reader rejects ZIP entries with drive letter paths', async () => {
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: minimalStyle() },
      // Note: zip-writer rejects backslashes, so use forward-slash variant
      { name: 'C:/Windows/System32/config', data: 'malicious' },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    await assert.rejects(reader.opened(), /Absolute path|Unsafe ZIP entry name/)
    await reader.close()
  })
})

// ============================================================================
// Section 4.1: style.json validity
// ============================================================================
describe('Spec §4.1: style.json validity', () => {
  test('Reader rejects archive with missing style.json', async () => {
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'some-other-file.txt', data: 'hello' },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    await assert.rejects(reader.getStyle(), { code: 'ENOENT' })
    await reader.close()
  })

  test('Reader preserves unknown properties in style', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [{ id: 'bg', type: 'background' }],
      'custom:property': 'should be preserved',
      metadata: { 'my:custom': 'value' },
    }
    const zipBuffer = await createZipBuffer([
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const readStyle = await reader.getStyle()
    assert.equal(
      /** @type {any} */ (readStyle)['custom:property'],
      'should be preserved',
    )
    assert.equal(/** @type {any} */ (readStyle.metadata)['my:custom'], 'value')
    await reader.close()
  })
})

// ============================================================================
// Section 4.2: SMP URI scheme
// ============================================================================
describe('Spec §4.2: SMP URI scheme', () => {
  test('Reader resolves smp:// URIs to provided baseUrl', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    const style = await reader.getStyle('http://localhost:3000/')
    for (const source of Object.values(style.sources)) {
      if ('tiles' in source && source.tiles) {
        for (const tile of source.tiles) {
          assert(
            tile.startsWith('http://localhost:3000/'),
            `Expected tile URL to start with baseUrl, got: ${tile}`,
          )
          assert(!tile.includes('smp://'), 'smp:// should be replaced')
        }
      }
    }
    await reader.close()
  })

  test('Reader returns raw smp:// URIs when baseUrl is null', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    const style = await reader.getStyle(null)
    for (const source of Object.values(style.sources)) {
      if ('tiles' in source && source.tiles) {
        for (const tile of source.tiles) {
          assert(
            tile.startsWith('smp://maps.v1/'),
            `Expected smp:// URI, got: ${tile}`,
          )
        }
      }
    }
    await reader.close()
  })

  test('Server percent-decodes paths with spaces', async () => {
    // Create an SMP with a font that has a space in the name
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [
        { id: 'bg', type: 'background' },
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          'source-layer': 'places',
          layout: { 'text-field': '{name}', 'text-font': ['Open Sans Bold'] },
        },
      ],
      glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf.gz',
    }
    const writer = new Writer(style)
    const smpBufPromise = streamToBuffer(writer.outputStream)
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })
    await writer.addGlyphs(new Uint8Array(64), {
      font: 'Open Sans Bold',
      range: '0-255',
    })
    await writer.finish()
    const smpBuf = await smpBufPromise
    const reader = await readerFromBuffer(smpBuf)
    const server = createServer()

    // Request with percent-encoded space (as MapLibre would)
    const response = await server.fetch(
      new Request('http://example.com/fonts/Open%20Sans%20Bold/0-255.pbf.gz'),
      reader,
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-protobuf')
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    await reader.close()
  })
})

// ============================================================================
// Section 4.2.2: GeoJSON data URI resolution
// ============================================================================
describe('Spec §4.2.2: GeoJSON data URI resolution', () => {
  test('Reader resolves GeoJSON data smp:// URIs with baseUrl', async () => {
    const style = {
      version: 8,
      sources: {
        'my-geojson': {
          type: 'geojson',
          data: 'smp://maps.v1/s/my-geojson/data.json',
        },
      },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [],
      bbox: [0, 0, 1, 1],
    })
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 's/my-geojson/data.json', data: geojson },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const readStyle = await reader.getStyle('http://localhost:3000/')
    assert.equal(
      /** @type {any} */ (readStyle.sources['my-geojson']).data,
      'http://localhost:3000/s/my-geojson/data.json',
    )
    await reader.close()
  })

  test('Reader preserves inline GeoJSON data (does not treat as URI)', async () => {
    const inlineData = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {},
        },
      ],
    }
    const style = {
      version: 8,
      sources: {
        inline: { type: 'geojson', data: inlineData },
      },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const zipBuffer = await createZipBuffer([
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const readStyle = await reader.getStyle('http://localhost:3000/')
    // Inline data should remain as an object, not a string
    const inlineSrc = /** @type {any} */ (readStyle.sources.inline)
    assert.equal(typeof inlineSrc.data, 'object')
    assert.equal(inlineSrc.data.type, 'FeatureCollection')
    await reader.close()
  })

  test('GeoJSON data file can be served via server', async () => {
    const geojsonData = {
      type: 'FeatureCollection',
      features: [],
      bbox: [0, 0, 1, 1],
    }
    const style = {
      version: 8,
      sources: {
        'my-source': {
          type: 'geojson',
          data: 'smp://maps.v1/s/my-source/data.json',
        },
      },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const zipBuffer = await createZipBuffer([
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 's/my-source/data.json', data: JSON.stringify(geojsonData) },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const server = createServer()
    const response = await server.fetch(
      new Request('http://example.com/s/my-source/data.json'),
      reader,
    )
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('content-type'),
      'application/json; charset=utf-8',
    )
    const body = await response.json()
    assert.equal(body.type, 'FeatureCollection')
    await reader.close()
  })
})

// ============================================================================
// Section 5.6: Source Properties — url removal
// ============================================================================
describe('Spec §5.6: Source properties', () => {
  test('Writer removes url property from tile sources', async () => {
    const style = {
      version: 8,
      sources: {
        osm: {
          type: 'vector',
          url: 'https://example.com/tilejson.json',
          tiles: ['https://example.com/tiles/{z}/{x}/{y}.mvt'],
          minzoom: 0,
          maxzoom: 14,
          bounds: [-180, -85, 180, 85],
        },
      },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const writer = new Writer(style)
    const smpBufPromise = streamToBuffer(writer.outputStream)
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'osm',
      format: 'mvt',
    })
    await writer.finish()
    const smpBuf = await smpBufPromise
    const reader = await readerFromBuffer(smpBuf)
    const readStyle = await reader.getStyle()
    assert(!('url' in readStyle.sources.osm), 'url property should be removed')
    assert('tiles' in readStyle.sources.osm, 'tiles property should be present')
    await reader.close()
  })
})

// ============================================================================
// Section 5.2: Tile file extensions
// ============================================================================
describe('Spec §5.2: Tile file extensions', () => {
  test('Writer produces .mvt.gz extension for mvt tiles', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    const style = await reader.getStyle()
    const source = Object.values(style.sources)[0]
    assert('tiles' in source && source.tiles)
    assert(
      source.tiles[0].endsWith('.mvt.gz'),
      `Expected .mvt.gz extension, got: ${source.tiles[0]}`,
    )
    await reader.close()
  })

  test('.mvt.gz tiles are served with gzip content-encoding', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    const style = await reader.getStyle('http://example.com/')
    const source = /** @type {any} */ (Object.values(style.sources)[0])
    const tileUrl = source.tiles[0]
      .replace('{z}', '0')
      .replace('{x}', '0')
      .replace('{y}', '0')
    const server = createServer()
    const response = await server.fetch(new Request(tileUrl), reader)
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert.equal(
      response.headers.get('content-type'),
      'application/vnd.mapbox-vector-tile',
    )
    await reader.close()
  })
})

// ============================================================================
// Section 5.3: Tile format consistency
// ============================================================================
describe('Spec §5.3: Tile format consistency', () => {
  test('Writer rejects mixed tile formats in a single source', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'raster' } },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const writer = new Writer(style)
    streamToBuffer(writer.outputStream) // consume the output
    await writer.addTile(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'png',
    })
    await assert.rejects(
      writer.addTile(new Uint8Array([0xff, 0xd8, 0xff]), {
        z: 1,
        x: 0,
        y: 0,
        sourceId: 'test',
        format: 'jpg',
      }),
      /Tile format mismatch/,
    )
  })
})

// ============================================================================
// Section 6.4: Font stacks
// ============================================================================
describe('Spec §6.4: Font stacks', () => {
  test('Writer transforms multi-font stacks to single font', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [
        { id: 'bg', type: 'background' },
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          layout: {
            'text-field': '{name}',
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          },
          'source-layer': 'places',
        },
      ],
      glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf.gz',
    }
    const writer = new Writer(style)
    const smpBufPromise = streamToBuffer(writer.outputStream)
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })
    // Only add one font — the writer should pick this one
    await writer.addGlyphs(new Uint8Array(64), {
      font: 'Open Sans Regular',
      range: '0-255',
    })
    await writer.finish()
    const smpBuf = await smpBufPromise
    const reader = await readerFromBuffer(smpBuf)
    const readStyle = await reader.getStyle()
    const layer = readStyle.layers.find((l) => l.id === 'labels')
    assert(layer && 'layout' in layer)
    // Font stack should be reduced to single font
    assert.deepEqual(/** @type {any} */ (layer.layout)['text-font'], [
      'Open Sans Regular',
    ])
    await reader.close()
  })
})

// ============================================================================
// Section 8: GeoJSON sources
// ============================================================================
describe('Spec §8: GeoJSON sources', () => {
  test('Writer preserves inline GeoJSON with computed bbox', async () => {
    const geojsonData = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 20] },
          properties: {},
        },
      ],
    }
    const style = {
      version: 8,
      sources: {
        places: { type: 'geojson', data: geojsonData },
      },
      layers: [
        {
          id: 'places-layer',
          type: 'circle',
          source: 'places',
        },
      ],
    }
    const writer = new Writer(style)
    const smpBufPromise = streamToBuffer(writer.outputStream)
    await writer.finish()
    const smpBuf = await smpBufPromise
    const reader = await readerFromBuffer(smpBuf)
    const readStyle = await reader.getStyle()
    const source = readStyle.sources.places
    assert.equal(source.type, 'geojson')
    assert.equal(typeof source.data, 'object')
    // bbox should be computed
    assert(source.data.bbox, 'GeoJSON data should have bbox')
    await reader.close()
  })
})

// ============================================================================
// Section 9: Resource integrity
// ============================================================================
describe('Spec §9: Resource integrity', () => {
  test('Reader throws ENOENT for missing tile resource', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    await assert.rejects(reader.getResource('s/0/99/99/99.mvt.gz'), {
      code: 'ENOENT',
    })
    await reader.close()
  })

  test('Writer rejects adding tile for unknown source', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const writer = new Writer(style)
    streamToBuffer(writer.outputStream) // consume the output
    await assert.rejects(
      writer.addTile(new Uint8Array(1024), {
        z: 0,
        x: 0,
        y: 0,
        sourceId: 'nonexistent',
        format: 'mvt',
      }),
      /Source not referenced/,
    )
  })

  test('Writer rejects duplicate tile entries', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const writer = new Writer(style)
    streamToBuffer(writer.outputStream) // consume the output
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })
    await assert.rejects(
      writer.addTile(new Uint8Array(1024), {
        z: 0,
        x: 0,
        y: 0,
        sourceId: 'test',
        format: 'mvt',
      }),
      /already added/,
    )
  })
})

// ============================================================================
// Section 9.1: Missing resources — server fallback behavior
// ============================================================================
describe('Spec §9.1: Missing resources — server behavior', () => {
  test('Server returns 404 for missing tile', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    const server = createServer()
    await assert.rejects(
      server.fetch(
        new Request('http://example.com/s/0/99/99/99.mvt.gz'),
        reader,
      ),
      (/** @type {any} */ err) => err.status === 404,
    )
    await reader.close()
  })

  test('Server calls fallbackTile for missing tile when configured', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    /** @type {any} */
    let calledWith = null
    const server = createServer({
      fallbackTile(tileId, sourceInfo) {
        calledWith = { tileId, sourceId: sourceInfo.sourceId }
        return new Response('fallback', { status: 200 })
      },
    })
    const response = await server.fetch(
      new Request('http://example.com/s/0/5/10/11.mvt.gz'),
      reader,
    )
    assert.equal(response.status, 200)
    assert(calledWith, 'fallbackTile should have been called')
    assert.deepEqual(calledWith.tileId, { z: 5, x: 10, y: 11 })
    assert.equal(calledWith.sourceId, 'test')
    await reader.close()
  })

  test('Server calls fallbackGlyph for missing glyph when configured', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [
        { id: 'bg', type: 'background' },
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          'source-layer': 'places',
          layout: { 'text-field': '{name}', 'text-font': ['TestFont'] },
        },
      ],
      glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf.gz',
    }
    const writer = new Writer(style)
    const smpBufPromise = streamToBuffer(writer.outputStream)
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })
    await writer.addGlyphs(new Uint8Array(64), {
      font: 'TestFont',
      range: '0-255',
    })
    await writer.finish()
    const smpBuf = await smpBufPromise
    const reader = await readerFromBuffer(smpBuf)

    /** @type {any} */
    let calledWith = null
    const server = createServer({
      fallbackGlyph(fontstack, range) {
        calledWith = { fontstack, range }
        return new Response('fallback-glyph', { status: 200 })
      },
    })
    // Request a range that doesn't exist
    const response = await server.fetch(
      new Request('http://example.com/fonts/TestFont/256-511.pbf.gz'),
      reader,
    )
    assert.equal(response.status, 200)
    assert(calledWith, 'fallbackGlyph should have been called')
    assert.equal(calledWith.fontstack, 'TestFont')
    assert.equal(calledWith.range, '256-511')
    await reader.close()
  })
})

// ============================================================================
// Section 10: Serving resources — MIME types and content-encoding
// ============================================================================
describe('Spec §10: MIME type mapping', () => {
  test('.pbf.gz glyph files served with correct headers', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [
        { id: 'bg', type: 'background' },
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          'source-layer': 'places',
          layout: { 'text-field': '{name}', 'text-font': ['TestFont'] },
        },
      ],
      glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf.gz',
    }
    const writer = new Writer(style)
    const smpBufPromise = streamToBuffer(writer.outputStream)
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })
    await writer.addGlyphs(new Uint8Array(64), {
      font: 'TestFont',
      range: '0-255',
    })
    await writer.finish()
    const smpBuf = await smpBufPromise
    const reader = await readerFromBuffer(smpBuf)
    const server = createServer()
    const response = await server.fetch(
      new Request('http://example.com/fonts/TestFont/0-255.pbf.gz'),
      reader,
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-protobuf')
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    await reader.close()
  })

  test('Sprite .json files served with correct content-type', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [{ id: 'bg', type: 'background' }],
      sprite: 'https://example.com/sprites/default/sprite',
    }
    const writer = new Writer(style)
    const smpBufPromise = streamToBuffer(writer.outputStream)
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })
    await writer.addSprite({
      json: JSON.stringify({ icon: { x: 0, y: 0, width: 16, height: 16 } }),
      png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    })
    await writer.finish()
    const smpBuf = await smpBufPromise
    const reader = await readerFromBuffer(smpBuf)
    const server = createServer()

    const jsonResponse = await server.fetch(
      new Request('http://example.com/sprites/default/sprite.json'),
      reader,
    )
    assert.equal(jsonResponse.status, 200)
    assert.equal(
      jsonResponse.headers.get('content-type'),
      'application/json; charset=utf-8',
    )

    const pngResponse = await server.fetch(
      new Request('http://example.com/sprites/default/sprite.png'),
      reader,
    )
    assert.equal(pngResponse.status, 200)
    assert.equal(pngResponse.headers.get('content-type'), 'image/png')

    await reader.close()
  })
})

// ============================================================================
// Section 11: Security — path traversal in ZIP entries
// ============================================================================
describe('Spec §11: Security', () => {
  test('Path traversal in getResource returns ENOENT (no matching entry)', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    await assert.rejects(reader.getResource('s/0/%2e%2e/%2e%2e/etc/passwd'), {
      code: 'ENOENT',
    })
    await reader.close()
  })
})

// ============================================================================
// Section 11.2: Resource limits
// ============================================================================
describe('Spec §11.2: Resource limits', () => {
  test('Reader rejects archive exceeding maxEntries', async () => {
    // Create a valid SMP then read it with a very low maxEntries
    const smpBuf = await createValidSmp()
    const zip = await ZipReader.from(new BufferSource(smpBuf))
    // The SMP has at least 3 entries (VERSION, style.json, tile)
    const reader = new Reader(zip, { maxEntries: 2 })
    await assert.rejects(reader.opened(), /exceeds maximum entry count/)
    await reader.close()
  })

  test('Reader rejects resource exceeding maxResourceSize', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf, { maxResourceSize: 10 })
    // The tile is 1024 bytes, which exceeds our 10-byte limit
    const style = await reader.getStyle()
    const source = /** @type {any} */ (Object.values(style.sources)[0])
    const tilePath = source.tiles[0]
      .replace('smp://maps.v1/', '')
      .replace('{z}', '0')
      .replace('{x}', '0')
      .replace('{y}', '0')
    await assert.rejects(reader.getResource(tilePath), /exceeds maximum size/)
    await reader.close()
  })

  test('Reader accepts archive within default limits', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    await reader.opened()
    // Should not throw
    const style = await reader.getStyle()
    assert(style)
    await reader.close()
  })
})

// ============================================================================
// Section 3.4: NFC normalization
// ============================================================================
describe('Spec §3.4: NFC normalization', () => {
  test('Writer NFC-normalizes entry names', async () => {
    // é as NFD (e + combining acute) vs NFC (single codepoint)
    const nfdName = 'Caf\u0065\u0301' // "Café" in NFD
    const nfcName = 'Caf\u00e9' // "Café" in NFC
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [
        { id: 'bg', type: 'background' },
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          'source-layer': 'places',
          layout: { 'text-field': '{name}', 'text-font': [nfdName] },
        },
      ],
      glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf.gz',
    }
    const writer = new Writer(style)
    const smpBufPromise = streamToBuffer(writer.outputStream)
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })
    // Add glyphs with NFD name — writer should normalize to NFC
    await writer.addGlyphs(new Uint8Array(64), {
      font: nfdName,
      range: '0-255',
    })
    await writer.finish()
    const smpBuf = await smpBufPromise

    // Read back and verify the glyph is accessible via NFC name
    const zip = await ZipReader.from(new BufferSource(smpBuf))
    const entries = []
    for await (const entry of zip) {
      entries.push(entry.name)
    }
    const glyphEntry = entries.find((n) => n.startsWith('fonts/'))
    assert(glyphEntry, 'should have a glyph entry')
    // The entry name should be NFC-normalized
    assert(
      glyphEntry.includes(nfcName),
      `Entry name should use NFC form: got ${glyphEntry}`,
    )
    // NFD form should have been normalized away (NFD !== NFC for this string)
    assert.notEqual(
      nfdName,
      nfcName,
      'test precondition: NFD and NFC forms differ',
    )
    assert(!glyphEntry.includes(nfdName), 'Entry name should not use NFD form')
  })

  test('Reader normalizes NFD entry names to NFC for lookup', async () => {
    const nfdFont = 'Caf\u0065\u0301' // "Café" in NFD
    const nfcFont = 'Caf\u00e9' // "Café" in NFC
    const style = {
      version: 8,
      sources: {},
      layers: [{ id: 'bg', type: 'background' }],
      // Style references NFC form
      glyphs: `smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz`,
    }
    // ZIP entries use NFD form (simulating a third-party writer)
    const zipBuffer = await createZipBuffer([
      { name: 'style.json', data: JSON.stringify(style) },
      { name: `fonts/${nfdFont}/0-255.pbf.gz`, data: new Uint8Array(64) },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    // Look up using NFC form — should find the NFD entry
    const resource = await reader.getResource(`fonts/${nfcFont}/0-255.pbf.gz`)
    assert.equal(resource.contentType, 'application/x-protobuf')
    await reader.close()
  })
})

// ============================================================================
// Reader: .pbf/.pbf.gz tile and glyph extensions
// ============================================================================
describe('Reader: .pbf/.pbf.gz extension support', () => {
  test('Reader serves .pbf.gz tiles with correct content-type and encoding', async () => {
    // Manually create a ZIP with .pbf.gz tiles
    const style = {
      version: 8,
      sources: {
        test: {
          type: 'vector',
          tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.pbf.gz'],
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 0,
        },
      },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 's/0/0/0/0.pbf.gz', data: new Uint8Array(64), store: true },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const resource = await reader.getResource('s/0/0/0/0.pbf.gz')
    assert.equal(resource.contentType, 'application/x-protobuf')
    assert.equal(resource.contentEncoding, 'gzip')
    assert.equal(resource.resourceType, 'tile')
    await reader.close()
  })

  test('Reader serves .pbf tiles with correct content-type (no encoding)', async () => {
    const style = {
      version: 8,
      sources: {
        test: {
          type: 'vector',
          tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.pbf'],
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 0,
        },
      },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const zipBuffer = await createZipBuffer([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 's/0/0/0/0.pbf', data: new Uint8Array(64), store: true },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const resource = await reader.getResource('s/0/0/0/0.pbf')
    assert.equal(resource.contentType, 'application/x-protobuf')
    assert.equal(resource.contentEncoding, undefined)
    assert.equal(resource.resourceType, 'tile')
    await reader.close()
  })

  test('Reader serves .pbf glyph files with correct content-type', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [{ id: 'bg', type: 'background' }],
      glyphs: 'smp://maps.v1/fonts/{fontstack}/{range}.pbf',
    }
    const zipBuffer = await createZipBuffer([
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 'fonts/TestFont/0-255.pbf', data: new Uint8Array(64) },
    ])
    const reader = await readerFromBuffer(zipBuffer)
    const resource = await reader.getResource('fonts/TestFont/0-255.pbf')
    assert.equal(resource.contentType, 'application/x-protobuf')
    assert.equal(resource.contentEncoding, undefined)
    assert.equal(resource.resourceType, 'glyph')
    await reader.close()
  })
})

// ============================================================================
// Writer: smp:sourceFolders metadata
// ============================================================================
describe('Writer metadata', () => {
  test('Writer includes smp:sourceFolders in metadata', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    const style = await reader.getStyle()
    assert(style.metadata['smp:sourceFolders'], 'should include sourceFolders')
    assert.equal(style.metadata['smp:sourceFolders'].test, '0')
    await reader.close()
  })

  test('Writer includes smp:bounds and smp:maxzoom', async () => {
    const smpBuf = await createValidSmp()
    const reader = await readerFromBuffer(smpBuf)
    const style = await reader.getStyle()
    assert(style.metadata['smp:bounds'], 'should include bounds')
    assert(Array.isArray(style.metadata['smp:bounds']))
    assert.equal(style.metadata['smp:bounds'].length, 4)
    assert.equal(typeof style.metadata['smp:maxzoom'], 'number')
    await reader.close()
  })
})
