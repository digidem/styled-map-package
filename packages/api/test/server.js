import { onTestFinished, test } from 'vitest'

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { Reader } from '../lib/reader.js'
import { createServer } from '../lib/server.js'
import { validateStyle } from '../lib/utils/style.js'
import { replaceVariables } from '../lib/utils/templates.js'

test('server basic', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  onTestFinished(() => reader.close())
  const server = createServer()
  const response = await server.fetch(
    new Request('http://example.com/style.json'),
    reader,
  )
  assert.equal(response.status, 200)
  const responseRaw = await response.arrayBuffer()
  assert.equal(
    responseRaw.byteLength,
    Number(response.headers.get('content-length')),
    'Content-Length header is correct',
  )
  const style = JSON.parse(new TextDecoder().decode(responseRaw))
  assert(validateStyle(style), 'style is valid')

  {
    assert(typeof style.glyphs === 'string')
    const glyphUrl = replaceVariables(style.glyphs, {
      fontstack: 'Open Sans Semibold',
      range: '0-255',
    })
    const response = await server.fetch(new Request(glyphUrl), reader)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-protobuf')
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert(response.headers.get('content-length'))

    assert.equal(
      (await response.arrayBuffer()).byteLength,
      Number(response.headers.get('content-length')),
      'Content-Length header is correct',
    )
  }

  {
    const tileSource = Object.values(style.sources).find(
      (source) => source.type === 'vector',
    )
    assert(tileSource?.tiles)
    const tileUrl = replaceVariables(tileSource.tiles[0], {
      z: 0,
      x: 0,
      y: 0,
    })
    const response = await server.fetch(new Request(tileUrl), reader)
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('content-type'),
      'application/vnd.mapbox-vector-tile',
    )
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert(response.headers.get('content-length'))

    assert.equal(
      (await response.arrayBuffer()).byteLength,
      Number(response.headers.get('content-length')),
      'Content-Length header is correct',
    )
  }
})

test('server 404', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  onTestFinished(() => reader.close())
  const server = createServer()
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/nonexistent'),
      reader,
    )
    await assert.rejects(() => responsePromise, {
      status: 404,
      message: 'Not Found',
    })
  }
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/tiles/99/99/99.pbf'),
      reader,
    )
    await assert.rejects(() => responsePromise, {
      status: 404,
      message: 'Not Found',
    })
  }
})

test('server with base path', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  onTestFinished(() => reader.close())
  const server = createServer({ base: '/maps/my-map/' })
  const response = await server.fetch(
    new Request('http://example.com/maps/my-map/style.json'),
    reader,
  )
  assert.equal(response.status, 200)
  const style = await response.json()
  assert(validateStyle(style), 'style is valid')
})

test('server fallbackTile is called with correct args for missing tile', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)

  /** @type {any} */
  let receivedTileId
  /** @type {any} */
  let receivedSourceInfo
  const server = createServer({
    fallbackTile(tileId, sourceInfo) {
      receivedTileId = tileId
      receivedSourceInfo = sourceInfo
      return new Response('fallback tile', { status: 200 })
    },
  })

  const styleResponse = await server.fetch(
    new Request('http://example.com/style.json'),
    reader,
  )
  const style = await styleResponse.json()

  const [sourceId, tileSource] = /** @type {[string, any]} */ (
    Object.entries(style.sources).find(
      ([, source]) => /** @type {any} */ (source).type === 'vector',
    )
  )
  assert(tileSource?.tiles)

  // Request a tile at z=99 which does not exist in the package
  const tileUrl = replaceVariables(tileSource.tiles[0], {
    z: 99,
    x: 1,
    y: 2,
  })
  const response = await server.fetch(new Request(tileUrl), reader)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'fallback tile')

  assert.deepEqual(receivedTileId, { x: 1, y: 2, z: 99 })
  assert.equal(receivedSourceInfo.sourceId, sourceId)
  assert.equal(receivedSourceInfo.source.type, 'vector')

  // Existing tiles should still be served normally
  const existingTileUrl = replaceVariables(tileSource.tiles[0], {
    z: 0,
    x: 0,
    y: 0,
  })
  const existingResponse = await server.fetch(
    new Request(existingTileUrl),
    reader,
  )
  assert.equal(existingResponse.status, 200)
  assert.equal(
    existingResponse.headers.get('content-type'),
    'application/vnd.mapbox-vector-tile',
  )
})

