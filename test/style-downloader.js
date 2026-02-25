import { afterAll, beforeAll, describe, test } from 'vitest'

import assert from 'node:assert/strict'
import { createServer as createHTTPServer } from 'node:http'
import { buffer as streamToBuffer } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'

import { StyleDownloader } from '../lib/index.js'
import { startSMPServer } from './utils/smp-server.js'

describe('StyleDownloader with demotiles-z2', () => {
  /** @type {{ baseUrl: string, close: () => Promise<void> }} */
  let server

  beforeAll(async () => {
    const fixturePath = fileURLToPath(
      new URL('./fixtures/demotiles-z2.smp', import.meta.url),
    )
    server = await startSMPServer(fixturePath)
  })

  afterAll(async () => {
    if (server) await server.close()
  })

  test('constructor accepts a URL string', () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    assert.equal(downloader.active, 0)
  })

  test('constructor accepts a StyleSpecification object', async () => {
    const res = await fetch(server.baseUrl + 'style.json')
    const style = await res.json()
    const downloader = new StyleDownloader(style)
    assert.equal(downloader.active, 0)
  })

  test('constructor throws for invalid style object', () => {
    assert.throws(
      () =>
        new StyleDownloader(
          /** @type {any} */ ({ version: 8, sources: {}, layers: 'invalid' }),
        ),
      { name: 'AggregateError' },
    )
  })

  test('getStyle() returns style with inlined sources', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const style = await downloader.getStyle()

    assert.equal(style.version, 8)
    assert('maplibre' in style.sources, 'has maplibre source')
    assert('crimea' in style.sources, 'has crimea source')

    // Vector source has inlined tiles array
    const vectorSource = /** @type {any} */ (style.sources.maplibre)
    assert.equal(vectorSource.type, 'vector')
    assert(Array.isArray(vectorSource.tiles), 'vector source has tiles array')
    assert(typeof vectorSource.tiles[0] === 'string')

    // GeoJSON source has inlined data object
    const geojsonSource = /** @type {any} */ (style.sources.crimea)
    assert.equal(geojsonSource.type, 'geojson')
    assert.equal(typeof geojsonSource.data, 'object', 'geojson data is object')
  })

  test('getStyle() can be called multiple times', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const style1 = await downloader.getStyle()
    const style2 = await downloader.getStyle()
    assert.equal(style1.version, style2.version)
    assert.deepEqual(Object.keys(style1.sources), Object.keys(style2.sources))
  })

  test('getStyle() with style object returns inlined sources', async () => {
    const res = await fetch(server.baseUrl + 'style.json')
    const style = await res.json()
    const downloader = new StyleDownloader(style)
    const result = await downloader.getStyle()

    assert.equal(result.version, 8)
    assert(Array.isArray(result.layers))
  })

  test('getSprites() yields nothing for style without sprites', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const sprites = []
    for await (const sprite of downloader.getSprites()) {
      sprites.push(sprite)
    }
    assert.equal(sprites.length, 0)
  })

  test('getGlyphs() yields glyph data for each font range', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const glyphs = []
    for await (const [stream, glyphInfo] of downloader.getGlyphs()) {
      await streamToBuffer(stream)
      glyphs.push(glyphInfo)
    }

    assert(glyphs.length > 0, 'at least some glyphs downloaded')
    // demotiles has 1 font: "Open Sans Semibold"
    assert.equal(glyphs[0].font, 'Open Sans Semibold')
    assert(typeof glyphs[0].range === 'string')
    assert(glyphs[0].range.includes('-'), 'range has format "N-N"')
  })

  test('getGlyphs() reports progress', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    /** @type {import('../lib/style-downloader.js').GlyphDownloadStats[]} */
    const progressUpdates = []
    const glyphs = downloader.getGlyphs({
      onprogress: (stats) => progressUpdates.push({ ...stats }),
    })

    for await (const [stream] of glyphs) {
      await streamToBuffer(stream)
    }

    assert(progressUpdates.length > 0, 'onprogress was called')
    const last = progressUpdates[progressUpdates.length - 1]
    assert.equal(last.total, 256, '256 glyph ranges for 1 font')
    assert(last.downloaded > 0, 'some glyphs downloaded')
    assert(last.totalBytes > 0, 'totalBytes > 0')
  })

  test('getGlyphs() yields nothing for style without glyphs', async () => {
    const style = {
      version: /** @type {const} */ (8),
      sources: {},
      layers: /** @type {any[]} */ ([]),
    }
    const downloader = new StyleDownloader(style)
    const glyphs = []
    for await (const entry of downloader.getGlyphs()) {
      glyphs.push(entry)
    }
    assert.equal(glyphs.length, 0)
  })

  test('getTiles() yields tile data', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const tiles = downloader.getTiles({
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 1,
    })

    const collected = []
    for await (const [stream, tileInfo] of tiles) {
      const buf = await streamToBuffer(stream)
      assert(buf.length > 0, 'tile is non-empty')
      collected.push(tileInfo)
    }

    assert(collected.length > 0, 'at least one tile')
    assert(typeof collected[0].z === 'number')
    assert(typeof collected[0].x === 'number')
    assert(typeof collected[0].y === 'number')
    assert(typeof collected[0].sourceId === 'string')
  })

  test('getTiles() exposes stats and skipped', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const tiles = downloader.getTiles({
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 1,
    })

    for await (const [stream] of tiles) {
      await streamToBuffer(stream)
    }

    assert(tiles.stats.total > 0, 'total > 0')
    assert(tiles.stats.downloaded > 0, 'downloaded > 0')
    assert(tiles.stats.totalBytes > 0, 'totalBytes > 0')
    assert.equal(tiles.skipped.length, 0, 'no skipped tiles')
  })

  test('getTiles() reports progress', async () => {
    /** @type {import('../lib/tile-downloader.js').TileDownloadStats[]} */
    const progressUpdates = []
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const tiles = downloader.getTiles({
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 1,
      onprogress: (stats) => progressUpdates.push({ ...stats }),
    })

    for await (const [stream] of tiles) {
      await streamToBuffer(stream)
    }

    assert(progressUpdates.length > 0, 'onprogress was called')
    const last = progressUpdates[progressUpdates.length - 1]
    assert(last.downloaded > 0)
  })

  test('getTiles() skips non-tile sources like geojson', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const tiles = downloader.getTiles({
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 1,
    })

    const sourceIds = new Set()
    for await (const [stream, tileInfo] of tiles) {
      await streamToBuffer(stream)
      sourceIds.add(tileInfo.sourceId)
    }

    assert(!sourceIds.has('crimea'), 'geojson source not in tile output')
    assert(sourceIds.has('maplibre'), 'vector source is in tile output')
  })

  test('getTiles() clamps to source maxzoom', async () => {
    // demotiles has maxzoom=2, so requesting maxzoom=10 should not yield z>2
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const tiles = downloader.getTiles({
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 10,
    })

    let maxZSeen = 0
    for await (const [stream, tileInfo] of tiles) {
      await streamToBuffer(stream)
      if (tileInfo.z > maxZSeen) maxZSeen = tileInfo.z
    }

    assert(maxZSeen <= 2, `max z seen was ${maxZSeen}, expected <= 2`)
  })
})

