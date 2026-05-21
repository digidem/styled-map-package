import { ZipReader } from '@gmaclennan/zip-reader'
import { BufferSource } from '@gmaclennan/zip-reader/buffer-source'
import { afterAll, assert, beforeAll, describe, expect, test } from 'vitest'

import { readFileSync } from 'node:fs'
import { createServer as createHTTPServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { download } from '../lib/download.js'
import {
  downloadPmtilesTiles,
  isPmtilesUrl,
  openPmtiles,
  resolvePmtilesUrl,
} from '../lib/pmtiles-downloader.js'
import { Reader } from '../lib/reader.js'
import { StyleDownloader } from '../lib/style-downloader.js'
import { streamToBuffer } from './utils/stream-consumers.js'

// The .pmtiles fixtures were generated from the existing mbtiles/smp fixtures
// with the Protomaps `pmtiles` CLI:
//   plain_1.pmtiles     — raster, from plain_1.mbtiles (format=png added)
//   demotiles-z2.pmtiles — vector, from the demotiles-z2.smp tiles (z0-2)

const WORLD = /** @type {const} */ ([-180, -85.051129, 180, 85.051129])

/** @param {string} name */
function loadFixture(name) {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
  )
}

/**
 * A static file server with HTTP Range support (required by the pmtiles
 * `FetchSource`) and permissive CORS.
 *
 * @param {Map<string, Buffer>} files Map of URL path → file contents
 */
function createRangeServer(files) {
  return createHTTPServer((req, res) => {
    /** @type {Record<string, string | number>} */
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    }
    const url = (req.url || '').split('?')[0]
    const body = files.get(url)
    if (!body) {
      res.writeHead(404, headers)
      res.end()
      return
    }
    if (url.endsWith('.json')) headers['Content-Type'] = 'application/json'
    const match =
      req.headers.range && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range)
    if (match) {
      const start = Number(match[1])
      const end =
        match[2] === ''
          ? body.length - 1
          : Math.min(Number(match[2]), body.length - 1)
      const slice = body.subarray(start, end + 1)
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
        'Content-Length': slice.length,
      })
      res.end(slice)
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': body.length })
      res.end(body)
    }
  })
}

/**
 * All XYZ tile coordinates covering the world for zoom levels 0..maxzoom
 * @param {number} maxzoom
 */
function worldCoords(maxzoom) {
  /** @type {Array<{ z: number, x: number, y: number }>} */
  const coords = []
  for (let z = 0; z <= maxzoom; z++) {
    for (let x = 0; x < 2 ** z; x++) {
      for (let y = 0; y < 2 ** z; y++) coords.push({ z, x, y })
    }
  }
  return coords
}

/** @param {string} template @param {Record<string, number>} vars */
function fillTemplate(template, vars) {
  return template.replace(/{(.*?)}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  )
}

/** @type {import('node:http').Server} */
let server
/** @type {string} */
let baseUrl
const files = new Map()

