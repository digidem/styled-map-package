import { afterAll, beforeAll, describe, test } from 'vitest'

import assert from 'node:assert/strict'
import { createServer as createHTTPServer } from 'node:http'
import { buffer as streamToBuffer } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import zlib from 'node:zlib'

import { downloadTiles, tileIterator } from '../lib/tile-downloader.js'
import { startSMPServer } from './utils/smp-server.js'

const gzip = promisify(zlib.gzip)

describe('tileIterator', () => {
  test('generates correct tiles for global bounds z0-1', () => {
    const tiles = [...tileIterator({ maxzoom: 1 })]
    // z0: 1 tile (0,0,0), z1: 4 tiles (0,0,1), (0,1,1), (1,0,1), (1,1,1)
    assert.equal(tiles.length, 5)
    assert.deepEqual(tiles[0], { x: 0, y: 0, z: 0 })
    const z1Tiles = tiles.filter((t) => t.z === 1)
    assert.equal(z1Tiles.length, 4)
  })

  test('minzoom skips lower zoom levels', () => {
    const tiles = [...tileIterator({ minzoom: 1, maxzoom: 1 })]
    assert.equal(tiles.filter((t) => t.z === 0).length, 0, 'no z0 tiles')
    assert.equal(tiles.length, 4, 'only z1 tiles')
  })

  test('sourceBounds constrains tile output', () => {
    const allTiles = [...tileIterator({ maxzoom: 2 })]
    const constrained = [
      ...tileIterator({
        maxzoom: 2,
        sourceBounds: [0, 0, 90, 45],
      }),
    ]
    assert(
      constrained.length < allTiles.length,
      'sourceBounds reduces tile count',
    )
    // At z0, the single tile should still be yielded since the bounds overlap
    assert(constrained.some((t) => t.z === 0))
  })

  test('boundsBuffer adds extra tiles at edges', () => {
    // boundsBuffer only has effect when sourceBounds is larger than bounds
    const bounds = /** @type {const} */ ([10, 10, 20, 20])
    const sourceBounds = /** @type {const} */ ([-180, -85, 180, 85])
    const withoutBuffer = [
      ...tileIterator({
        bounds,
        maxzoom: 3,
        boundsBuffer: false,
        sourceBounds,
      }),
    ]
    const withBuffer = [
      ...tileIterator({
        bounds,
        maxzoom: 3,
        boundsBuffer: true,
        sourceBounds,
      }),
    ]
    assert(
      withBuffer.length > withoutBuffer.length,
      `buffer (${withBuffer.length}) > no buffer (${withoutBuffer.length})`,
    )
  })

  test('small bounds yields few tiles per zoom', () => {
    // A very small area should yield ~1 tile per zoom
    const bounds = /** @type {const} */ ([10, 10, 10.001, 10.001])
    const tiles = [...tileIterator({ bounds, maxzoom: 2 })]
    // Should yield 1 tile per zoom level for this tiny area
    for (let z = 0; z <= 2; z++) {
      assert(
        tiles.filter((t) => t.z === z).length >= 1,
        `at least 1 tile at z${z}`,
      )
    }
  })
})