describe('StyleDownloader with osm-bright-z6 (sprites)', () => {
  /** @type {{ baseUrl: string, close: () => Promise<void> }} */
  let server

  beforeAll(async () => {
    const fixturePath = fileURLToPath(
      new URL('./fixtures/osm-bright-z6.smp', import.meta.url),
    )
    server = await startSMPServer(fixturePath)
  })

  afterAll(async () => {
    if (server) await server.close()
  })

  test('getSprites() yields sprite data at 1x and 2x', async () => {
    const downloader = new StyleDownloader(server.baseUrl + 'style.json')
    const sprites = []
    for await (const sprite of downloader.getSprites()) {
      const jsonBuf = await streamToBuffer(sprite.json)
      const pngBuf = await streamToBuffer(sprite.png)
      assert(jsonBuf.length > 0, 'json buffer is non-empty')
      assert(pngBuf.length > 0, 'png buffer is non-empty')
      sprites.push({ id: sprite.id, pixelRatio: sprite.pixelRatio })
    }

    assert.equal(sprites.length, 2, '1x and 2x')
    assert.equal(sprites[0].id, 'default')
    assert.equal(sprites[0].pixelRatio, 1)
    assert.equal(sprites[1].id, 'default')
    assert.equal(sprites[1].pixelRatio, 2)
  })
})

