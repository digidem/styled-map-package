import { ZipReader } from '@gmaclennan/zip-reader'
import { BufferSource } from '@gmaclennan/zip-reader/buffer-source'
import {
  afterAll,
  assert,
  beforeAll,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest'

import { createServer as createHTTPServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { download } from '../lib/download.js'
import { Reader } from '../lib/reader.js'
import { ENOENT } from '../lib/utils/errors.js'
import { validate } from '../lib/validator.js'
import { encodeTile } from './utils/mvt-encode.js'
import { startSMPServer } from './utils/smp-server.js'
import { streamToBuffer } from './utils/stream-consumers.js'

describe('download with demotiles-z2 (glyphs, no sprites)', () => {
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

  test('download produces a valid SMP file', async () => {
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 1,
    })

    const smp = await streamToBuffer(smpStream)
    assert(smp.length > 0, 'output is non-empty')

    const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
    const style = await reader.getStyle()

    assert.equal(style.version, 8)
    assert(Array.isArray(style.layers), 'has layers')
    assert(style.metadata, 'has metadata')
    assert(style.metadata['smp:bounds'], 'has smp:bounds')
    assert(typeof style.metadata['smp:maxzoom'] === 'number', 'has smp:maxzoom')
    assert(Object.keys(style.sources).length > 0, 'has sources')

    await reader.close()
  })

  test('download accepts a style object', async () => {
    const response = await fetch(server.baseUrl + 'style.json')
    const inputStyle = await response.json()
    const inputStyleCopy = structuredClone(inputStyle)

    const smp = await streamToBuffer(
      download({
        style: inputStyle,
        bbox: [-180, -85, 180, 85],
        maxzoom: 1,
      }),
    )
    expect(inputStyle, 'input style is not mutated').toEqual(inputStyleCopy)

    const zip = await ZipReader.from(new BufferSource(smp))
    expect((await validate(zip)).valid).toBe(true)
    const reader = new Reader(zip)
    onTestFinished(() => reader.close())
    const style = await reader.getStyle()
    assert.deepEqual(
      style.layers.map((l) => l.id),
      inputStyle.layers.map((/** @type {{ id: string }} */ l) => l.id),
    )
    assert.equal(style.metadata['smp:glyphRanges'], 'used')
  })

  test('download accepts a style URL via the style option', async () => {
    const smp = await streamToBuffer(
      download({
        style: server.baseUrl + 'style.json',
        bbox: [-180, -85, 180, 85],
        maxzoom: 0,
      }),
    )
    const zip = await ZipReader.from(new BufferSource(smp))
    expect((await validate(zip)).valid).toBe(true)
  })

  test('download throws when no style is given', () => {
    expect(() =>
      download(/** @type {any} */ ({ bbox: [-180, -85, 180, 85], maxzoom: 0 })),
    ).toThrow(TypeError)
  })

  test('download output contains readable tiles', async () => {
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 1,
    })

    const smp = await streamToBuffer(smpStream)
    const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
    const style = await reader.getStyle()

    // Find the vector source and its tile path pattern
    const vectorSource = /** @type {any} */ (
      Object.values(style.sources).find(
        (/** @type {any} */ s) => s.type === 'vector',
      )
    )
    assert(vectorSource, 'has vector source')
    assert(vectorSource.tiles, 'vector source has tiles')

    // Read a z0 tile via the SMP URI pattern
    const tilePath = vectorSource.tiles[0]
      .replace('smp://maps.v1/', '')
      .replace('{z}', '0')
      .replace('{x}', '0')
      .replace('{y}', '0')
    const resource = await reader.getResource(tilePath)
    assert(resource.contentLength > 0, 'tile has content')
    await streamToBuffer(resource.stream)

    await reader.close()
  })

  test('download output contains readable glyphs', async () => {
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 0,
    })

    const smp = await streamToBuffer(smpStream)
    const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
    const style = await reader.getStyle()

    assert(typeof style.glyphs === 'string', 'has glyphs URI')

    // Read a glyph resource
    const resource = await reader.getResource(
      'fonts/Open Sans Semibold/0-255.pbf.gz',
    )
    assert(resource.contentLength > 0, 'glyph has content')
    await streamToBuffer(resource.stream)

    await reader.close()
  })

  test('download calls onprogress with expected fields', async () => {
    /** @type {import('../lib/download.js').DownloadProgress[]} */
    const progressUpdates = []
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 0,
      onprogress: (p) => progressUpdates.push(structuredClone(p)),
    })

    await streamToBuffer(smpStream)

    assert(progressUpdates.length > 0, 'onprogress was called')

    const last = progressUpdates[progressUpdates.length - 1]
    assert.equal(last.style.done, true, 'style done')
    assert.equal(last.tiles.done, true, 'tiles done')
    assert.equal(last.glyphs.done, true, 'glyphs done')
    assert.equal(last.sprites.done, true, 'sprites done')
    assert.equal(last.output.done, true, 'output done')
    assert(last.output.totalBytes > 0, 'output has bytes')
    assert(last.elapsedMs > 0, 'elapsedMs > 0')
  })

  test(
    'download stream emits error for unreachable URL',
    { timeout: 15_000 },
    async () => {
      const smpStream = download({
        styleUrl: 'http://127.0.0.1:1/nonexistent/style.json',
        bbox: [-1, -1, 1, 1],
        maxzoom: 0,
      })

      await expect(() => streamToBuffer(smpStream)).rejects.toThrow()
    },
  )

  test('download rejects immediately when signal is already aborted', async () => {
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 0,
      signal: AbortSignal.abort('already cancelled'),
    })

    await expect(() => streamToBuffer(smpStream)).rejects.toThrow(
      'already cancelled',
    )
  })

  test('download can be cancelled with AbortSignal', async () => {
    const ac = new AbortController()
    /** @type {import('../lib/download.js').DownloadProgress[]} */
    const progressUpdates = []
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 2,
      signal: ac.signal,
      onprogress: (p) => {
        progressUpdates.push(structuredClone(p))
        // Abort after the style is downloaded but before everything completes
        if (p.style.done) ac.abort()
      },
    })

    await expect(() => streamToBuffer(smpStream)).rejects.toThrow()

    // Should have received some progress before cancellation
    assert(progressUpdates.length > 0, 'received progress updates')
    assert.equal(
      progressUpdates[progressUpdates.length - 1].style.done,
      true,
      'style was downloaded before abort',
    )
  })

  test('download stream can be cancelled via reader.cancel()', async () => {
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 2,
    })

    const reader = smpStream.getReader()
    // Read one chunk then cancel
    const { done } = await reader.read()
    assert.equal(done, false, 'first read returns data')
    await reader.cancel('no longer needed')
    // Should not throw or hang — cancel cleans up gracefully
  })
})

