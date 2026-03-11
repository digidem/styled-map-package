/**
 * Tests that mid-stream body errors (body.pipeTo() rejection) are handled
 * correctly and do not cause unhandled promise rejections.
 */
import { afterEach, assert, test, vi } from 'vitest'

import { StyleDownloader } from '../lib/style-downloader.js'
import { downloadTiles } from '../lib/tile-downloader.js'
import { FetchQueue } from '../lib/utils/fetch.js'

/** @param {Error} error */
function createErrorStream(error) {
  return new ReadableStream({
    pull(controller) {
      controller.error(error)
    },
  })
}

/** @param {Uint8Array} bytes */
function createBytesStream(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/** @param {ReadableStream} stream */
async function drainStream(stream) {
  try {
    await stream.pipeTo(new WritableStream())
  } catch {
    /* ignore */
  }
}

// Covers exactly 1 tile at z=0, 4 at z=1, etc.
const FULL_BOUNDS = /** @type {import('../lib/utils/geo.js').BBox} */ ([
  -180, -90, 180, 90,
])

// --- tile-downloader ---

test('tile-downloader: mid-stream body error adds tile to skipped', async () => {
  const streamError = new Error('mid-stream network failure')
  /** @type {FetchQueue} */
  const mockFetchQueue = /** @type {any} */ ({
    activeCount: 0,
    fetch: () =>
      Promise.resolve({
        body: createErrorStream(streamError),
        mimeType: 'image/png',
        contentLength: null,
      }),
  })

  const tiles = downloadTiles({
    tileUrls: ['http://example.com/{z}/{x}/{y}.png'],
    bounds: FULL_BOUNDS,
    maxzoom: 0, // 1 tile at z=0
    trackErrors: true,
    fetchQueue: mockFetchQueue,
  })

  for await (const [stream] of tiles) {
    await drainStream(stream)
  }

  // Let the pipeTo rejection microtask settle → onDownloadError is called
  await new Promise((r) => setTimeout(r, 0))

  assert.equal(tiles.skipped.length, 1, 'erroring tile should be in skipped')
  assert.equal(tiles.skipped[0].z, 0)
  assert.equal(tiles.skipped[0].error, streamError)
})

test('tile-downloader: mid-stream errors do not prevent other tiles being yielded', async () => {
  const streamError = new Error('mid-stream failure')
  let callCount = 0
  /** @type {FetchQueue} */
  const mockFetchQueue = /** @type {any} */ ({
    activeCount: 0,
    fetch: () => {
      callCount++
      // First tile succeeds, the remaining four fail with a stream error
      const body =
        callCount === 1
          ? createBytesStream(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) // PNG magic
          : createErrorStream(streamError)
      return Promise.resolve({
        body,
        mimeType: 'image/png',
        contentLength: null,
      })
    },
  })

  const tiles = downloadTiles({
    tileUrls: ['http://example.com/{z}/{x}/{y}.png'],
    bounds: FULL_BOUNDS,
    maxzoom: 1, // 5 tiles: 1 at z=0, 4 at z=1
    trackErrors: false,
    fetchQueue: mockFetchQueue,
  })

  const yielded = []
  for await (const [stream, info] of tiles) {
    await drainStream(stream)
    yielded.push(info)
  }

  await new Promise((r) => setTimeout(r, 0))

  assert.equal(
    yielded.length,
    5,
    'all tiles should be yielded even if streams error',
  )
  assert.equal(
    tiles.skipped.length,
    4,
    '4 tiles with stream errors should be skipped',
  )
})

// --- style-downloader ---

// Minimal valid MapLibre GL style with an inline vector source and a symbol
// layer that uses text-font, so getGlyphs() has work to do.
const STYLE_WITH_GLYPHS =
  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */ ({
    version: 8,
    glyphs: 'http://example.com/{fontstack}/{range}.pbf',
    sources: {
      src: {
        type: 'vector',
        tiles: ['http://example.com/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [
      {
        id: 'labels',
        type: 'symbol',
        source: 'src',
        'source-layer': 'places',
        layout: {
          'text-field': '{name}',
          'text-font': ['Open Sans Regular'],
        },
      },
    ],
  })

afterEach(() => {
  vi.restoreAllMocks()
})

test('style-downloader: mid-stream glyph body error does not cause unhandled rejection', async () => {
  const streamError = new Error('glyph stream failure')
  vi.spyOn(FetchQueue.prototype, 'fetch').mockResolvedValue({
    body: createErrorStream(streamError),
    mimeType: null,
    contentLength: null,
  })

  const downloader = new StyleDownloader(STYLE_WITH_GLYPHS)
  let yieldCount = 0
  for await (const [stream] of downloader.getGlyphs()) {
    await drainStream(stream)
    yieldCount++
  }

  // Let the pipeTo rejection microtasks settle
  await new Promise((r) => setTimeout(r, 0))

  // 256 ranges per font (0-255 to 65280-65535); reaching here without an
  // unhandled rejection proves the .then(onDownloadComplete, noop) fix works.
  assert.equal(yieldCount, 256, 'all 256 glyph ranges should be yielded')
})