describe('StyleDownloader with un-inlined sources', () => {
  /** @type {{ baseUrl: string, close: () => Promise<void> }} */
  let smpServer
  /** @type {import('node:http').Server} */
  let jsonServer
  /** @type {string} */
  let jsonBaseUrl

  const TILEJSON = {
    tilejson: '3.0.0',
    tiles: ['PLACEHOLDER'],
    bounds: [-180, -85, 180, 85],
    maxzoom: 2,
    minzoom: 0,
    vector_layers: [{ id: 'test', fields: {} }],
  }

  const GEOJSON = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { name: 'test' },
      },
    ],
  }

  beforeAll(async () => {
    // Start the SMP server to get real tile URLs
    const fixturePath = fileURLToPath(
      new URL('./fixtures/demotiles-z2.smp', import.meta.url),
    )
    smpServer = await startSMPServer(fixturePath)

    // Fetch the real style to get the tile URL pattern
    const res = await fetch(smpServer.baseUrl + 'style.json')
    const style = await res.json()
    const vectorSource = /** @type {any} */ (
      Object.values(style.sources).find(
        (/** @type {any} */ s) => s.type === 'vector',
      )
    )
    TILEJSON.tiles = vectorSource.tiles

    // Start a simple JSON server for TileJSON and GeoJSON endpoints
    jsonServer = createHTTPServer((req, res) => {
      if (req.url === '/tilejson.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(TILEJSON))
      } else if (req.url === '/data.geojson') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(GEOJSON))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await /** @type {Promise<void>} */ (
      new Promise((resolve) => jsonServer.listen(0, resolve))
    )
    const { port } = /** @type {import('node:net').AddressInfo} */ (
      jsonServer.address()
    )
    jsonBaseUrl = `http://localhost:${port}/`
  })

  afterAll(async () => {
    if (smpServer) await smpServer.close()
    if (jsonServer) await new Promise((resolve) => jsonServer.close(resolve))
  })

  test('getStyle() inlines vector source with url (TileJSON)', async () => {
    const style = {
      version: /** @type {const} */ (8),
      sources: {
        myVector: {
          type: /** @type {const} */ ('vector'),
          url: jsonBaseUrl + 'tilejson.json',
        },
      },
      layers: /** @type {any[]} */ ([]),
    }
    const downloader = new StyleDownloader(style)
    const result = await downloader.getStyle()

    const source = /** @type {any} */ (result.sources.myVector)
    assert.equal(source.type, 'vector')
    assert(Array.isArray(source.tiles), 'has tiles array from TileJSON')
    assert(source.tiles.length > 0, 'tiles array is non-empty')
    assert.deepEqual(source.bounds, [-180, -85, 180, 85])
    assert.equal(source.maxzoom, 2)
    assert.deepEqual(source.vector_layers, [{ id: 'test', fields: {} }])
  })

  test('getStyle() inlines geojson source with string data URL', async () => {
    const style = {
      version: /** @type {const} */ (8),
      sources: {
        myGeojson: {
          type: /** @type {const} */ ('geojson'),
          data: jsonBaseUrl + 'data.geojson',
        },
      },
      layers: /** @type {any[]} */ ([]),
    }
    const downloader = new StyleDownloader(style)
    const result = await downloader.getStyle()

    const source = /** @type {any} */ (result.sources.myGeojson)
    assert.equal(source.type, 'geojson')
    assert.equal(typeof source.data, 'object', 'data is now an object')
    assert.equal(source.data.type, 'FeatureCollection')
    assert.equal(source.data.features.length, 1)
    assert.equal(source.data.features[0].properties.name, 'test')
  })

  test('getTiles() works with un-inlined vector source', async () => {
    const style = {
      version: /** @type {const} */ (8),
      sources: {
        myVector: {
          type: /** @type {const} */ ('vector'),
          url: jsonBaseUrl + 'tilejson.json',
        },
      },
      layers: /** @type {any[]} */ ([]),
    }
    const downloader = new StyleDownloader(style)
    const tiles = downloader.getTiles({
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 0,
    })

    let count = 0
    for await (const [stream, tileInfo] of tiles) {
      await streamToBuffer(stream)
      assert.equal(tileInfo.sourceId, 'myVector')
      count++
    }
    assert(count > 0, 'downloaded at least one tile')
  })
})
