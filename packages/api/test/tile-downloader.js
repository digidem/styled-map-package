import { afterAll, assert, beforeAll, describe, test, vi } from 'vitest'

import { createServer as createHTTPServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import zlib from 'node:zlib'

import { downloadTiles, tileIterator } from '../lib/tile-downloader.js'
import { FetchQueue } from '../lib/utils/fetch.js'
import { startSMPServer } from './utils/smp-server.js'
import { streamToBuffer } from './utils/stream-consumers.js'

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

  test('bufferTiles adds extra tile rings at edges', () => {
    // bufferTiles only has effect when sourceBounds is larger than bounds
    const bounds = /** @type {const} */ ([10, 10, 20, 20])
    const sourceBounds = /** @type {const} */ ([-180, -85, 180, 85])
    const withoutBuffer = [
      ...tileIterator({ bounds, maxzoom: 3, bufferTiles: 0, sourceBounds }),
    ]
    const oneRing = [
      ...tileIterator({ bounds, maxzoom: 3, bufferTiles: 1, sourceBounds }),
    ]
    const twoRings = [
      ...tileIterator({ bounds, maxzoom: 3, bufferTiles: 2, sourceBounds }),
    ]
    assert(
      oneRing.length > withoutBuffer.length,
      `1 ring (${oneRing.length}) > no buffer (${withoutBuffer.length})`,
    )
    assert(
      twoRings.length > oneRing.length,
      `2 rings (${twoRings.length}) > 1 ring (${oneRing.length})`,
    )
  })

  test('bufferTiles defaults to 0 (no buffer)', () => {
    const bounds = /** @type {const} */ ([10, 10, 20, 20])
    const sourceBounds = /** @type {const} */ ([-180, -85, 180, 85])
    const defaulted = [...tileIterator({ bounds, maxzoom: 3, sourceBounds })]
    const explicitZero = [
      ...tileIterator({ bounds, maxzoom: 3, bufferTiles: 0, sourceBounds }),
    ]
    assert.deepEqual(defaulted, explicitZero)
  })

  test('bufferTiles of N expands the tile range by N at each edge below maxzoom', () => {
    // Small bounds, large source so the buffer is not clamped. Zoom 8 is below
    // maxzoom (9), so the buffer applies there.
    const bounds = /** @type {const} */ ([10, 10, 11, 11])
    const sourceBounds = /** @type {const} */ ([-180, -85, 180, 85])
    const atZoom = (/** @type {{x:number,y:number,z:number}[]} */ tiles) =>
      tiles.filter((t) => t.z === 8)
    const baseTiles = atZoom([
      ...tileIterator({
        bounds,
        minzoom: 8,
        maxzoom: 9,
        bufferTiles: 0,
        sourceBounds,
      }),
    ])
    const baseXs = baseTiles.map((t) => t.x)
    const baseYs = baseTiles.map((t) => t.y)
    const buffered = atZoom([
      ...tileIterator({
        bounds,
        minzoom: 8,
        maxzoom: 9,
        bufferTiles: 2,
        sourceBounds,
      }),
    ])
    const bufferedXs = buffered.map((t) => t.x)
    const bufferedYs = buffered.map((t) => t.y)
    assert.equal(Math.min(...bufferedXs), Math.min(...baseXs) - 2)
    assert.equal(Math.max(...bufferedXs), Math.max(...baseXs) + 2)
    assert.equal(Math.min(...bufferedYs), Math.min(...baseYs) - 2)
    assert.equal(Math.max(...bufferedYs), Math.max(...baseYs) + 2)
  })

  test('bufferTiles is not applied at maxzoom', () => {
    // The buffer improves coverage when zooming out, so maxzoom gets no buffer.
    const bounds = /** @type {const} */ ([10, 10, 11, 11])
    const sourceBounds = /** @type {const} */ ([-180, -85, 180, 85])
    const atMaxzoom = (/** @type {{x:number,y:number,z:number}[]} */ tiles) =>
      tiles.filter((t) => t.z === 8)
    const base = atMaxzoom([
      ...tileIterator({
        bounds,
        minzoom: 8,
        maxzoom: 8,
        bufferTiles: 0,
        sourceBounds,
      }),
    ])
    const buffered = atMaxzoom([
      ...tileIterator({
        bounds,
        minzoom: 8,
        maxzoom: 8,
        bufferTiles: 2,
        sourceBounds,
      }),
    ])
    assert.deepEqual(buffered, base)
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
    assert(tiles.stats.downloaded > 0, 'some tiles downloaded')
    assert(tiles.stats.totalBytes > 0, 'totalBytes > 0')
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

describe('downloadTiles cancellation', () => {
  /** Serves tiles slowly and large enough that an unread body blocks on backpressure. */
  function startSlowTileServer() {
    let started = 0
    let inflight = 0
    /** @type {Set<import('node:http').ServerResponse>} */
    const open = new Set()
    const server = createHTTPServer((req, res) => {
      started++
      inflight++
      open.add(res)
      res.on('close', () => {
        inflight--
        open.delete(res)
      })
      res.writeHead(200, {
        'content-type': 'application/vnd.mapbox-vector-tile',
      })
      let chunks = 0
      const interval = setInterval(() => {
        if (chunks++ > 16) {
          clearInterval(interval)
          res.end()
          return
        }
        res.write(Buffer.alloc(64 * 1024, 1))
      }, 5)
      res.on('close', () => clearInterval(interval))
    })
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = /** @type {import('node:net').AddressInfo} */ (
          server.address()
        )
        resolve({
          tileUrl: `http://127.0.0.1:${port}/{z}/{x}/{y}.mvt`,
          get started() {
            return started
          },
          get inflight() {
            return inflight
          },
          close: async () => {
            for (const res of open) res.destroy()
            await new Promise((r) => server.close(r))
          },
        })
      })
    })
  }

  test('breaking out of the loop frees the shared fetch queue', async () => {
    const server = await startSlowTileServer()
    try {
      // A StyleDownloader shares one queue across tiles, glyphs and sprites, so
      // a body left unread after cancellation stalls the rest of the download.
      const fetchQueue = new FetchQueue(2)
      const tiles = downloadTiles({
        tileUrls: [server.tileUrl],
        bounds: /** @type {const} */ ([-180, -85, 180, 85]),
        maxzoom: 2,
        fetchQueue,
      })

      for await (const [stream] of tiles) {
        await streamToBuffer(stream)
        break
      }

      const next = fetchQueue.fetch(server.tileUrl.replace(/\{[zxy]\}/g, '0'))
      const { body } = await Promise.race([
        next,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('fetch queue is still blocked')),
            5000,
          ),
        ),
      ])
      await streamToBuffer(body)
    } finally {
      await server.close()
    }
  })

  test('aborting the signal stops downloads that have not started', async () => {
    const server = await startSlowTileServer()
    try {
      const ac = new AbortController()
      const tiles = downloadTiles({
        tileUrls: [server.tileUrl],
        bounds: /** @type {const} */ ([-180, -85, 180, 85]),
        maxzoom: 3, // 85 tiles, far more than the concurrency limit
        concurrency: 4,
        signal: ac.signal,
      })

      for await (const [stream] of tiles) {
        await streamToBuffer(stream)
        ac.abort()
        break
      }

      const startedAtAbort = server.started
      await vi.waitFor(() => assert.equal(server.inflight, 0), {
        timeout: 5000,
        interval: 50,
      })
      assert(
        server.started <= startedAtAbort + 4,
        `no queued tiles fetched after abort (started ${server.started}, was ${startedAtAbort})`,
      )
    } finally {
      await server.close()
    }
  })
})