describe('download with osm-bright-z6 (sprites)', () => {
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

  test('download with sprites produces valid SMP with sprite resources', async () => {
    // Use a tight bbox and low maxzoom to keep this fast
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [10, 47, 11, 48],
      maxzoom: 0,
    })

    const smp = await streamToBuffer(smpStream)
    const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
    const style = await reader.getStyle()

    // Verify sprites are present in the output
    assert(style.sprite, 'output style has sprite')

    // Read sprite resources
    const spriteJsonResource = await reader.getResource(
      'sprites/default/sprite.json',
    )
    assert(spriteJsonResource.contentLength > 0, 'sprite json has content')
    await streamToBuffer(spriteJsonResource.stream)

    const spritePngResource = await reader.getResource(
      'sprites/default/sprite.png',
    )
    assert(spritePngResource.contentLength > 0, 'sprite png has content')
    await streamToBuffer(spritePngResource.stream)

    // Verify @2x sprites too
    const sprite2xJsonResource = await reader.getResource(
      'sprites/default/sprite@2x.json',
    )
    assert(
      sprite2xJsonResource.contentLength > 0,
      'sprite @2x json has content',
    )
    await streamToBuffer(sprite2xJsonResource.stream)

    await reader.close()
  })

  test('download with sprites tracks sprite progress', async () => {
    /** @type {import('../lib/download.js').DownloadProgress[]} */
    const progressUpdates = []
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [10, 47, 11, 48],
      maxzoom: 0,
      onprogress: (p) => progressUpdates.push(structuredClone(p)),
    })

    await streamToBuffer(smpStream)

    const last = progressUpdates[progressUpdates.length - 1]
    assert.equal(last.sprites.done, true, 'sprites done')
    assert(
      last.sprites.downloaded > 0,
      `sprites downloaded: ${last.sprites.downloaded}`,
    )
  })
})

