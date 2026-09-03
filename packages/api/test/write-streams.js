import { ZipReader } from '@gmaclennan/zip-reader'
import { BufferSource } from '@gmaclennan/zip-reader/buffer-source'
import { describe, test } from 'vitest'

import assert from 'node:assert/strict'

import { Reader } from '../lib/reader.js'
import { readableFromAsync } from '../lib/utils/streams.js'
import { Writer } from '../lib/writer.js'
import { streamToBuffer } from './utils/stream-consumers.js'

/**
 * @param {{ size: number }} opts
 * @returns {ReadableStream<Uint8Array>}
 */
function randomWebStream({ size }) {
  return new ReadableStream({
    async start(controller) {
      /** @type {any} */
      let crypto = globalThis.crypto
      if (!crypto) {
        crypto = (await import('crypto')).webcrypto
      }
      const bytes = new Uint8Array(size)
      crypto.getRandomValues(bytes)
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('createTileWriteStream', () => {
  test('tiles written via write stream are readable', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const writer = new Writer(style)
    const smpPromise = streamToBuffer(writer.outputStream)

    /** @type {[ReadableStream<Uint8Array>, import('../lib/writer.js').TileInfo][]} */
    const tiles = [
      [
        randomWebStream({ size: 512 }),
        {
          z: 0,
          x: 0,
          y: 0,
          sourceId: 'test',
          format: /** @type {const} */ ('mvt'),
        },
      ],
      [
        randomWebStream({ size: 512 }),
        {
          z: 1,
          x: 0,
          y: 0,
          sourceId: 'test',
          format: /** @type {const} */ ('mvt'),
        },
      ],
      [
        randomWebStream({ size: 512 }),
        {
          z: 1,
          x: 1,
          y: 0,
          sourceId: 'test',
          format: /** @type {const} */ ('mvt'),
        },
      ],
    ]

    async function* generateTiles() {
      for (const tile of tiles) {
        yield tile
      }
    }

    await readableFromAsync(generateTiles()).pipeTo(
      writer.createTileWriteStream(),
    )
    await writer.finish()
    const smp = await smpPromise

    const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
    const style2 = await reader.getStyle()
    assert(Object.keys(style2.sources).length > 0, 'has sources')

    // Verify all 3 tiles are readable
    for (const [, tileInfo] of tiles) {
      const tilePath = `s/0/${tileInfo.z}/${tileInfo.x}/${tileInfo.y}.mvt.gz`
      const resource = await reader.getResource(tilePath)
      assert(
        resource.contentLength > 0,
        `tile ${tileInfo.z}/${tileInfo.x}/${tileInfo.y} has content`,
      )
      await streamToBuffer(resource.stream)
    }

    await reader.close()
  })

  test('addTile error rejects the pipe into the tile write stream', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const writer = new Writer(style)
    const smpPromise = streamToBuffer(writer.outputStream)

    const tileInfo = {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: /** @type {const} */ ('mvt'),
    }
    /** @returns {AsyncGenerator<[ReadableStream<Uint8Array>, import('../lib/writer.js').TileInfo]>} */
    async function* duplicateTiles() {
      yield [randomWebStream({ size: 256 }), tileInfo]
      yield [randomWebStream({ size: 256 }), tileInfo]
    }

    await assert.rejects(
      readableFromAsync(duplicateTiles()).pipeTo(
        writer.createTileWriteStream(),
      ),
      /already added/,
    )

    writer.abort(new Error('cleanup'))
    await smpPromise.catch(() => {})
  })
})

describe('createGlyphWriteStream', () => {
  test('glyphs written via write stream are readable', async () => {
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
    const smpPromise = streamToBuffer(writer.outputStream)

    // Add a tile first (required)
    await writer.addTile(randomWebStream({ size: 512 }), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })

    // Write glyphs via write stream
    /** @type {[ReadableStream<Uint8Array>, import('../lib/writer.js').GlyphInfo][]} */
    const glyphs = [
      [
        randomWebStream({ size: 64 }),
        {
          font: 'TestFont',
          range: /** @type {`${number}-${number}`} */ ('0-255'),
        },
      ],
      [
        randomWebStream({ size: 64 }),
        {
          font: 'TestFont',
          range: /** @type {`${number}-${number}`} */ ('256-511'),
        },
      ],
    ]

    async function* generateGlyphs() {
      for (const g of glyphs) {
        yield g
      }
    }

    await readableFromAsync(generateGlyphs()).pipeTo(
      writer.createGlyphWriteStream(),
    )
    await writer.finish()
    const smp = await smpPromise

    const reader = new Reader(await ZipReader.from(new BufferSource(smp)))

    // Verify glyphs are readable
    const resource = await reader.getResource('fonts/TestFont/0-255.pbf.gz')
    assert.equal(resource.contentType, 'application/x-protobuf')
    assert(resource.contentLength > 0, 'glyph has content')
    await streamToBuffer(resource.stream)

    const resource2 = await reader.getResource('fonts/TestFont/256-511.pbf.gz')
    assert(resource2.contentLength > 0, 'second glyph range has content')
    await streamToBuffer(resource2.stream)

    await reader.close()
  })
})