test('server fallbackGlyph is called with correct args for missing glyph', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)

  /** @type {string | undefined} */
  let receivedFontstack
  /** @type {string | undefined} */
  let receivedRange
  const server = createServer({
    fallbackGlyph(fontstack, range) {
      receivedFontstack = fontstack
      receivedRange = range
      return new Response('fallback glyph', { status: 200 })
    },
  })

  const styleResponse = await server.fetch(
    new Request('http://example.com/style.json'),
    reader,
  )
  const style = await styleResponse.json()
  assert(typeof style.glyphs === 'string')

  // Request a glyph for a font that does not exist in the package
  const glyphUrl = replaceVariables(style.glyphs, {
    fontstack: 'Nonexistent Font',
    range: '256-511',
  })
  const response = await server.fetch(new Request(glyphUrl), reader)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'fallback glyph')

  assert.equal(receivedFontstack, 'Nonexistent Font')
  assert.equal(receivedRange, '256-511')

  // Existing glyphs should still be served normally
  const existingGlyphUrl = replaceVariables(style.glyphs, {
    fontstack: 'Open Sans Semibold',
    range: '0-255',
  })
  const existingResponse = await server.fetch(
    new Request(existingGlyphUrl),
    reader,
  )
  assert.equal(existingResponse.status, 200)
  assert.equal(
    existingResponse.headers.get('content-type'),
    'application/x-protobuf',
  )
})

test('server fallbackTile matches correct source with multiple sources', async () => {
  const URI_BASE = 'smp://maps.v1/'

  /** @type {Map<string, any>} */
  const resources = new Map()

  // Mock reader with two tile sources (vector + raster) and no actual tile data
  const mockReader = {
    getStyle() {
      return Promise.resolve({
        version: 8,
        sources: {
          vector_src: {
            type: 'vector',
            tiles: [URI_BASE + 's/0/{z}/{x}/{y}.mvt.gz'],
            bounds: [-180, -85, 180, 85],
            minzoom: 0,
            maxzoom: 14,
          },
          raster_src: {
            type: 'raster',
            tiles: [URI_BASE + 's/1/{z}/{x}/{y}.png'],
            bounds: [-180, -85, 180, 85],
            minzoom: 0,
            maxzoom: 10,
          },
        },
        layers: [],
        metadata: {
          'smp:bounds': [-180, -85, 180, 85],
          'smp:maxzoom': 14,
        },
      })
    },
    getResource(/** @type {string} */ path) {
      if (resources.has(path)) return Promise.resolve(resources.get(path))
      const err = /** @type {any} */ (new Error('ENOENT: ' + path))
      err.code = 'ENOENT'
      return Promise.reject(err)
    },
  }

  /** @type {{ tileId: any, sourceInfo: any }[]} */
  const calls = []
  const server = createServer({
    fallbackTile(tileId, sourceInfo) {
      calls.push({ tileId, sourceInfo })
      return new Response(`fallback:${sourceInfo.sourceId}`)
    },
  })

  // Request a missing vector tile
  {
    const response = await server.fetch(
      new Request('http://example.com/s/0/5/3/2.mvt.gz'),
      /** @type {any} */ (mockReader),
    )
    assert.equal(await response.text(), 'fallback:vector_src')
    assert.deepEqual(calls.at(-1)?.tileId, { z: 5, x: 3, y: 2 })
    assert.equal(calls.at(-1)?.sourceInfo.sourceId, 'vector_src')
    assert.equal(calls.at(-1)?.sourceInfo.source.type, 'vector')
  }

  // Request a missing raster tile
  {
    const response = await server.fetch(
      new Request('http://example.com/s/1/8/100/50.png'),
      /** @type {any} */ (mockReader),
    )
    assert.equal(await response.text(), 'fallback:raster_src')
    assert.deepEqual(calls.at(-1)?.tileId, { z: 8, x: 100, y: 50 })
    assert.equal(calls.at(-1)?.sourceInfo.sourceId, 'raster_src')
    assert.equal(calls.at(-1)?.sourceInfo.source.type, 'raster')
  }

  // Path that doesn't match any source should 404
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/s/99/1/2/3.mvt.gz'),
      /** @type {any} */ (mockReader),
    )
    await assert.rejects(() => responsePromise, { status: 404 })
  }
})