describe('download cancellation releases resources', () => {
  /** Serves a style plus tiles large enough that an unread body blocks. */
  async function startSlowStyleServer() {
    let inflight = 0
    let started = 0
    /** @type {Set<import('node:http').ServerResponse>} */
    const open = new Set()
    /** @type {number} */
    let port
    const server = createHTTPServer((req, res) => {
      open.add(res)
      res.on('close', () => open.delete(res))
      if (req.url === '/style.json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            version: 8,
            name: 'slow',
            sources: {
              t: {
                type: 'vector',
                tiles: [`http://127.0.0.1:${port}/{z}/{x}/{y}.mvt`],
                maxzoom: 3,
              },
            },
            layers: [],
          }),
        )
        return
      }
      started++
      res.on('close', () => inflight--)
      inflight++
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
    await new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve(undefined)),
    )
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port
    return {
      baseUrl: `http://127.0.0.1:${port}/`,
      get inflight() {
        return inflight
      },
      get started() {
        return started
      },
      close: async () => {
        for (const res of open) res.destroy()
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      },
    }
  }

  test('reader.cancel() settles when the output was never read', async () => {
    const server = await startSlowStyleServer()
    try {
      const smpStream = download({
        styleUrl: server.baseUrl + 'style.json',
        bbox: [-180, -85, 180, 85],
        maxzoom: 3,
      })
      const reader = smpStream.getReader()
      // Never read: the writer backpressures on the unread output, which must
      // not deadlock cancel() against the in-flight tile writes.
      await new Promise((resolve) => setTimeout(resolve, 500))

      await Promise.race([
        reader.cancel('no longer needed'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('cancel() never settled')), 3000),
        ),
      ])
    } finally {
      await server.close()
    }
  })

  test('aborting mid-download errors the stream and stops fetching', async () => {
    const server = await startSlowStyleServer()
    try {
      const ac = new AbortController()
      const smpStream = download({
        styleUrl: server.baseUrl + 'style.json',
        bbox: [-180, -85, 180, 85],
        maxzoom: 3,
        signal: ac.signal,
      })
      const reader = smpStream.getReader()
      await reader.read()
      ac.abort(new Error('user cancelled'))

      const startedAtAbort = server.started

      await expect(async () => {
        for (;;) {
          const { done } = await reader.read()
          if (done) return
        }
      }).rejects.toThrow('user cancelled')

      // The remaining tiles of the 85-tile pyramid must not be fetched, and
      // the connections already open must be released rather than left live.
      await vi.waitFor(() => assert.equal(server.inflight, 0), {
        timeout: 5000,
        interval: 50,
      })
      assert(
        server.started <= startedAtAbort + 24,
        `queued tiles still fetched after abort (started ${server.started}, was ${startedAtAbort})`,
      )
    } finally {
      await server.close()
    }
  })
})