describe('downloadTiles', () => {
  /** @type {{ baseUrl: string, close: () => Promise<void> }} */
  let server
  /** @type {string[]} */
  let tileUrls

  beforeAll(async () => {
    const fixturePath = fileURLToPath(
      new URL('./fixtures/demotiles-z2.smp', import.meta.url),
    )
    server = await startSMPServer(fixturePath)
    const res = await fetch(server.baseUrl + 'style.json')
    const style = await res.json()
    const vectorSource = Object.values(style.sources).find(
      (/** @type {any} */ s) => s.type === 'vector',
    )
    tileUrls = /** @type {any} */ (vectorSource).tiles
  })

  afterAll(async () => {
    if (server) await server.close()
  })

  test('downloads tiles and yields [stream, tileInfo] tuples', async () => {
    const tiles = downloadTiles({
      tileUrls,
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 1,
    })

    let count = 0
    for await (const [stream, tileInfo] of tiles) {
      const buf = await streamToBuffer(stream)
      assert(buf.length > 0, 'tile buffer is non-empty')
      assert(typeof tileInfo.z === 'number')
      assert(typeof tileInfo.x === 'number')
      assert(typeof tileInfo.y === 'number')
      assert(typeof tileInfo.format === 'string')
      count++
    }
    assert(count > 0, 'at least one tile was downloaded')
  })

  test('MVT tiles are gzipped', async () => {
    const tiles = downloadTiles({
      tileUrls,
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 0,
    })

    for await (const [stream, tileInfo] of tiles) {
      const buf = await streamToBuffer(stream)
      assert.equal(tileInfo.format, 'mvt')
      // Gzip magic bytes
      assert.equal(buf[0], 0x1f, 'first byte is gzip magic')
      assert.equal(buf[1], 0x8b, 'second byte is gzip magic')
    }
  })

  test('stats and skipped properties', async () => {
    const tiles = downloadTiles({
      tileUrls,
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 1,
    })

    for await (const [stream] of tiles) {
      await streamToBuffer(stream)
    }

    assert(tiles.stats.total > 0, 'total > 0')
    assert.equal(tiles.stats.downloaded, tiles.stats.total, 'all downloaded')
    assert.equal(tiles.stats.skipped, 0, 'none skipped')
    assert(tiles.stats.totalBytes > 0, 'totalBytes > 0')
    assert.equal(tiles.skipped.length, 0, 'skipped array is empty')
  })

  test('onprogress callback is called', async () => {
    /** @type {import('../lib/tile-downloader.js').TileDownloadStats[]} */
    const progressUpdates = []
    const tiles = downloadTiles({
      tileUrls,
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 1,
      onprogress: (stats) => progressUpdates.push({ ...stats }),
    })

    for await (const [stream] of tiles) {
      await streamToBuffer(stream)
    }

    assert(progressUpdates.length > 0, 'onprogress was called')
    const last = progressUpdates[progressUpdates.length - 1]
    assert(last.total > 0)
    assert(last.downloaded > 0)
  })

  test('handles 404 tiles gracefully', async () => {
    const tiles = downloadTiles({
      tileUrls: [server.baseUrl + 's/nonexistent/{z}/{x}/{y}.mvt.gz'],
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 0,
    })

    let count = 0
    for await (const [stream] of tiles) {
      await streamToBuffer(stream)
      count++
    }

    assert.equal(count, 0, 'no tiles yielded')
    assert(tiles.skipped.length > 0, 'skipped has entries')
  })

  test('trackErrors includes error objects in skipped', async () => {
    const tiles = downloadTiles({
      tileUrls: [server.baseUrl + 's/nonexistent/{z}/{x}/{y}.mvt.gz'],
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 0,
      trackErrors: true,
    })

    for await (const [stream] of tiles) {
      await streamToBuffer(stream)
    }

    assert(tiles.skipped.length > 0)
    assert(tiles.skipped[0].error instanceof Error, 'error is an Error')
  })
})

describe('downloadTiles without Content-Type header', () => {
  /** @type {{ baseUrl: string, close: () => Promise<void> }} */
  let smpServer
  /** @type {import('node:http').Server} */
  let noCtServer
  /** @type {string} */
  let noCtBaseUrl
  /** @type {Buffer} */
  let tileBuffer

  beforeAll(async () => {
    // Start SMP server to get a real tile
    const fixturePath = fileURLToPath(
      new URL('./fixtures/demotiles-z2.smp', import.meta.url),
    )
    smpServer = await startSMPServer(fixturePath)

    // Fetch a real tile and re-gzip it (fetch auto-decompresses)
    const res = await fetch(smpServer.baseUrl + 'style.json')
    const style = await res.json()
    const vectorSource = /** @type {any} */ (
      Object.values(style.sources).find(
        (/** @type {any} */ s) => s.type === 'vector',
      )
    )
    const tileUrl = vectorSource.tiles[0]
      .replace('{z}', '0')
      .replace('{x}', '0')
      .replace('{y}', '0')
    const tileRes = await fetch(tileUrl)
    const rawTile = Buffer.from(await tileRes.arrayBuffer())
    // Re-gzip so magic bytes (0x1f, 0x8b) are present for detection
    tileBuffer = await gzip(rawTile)

    // Start a server that serves tiles without Content-Type
    noCtServer = createHTTPServer((req, res) => {
      const match = req.url?.match(/\/(\d+)\/(\d+)\/(\d+)\.tile/)
      if (match) {
        // Deliberately omit Content-Type header
        res.writeHead(200, { 'Content-Length': String(tileBuffer.length) })
        res.end(tileBuffer)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await /** @type {Promise<void>} */ (
      new Promise((resolve) => noCtServer.listen(0, resolve))
    )
    const { port } = /** @type {import('node:net').AddressInfo} */ (
      noCtServer.address()
    )
    noCtBaseUrl = `http://localhost:${port}/`
  })

  afterAll(async () => {
    if (smpServer) await smpServer.close()
    if (noCtServer) await new Promise((resolve) => noCtServer.close(resolve))
  })

  test('falls back to magic byte detection when no Content-Type', async () => {
    const tiles = downloadTiles({
      tileUrls: [noCtBaseUrl + '{z}/{x}/{y}.tile'],
      bounds: /** @type {const} */ ([-180, -85, 180, 85]),
      maxzoom: 0,
    })

    let count = 0
    for await (const [stream, tileInfo] of tiles) {
      const buf = await streamToBuffer(stream)
      assert(buf.length > 0, 'tile has content')
      assert.equal(tileInfo.format, 'mvt', 'detected as mvt from magic bytes')
      count++
    }
    assert(count > 0, 'at least one tile downloaded')
  })
})