test('server ignores malicious tile and glyph templates', async () => {
  const URI_BASE = 'smp://maps.v1/'

  const mockReader = {
    getStyle() {
      return Promise.resolve({
        version: 8,
        sources: {
          // Adjacent placeholders — could cause ReDoS
          adjacent: {
            type: 'vector',
            tiles: [URI_BASE + 's/{z}{x}{y}.mvt.gz'],
            bounds: [-180, -85, 180, 85],
            minzoom: 0,
            maxzoom: 14,
          },
          // Extra unknown placeholders
          extra: {
            type: 'vector',
            tiles: [URI_BASE + '{evil1}/{evil2}/{z}/{x}/{y}.mvt.gz'],
            bounds: [-180, -85, 180, 85],
            minzoom: 0,
            maxzoom: 14,
          },
          // Missing required placeholders
          incomplete: {
            type: 'vector',
            tiles: [URI_BASE + 's/0/{z}/{x}/tile.mvt.gz'],
            bounds: [-180, -85, 180, 85],
            minzoom: 0,
            maxzoom: 14,
          },
          // Valid source to confirm it still works
          valid: {
            type: 'vector',
            tiles: [URI_BASE + 's/ok/{z}/{x}/{y}.mvt.gz'],
            bounds: [-180, -85, 180, 85],
            minzoom: 0,
            maxzoom: 14,
          },
        },
        layers: [],
        // Adjacent placeholders in glyph template
        glyphs: URI_BASE + 'fonts/{fontstack}{range}.pbf.gz',
        metadata: {
          'smp:bounds': [-180, -85, 180, 85],
          'smp:maxzoom': 14,
        },
      })
    },
    getResource(/** @type {string} */ path) {
      const err = /** @type {any} */ (new Error('ENOENT: ' + path))
      err.code = 'ENOENT'
      return Promise.reject(err)
    },
  }

  /** @type {{ tileId: any, sourceInfo: any }[]} */
  const tileCalls = []
  let glyphCalled = false
  const server = createServer({
    fallbackTile(tileId, sourceInfo) {
      tileCalls.push({ tileId, sourceInfo })
      return new Response(`fallback:${sourceInfo.sourceId}`)
    },
    fallbackGlyph() {
      glyphCalled = true
      return new Response('fallback glyph')
    },
  })

  // Adjacent placeholders source should be skipped (no match)
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/s/123.mvt.gz'),
      /** @type {any} */ (mockReader),
    )
    await assert.rejects(() => responsePromise, { status: 404 })
  }

  // Extra unknown placeholders should be treated as literals, not capture groups
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/anything/anything/1/2/3.mvt.gz'),
      /** @type {any} */ (mockReader),
    )
    await assert.rejects(() => responsePromise, { status: 404 })
  }

  // Missing {y} placeholder source should be skipped
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/s/0/1/2/tile.mvt.gz'),
      /** @type {any} */ (mockReader),
    )
    await assert.rejects(() => responsePromise, { status: 404 })
  }

  // Valid source still works
  {
    const response = await server.fetch(
      new Request('http://example.com/s/ok/5/3/2.mvt.gz'),
      /** @type {any} */ (mockReader),
    )
    assert.equal(await response.text(), 'fallback:valid')
    assert.deepEqual(tileCalls.at(-1)?.tileId, { z: 5, x: 3, y: 2 })
  }

  // Adjacent placeholders in glyph template — fallbackGlyph should not be called
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/fonts/SomeFont0-255.pbf.gz'),
      /** @type {any} */ (mockReader),
    )
    await assert.rejects(() => responsePromise, { status: 404 })
    assert.equal(glyphCalled, false)
  }
})

test('server with parameter in base path', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  onTestFinished(() => reader.close())
  const server = createServer({ base: '/maps/:mapId/' })
  const response = await server.fetch(
    new Request('http://example.com/maps/45b4fcabc49c/style.json'),
    reader,
  )
  assert.equal(response.status, 200)
  const style = await response.json()
  assert(validateStyle(style), 'style is valid')

  {
    assert(typeof style.glyphs === 'string')
    const glyphUrl = replaceVariables(style.glyphs, {
      fontstack: 'Open Sans Semibold',
      range: '0-255',
    })
    assert(glyphUrl.startsWith('http://example.com/maps/45b4fcabc49c/'))
    const response = await server.fetch(new Request(glyphUrl), reader)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-protobuf')
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert(response.headers.get('content-length'))

    assert.equal(
      (await response.arrayBuffer()).byteLength,
      Number(response.headers.get('content-length')),
      'Content-Length header is correct',
    )
  }

  {
    const tileSource = Object.values(style.sources).find(
      (source) => source.type === 'vector',
    )
    assert(tileSource?.tiles)
    const tileUrl = replaceVariables(tileSource.tiles[0], {
      z: 0,
      x: 0,
      y: 0,
    })
    assert(tileUrl.startsWith('http://example.com/maps/45b4fcabc49c/'))
    const response = await server.fetch(new Request(tileUrl), reader)
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('content-type'),
      'application/vnd.mapbox-vector-tile',
    )
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert(response.headers.get('content-length'))

    assert.equal(
      (await response.arrayBuffer()).byteLength,
      Number(response.headers.get('content-length')),
      'Content-Length header is correct',
    )
  }
})