describe('download options', () => {
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

  test('dedupe option produces a readable SMP', async () => {
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 0,
      dedupe: true,
    })
    const smp = await streamToBuffer(smpStream)
    const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
    const style = await reader.getStyle()
    const vectorSource = /** @type {any} */ (
      Object.values(style.sources).find(
        (/** @type {any} */ s) => s.type === 'vector',
      )
    )
    const tilePath = vectorSource.tiles[0]
      .replace('smp://maps.v1/', '')
      .replace('{z}', '0')
      .replace('{x}', '0')
      .replace('{y}', '0')
    const resource = await reader.getResource(tilePath)
    assert(resource.contentLength > 0, 'tile has content')
    await streamToBuffer(resource.stream)
    await reader.close()
  })

  test('skipLocalGlyphs omits locally-rendered glyph ranges', async () => {
    // CJK Unified Ideographs: rendered client-side by MapLibre
    const cjkRange = 'fonts/Open Sans Semibold/19968-20223.pbf.gz'
    const latinRange = 'fonts/Open Sans Semibold/0-255.pbf.gz'
    const opts = {
      styleUrl: server.baseUrl + 'style.json',
      bbox: /** @type {[number, number, number, number]} */ ([0, 0, 1, 1]),
      maxzoom: 0,
    }
    const [smpAll, smpSkipped] = await Promise.all([
      streamToBuffer(download({ ...opts, allGlyphRanges: true })),
      streamToBuffer(
        download({ ...opts, allGlyphRanges: true, skipLocalGlyphs: true }),
      ),
    ])
    const readerAll = new Reader(await ZipReader.from(new BufferSource(smpAll)))
    const readerSkipped = new Reader(
      await ZipReader.from(new BufferSource(smpSkipped)),
    )

    const cjk = await readerAll.getResource(cjkRange)
    assert(cjk.contentLength > 0, 'CJK range is downloaded')
    await streamToBuffer(cjk.stream)

    await expect(
      readerSkipped.getResource(cjkRange),
      'CJK range is omitted with skipLocalGlyphs',
    ).rejects.toThrow(ENOENT)
    const latin = await readerSkipped.getResource(latinRange)
    assert(latin.contentLength > 0, 'non-local range is still downloaded')
    await streamToBuffer(latin.stream)

    await readerAll.close()
    await readerSkipped.close()
  })
})

describe('download glyph ranges', () => {
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

  /**
   * @param {Partial<Parameters<typeof download>[0]>} opts
   */
  async function downloadGlyphs(opts) {
    /** @type {import('../lib/download.js').DownloadProgress | undefined} */
    let progress
    const smp = await streamToBuffer(
      download({
        styleUrl: server.baseUrl + 'style.json',
        bbox: [-180, -85, 180, 85],
        maxzoom: 1,
        onprogress: (p) => (progress = p),
        ...opts,
      }),
    )
    const zip = await ZipReader.from(new BufferSource(smp))
    const fonts = []
    for await (const entry of zip) {
      if (entry.name.startsWith('fonts/')) fonts.push(entry.name)
    }
    const validation = await validate(zip)
    const style = await new Reader(zip).getStyle()
    return {
      fonts,
      glyphsRequested: progress?.glyphs.total,
      validation,
      glyphRangesMetadata: style.metadata['smp:glyphRanges'],
    }
  }

  test('only downloads glyph ranges used by labels', async () => {
    const { fonts, glyphsRequested, validation, glyphRangesMetadata } =
      await downloadGlyphs({ skipLocalGlyphs: true })
    assert.equal(glyphRangesMetadata, 'used')
    // Labels are Latin-1 with `text-transform`, which adds 256-511 and
    // 768-1023. A garbled "CuraÃ§ao" contains "§", which can be set upright in
    // vertical text, so vertical punctuation ranges are needed too.
    assert.deepEqual(fonts, [
      'fonts/Open Sans Semibold/0-255.pbf.gz',
      'fonts/Open Sans Semibold/256-511.pbf.gz',
      'fonts/Open Sans Semibold/768-1023.pbf.gz',
      'fonts/Open Sans Semibold/8192-8447.pbf.gz',
      'fonts/Open Sans Semibold/65024-65279.pbf.gz',
    ])
    assert.equal(glyphsRequested, 5)
    assert.deepEqual(
      validation.issues.filter((i) => i.type === 'incomplete_font_glyphs'),
      [],
      'validator agrees the needed ranges are present',
    )
  })

  test('allGlyphRanges downloads every range', async () => {
    const { fonts, glyphsRequested, glyphRangesMetadata } =
      await downloadGlyphs({ allGlyphRanges: true })
    assert.equal(glyphRangesMetadata, undefined)
    assert.equal(glyphsRequested, 256)
    assert(fonts.length > 1, 'more than one range stored')
    assert.include(fonts, 'fonts/Open Sans Semibold/0-255.pbf.gz')
  })
})