function vectorStyle() {
  return {
    version: /** @type {const} */ (8),
    sources: {
      demo: {
        type: /** @type {const} */ ('vector'),
        url: `pmtiles://${baseUrl}/demotiles-z2.pmtiles`,
      },
    },
    layers: /** @type {any[]} */ ([
      { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
      {
        id: 'countries',
        type: 'line',
        source: 'demo',
        'source-layer': 'countries',
      },
    ]),
  }
}

function rasterStyle() {
  return {
    version: /** @type {const} */ (8),
    sources: {
      plain: {
        type: /** @type {const} */ ('raster'),
        url: `pmtiles://${baseUrl}/plain_1.pmtiles`,
        tileSize: 256,
      },
    },
    layers: /** @type {any[]} */ ([
      { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
      { id: 'raster', type: 'raster', source: 'plain' },
    ]),
  }
}

beforeAll(async () => {
  files.set('/plain_1.pmtiles', loadFixture('plain_1.pmtiles'))
  files.set('/demotiles-z2.pmtiles', loadFixture('demotiles-z2.pmtiles'))
  server = createRangeServer(files)
  await /** @type {Promise<void>} */ (
    new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  )
  const { port } = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  )
  baseUrl = `http://127.0.0.1:${port}`
  files.set('/vector-style.json', Buffer.from(JSON.stringify(vectorStyle())))
  files.set('/raster-style.json', Buffer.from(JSON.stringify(rasterStyle())))
})

afterAll(async () => {
  if (server)
    await new Promise((resolve) => server.close(() => resolve(undefined)))
})

describe('isPmtilesUrl / resolvePmtilesUrl', () => {
  test('detects the pmtiles:// protocol prefix', () => {
    assert.equal(isPmtilesUrl('pmtiles://https://example.com/a.pmtiles'), true)
    assert.equal(isPmtilesUrl('pmtiles://https://example.com/tiles.json'), true)
  })
  test('detects a plain .pmtiles url, ignoring query/hash', () => {
    assert.equal(isPmtilesUrl('https://example.com/a.pmtiles'), true)
    assert.equal(isPmtilesUrl('https://example.com/a.PMTiles?v=1'), true)
  })
  test('rejects non-pmtiles urls', () => {
    assert.equal(isPmtilesUrl('https://example.com/tiles.json'), false)
    assert.equal(isPmtilesUrl('mapbox://mapbox.streets'), false)
  })
  test('resolvePmtilesUrl strips only the pmtiles:// prefix', () => {
    assert.equal(
      resolvePmtilesUrl('pmtiles://https://example.com/a.pmtiles'),
      'https://example.com/a.pmtiles',
    )
    assert.equal(
      resolvePmtilesUrl('https://example.com/a.pmtiles'),
      'https://example.com/a.pmtiles',
    )
  })
})

describe('openPmtiles', () => {
  test('reads a vector archive header and metadata', async () => {
    const handle = await openPmtiles(`${baseUrl}/demotiles-z2.pmtiles`)
    assert.equal(handle.format, 'mvt')
    assert.equal(handle.source.minzoom, 0)
    assert.equal(handle.source.maxzoom, 2)
    assert.equal(handle.source.bounds.length, 4)
    assert.equal(handle.source.bounds[0], -180)
    assert.equal(handle.source.bounds[2], 180)
    assert(Array.isArray(handle.source.vector_layers))
    assert(
      (handle.source.vector_layers || []).length > 0,
      'has vector_layers from metadata',
    )
  })
  test('reads a raster archive, accepting the pmtiles:// prefix', async () => {
    const handle = await openPmtiles(`pmtiles://${baseUrl}/plain_1.pmtiles`)
    assert.equal(handle.format, 'png')
    assert.equal(handle.source.minzoom, 0)
    assert.equal(handle.source.maxzoom, 4)
  })
})

describe('downloadPmtilesTiles', () => {
  test('reads all vector tiles, gzip-compressed', async () => {
    const handle = await openPmtiles(`${baseUrl}/demotiles-z2.pmtiles`)
    const tiles = downloadPmtilesTiles({
      pmtiles: handle.pmtiles,
      format: handle.format,
      bounds: [...WORLD],
      minzoom: 0,
      maxzoom: 2,
      sourceBounds: handle.source.bounds,
    })
    let count = 0
    for await (const [stream, info] of tiles) {
      count++
      assert.equal(info.format, 'mvt')
      const buf = await streamToBuffer(stream)
      assert.equal(buf[0], 0x1f, 'gzip magic byte 1')
      assert.equal(buf[1], 0x8b, 'gzip magic byte 2')
      assert(gunzipSync(buf).length > 0, 'decompresses to a non-empty tile')
    }
    assert.equal(count, 21, 'all 21 world tiles z0-2')
    assert.equal(tiles.stats.downloaded, 21)
    assert.equal(tiles.skipped.length, 0)
  })

  test('reads raster tiles without gzip compression', async () => {
    const handle = await openPmtiles(`${baseUrl}/plain_1.pmtiles`)
    const tiles = downloadPmtilesTiles({
      pmtiles: handle.pmtiles,
      format: handle.format,
      bounds: [...WORLD],
      minzoom: 0,
      maxzoom: 1,
      sourceBounds: handle.source.bounds,
    })
    let count = 0
    for await (const [stream, info] of tiles) {
      count++
      assert.equal(info.format, 'png')
      const buf = await streamToBuffer(stream)
      assert.equal(buf[0], 0x89, 'png magic byte')
      assert.equal(buf[1], 0x50, 'png magic byte')
    }
    assert(count > 0, 'read at least one raster tile')
    assert.equal(tiles.stats.downloaded, count)
  })

  test('tiles absent from the archive are dropped from the total, not skipped', async () => {
    const handle = await openPmtiles(`${baseUrl}/demotiles-z2.pmtiles`)
    // maxzoom 3 is beyond the archive's maxzoom of 2 — z3 tiles do not exist.
    const tiles = downloadPmtilesTiles({
      pmtiles: handle.pmtiles,
      format: handle.format,
      bounds: [...WORLD],
      minzoom: 0,
      maxzoom: 3,
      sourceBounds: handle.source.bounds,
    })
    let count = 0
    // eslint-disable-next-line no-unused-vars
    for await (const _tile of tiles) count++
    assert.equal(count, 21, 'only the 21 existing tiles are yielded')
    assert.equal(tiles.stats.downloaded, 21)
    assert.equal(tiles.stats.total, 21, 'absent tiles removed from total')
    assert.equal(tiles.skipped.length, 0, 'absent tiles are not failures')
  })
})

describe('StyleDownloader with a PMTiles source', () => {
  test('getStyle() inlines a pmtiles vector source', async () => {
    const downloader = new StyleDownloader(vectorStyle())
    const style = await downloader.getStyle()
    const src = /** @type {any} */ (style.sources.demo)
    assert.equal(src.type, 'vector')
    assert.equal(src.minzoom, 0)
    assert.equal(src.maxzoom, 2)
    assert(Array.isArray(src.vector_layers), 'vector_layers inlined')
  })

  test('getTiles() yields tiles for a pmtiles source', async () => {
    const downloader = new StyleDownloader(vectorStyle())
    const tiles = downloader.getTiles({ bounds: [...WORLD], maxzoom: 2 })
    let count = 0
    for await (const [, info] of tiles) {
      count++
      assert.equal(info.sourceId, 'demo')
      assert.equal(info.format, 'mvt')
    }
    assert.equal(count, 21)
  })

  test('getStyle() rejects a raster-dem pmtiles source', async () => {
    const downloader = new StyleDownloader({
      version: 8,
      sources: {
        terrain: {
          type: 'raster-dem',
          url: `pmtiles://${baseUrl}/plain_1.pmtiles`,
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
      ],
    })
    await expect(downloader.getStyle()).rejects.toThrow(/raster-dem PMTiles/)
  })
})

describe('download() with a PMTiles source', () => {
  test(
    'vector pmtiles → valid, complete smp',
    { timeout: 30_000 },
    async () => {
      const smpStream = download({
        styleUrl: `${baseUrl}/vector-style.json`,
        bbox: [...WORLD],
        maxzoom: 2,
      })
      const smpBuf = await streamToBuffer(smpStream)
      const reader = new Reader(await ZipReader.from(new BufferSource(smpBuf)))
      const style = await reader.getStyle('')

      const src = /** @type {any} */ (Object.values(style.sources)[0])
      assert.equal(src.type, 'vector')
      const tileUrl = src.tiles[0]
      assert(typeof tileUrl === 'string')

      // Every world tile for z0-2 must be present and be gzipped MVT.
      for (const { z, x, y } of worldCoords(2)) {
        const resource = await reader.getResource(
          fillTemplate(tileUrl, { z, x, y }),
        )
        assert.equal(resource.contentEncoding, 'gzip')
        const data = await streamToBuffer(resource.stream)
        assert.equal(data[0], 0x1f, `tile ${z}/${x}/${y} is gzipped`)
        assert(gunzipSync(data).length > 0, `tile ${z}/${x}/${y} decompresses`)
      }
    },
  )

  test(
    'raster pmtiles → smp with uncompressed png tiles',
    { timeout: 30_000 },
    async () => {
      const smpStream = download({
        styleUrl: `${baseUrl}/raster-style.json`,
        bbox: [...WORLD],
        maxzoom: 2,
      })
      const smpBuf = await streamToBuffer(smpStream)
      const reader = new Reader(await ZipReader.from(new BufferSource(smpBuf)))
      const style = await reader.getStyle('')

      const src = /** @type {any} */ (Object.values(style.sources)[0])
      assert.equal(src.type, 'raster')

      const resource = await reader.getResource(
        fillTemplate(src.tiles[0], { z: 0, x: 0, y: 0 }),
      )
      assert.equal(resource.contentType, 'image/png')
      assert.notEqual(
        resource.contentEncoding,
        'gzip',
        'raster tiles are not gzipped',
      )
      const data = await streamToBuffer(resource.stream)
      assert.equal(data[0], 0x89, 'png magic byte')
    },
  )
})