describe('download glyph ranges from served tiles', () => {
  /**
   * Serve a labelled style whose tiles are sent in two chunks, and record the
   * glyph ranges that are requested.
   *
   * @param {Uint8Array} tile
   * @param {{ glyphs?: boolean }} [opts]
   */
  async function startLabelServer(tile, { glyphs = true } = {}) {
    /** @type {string[]} */
    const glyphRequests = []
    /** @type {number} */
    let port
    const server = createHTTPServer((req, res) => {
      const url = req.url ?? ''
      if (url === '/style.json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            version: 8,
            ...(glyphs && {
              glyphs: `http://127.0.0.1:${port}/fonts/{fontstack}/{range}.pbf`,
            }),
            sources: {
              t: {
                type: 'vector',
                tiles: [`http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.mvt`],
                maxzoom: 1,
              },
            },
            layers: glyphs
              ? [
                  {
                    id: 'labels',
                    type: 'symbol',
                    source: 't',
                    'source-layer': 'place',
                    layout: {
                      'text-field': ['get', 'name'],
                      'text-font': ['Test Font'],
                    },
                  },
                ]
              : [],
          }),
        )
      } else if (url.startsWith('/fonts/')) {
        glyphRequests.push(url.split('/')[3].replace('.pbf', ''))
        res.writeHead(200, { 'content-type': 'application/x-protobuf' })
        res.end(Buffer.alloc(8))
      } else {
        res.writeHead(200, {
          'content-type': 'application/vnd.mapbox-vector-tile',
        })
        const middle = Math.floor(tile.length / 2)
        res.write(tile.subarray(0, middle))
        setTimeout(() => res.end(tile.subarray(middle)), 5)
      }
    })
    await new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve(undefined)),
    )
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port
    return {
      styleUrl: `http://127.0.0.1:${port}/style.json`,
      glyphRequests,
      close: async () => {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      },
    }
  }

  /** @param {ReadableStream<Uint8Array>} stream */
  async function readGlyphRangesMetadata(stream) {
    const zip = await ZipReader.from(
      new BufferSource(await streamToBuffer(stream)),
    )
    const style = await new Reader(zip).getStyle()
    return style.metadata['smp:glyphRanges']
  }

  const greekTile = encodeTile([
    { name: 'place', features: [{ name: 'Αθήνα', other: 'Москва' }] },
  ])

  for (const dedupe of [false, true]) {
    test(`requests ranges found in tiles (dedupe: ${dedupe})`, async () => {
      const server = await startLabelServer(greekTile)
      onTestFinished(server.close)
      const glyphRanges = await readGlyphRangesMetadata(
        download({
          styleUrl: server.styleUrl,
          bbox: [-180, -85, 180, 85],
          maxzoom: 1,
          dedupe,
        }),
      )
      assert.deepEqual(server.glyphRequests, ['0-255', '768-1023'])
      assert.equal(glyphRanges, 'used')
    })
  }

  test('requests every range when a tile cannot be read', async () => {
    const server = await startLabelServer(new Uint8Array([0x1a, 0xff, 0x01]))
    onTestFinished(server.close)
    const glyphRanges = await readGlyphRangesMetadata(
      download({
        styleUrl: server.styleUrl,
        bbox: [-180, -85, 180, 85],
        maxzoom: 0,
      }),
    )
    assert.equal(server.glyphRequests.length, 256)
    assert.equal(glyphRanges, undefined, 'not marked when all were fetched')
  })

  test('reads tiles that are gzipped without Content-Encoding', async () => {
    const server = await startLabelServer(gzipSync(greekTile))
    onTestFinished(server.close)
    await streamToBuffer(
      download({
        styleUrl: server.styleUrl,
        bbox: [-180, -85, 180, 85],
        maxzoom: 0,
      }),
    )
    assert.deepEqual(server.glyphRequests, ['0-255', '768-1023'])
  })

  test('does not mark packages without glyphs', async () => {
    const server = await startLabelServer(greekTile, { glyphs: false })
    onTestFinished(server.close)
    const glyphRanges = await readGlyphRangesMetadata(
      download({
        styleUrl: server.styleUrl,
        bbox: [-180, -85, 180, 85],
        maxzoom: 0,
      }),
    )
    assert.equal(glyphRanges, undefined)
  })
})
