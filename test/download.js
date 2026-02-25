import { afterAll, beforeAll, describe, test } from 'vitest'
import { fromBuffer as zipFromBuffer } from 'yauzl-promise'

import assert from 'node:assert/strict'
import { buffer as streamToBuffer } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'

import { download, Reader } from '../lib/index.js'
import { startSMPServer } from './utils/smp-server.js'

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

    const reader = new Reader(await zipFromBuffer(smp))
    const style = await reader.getStyle()

    assert.equal(style.version, 8)
    assert(Array.isArray(style.layers), 'has layers')
    assert(style.metadata, 'has metadata')
    assert(style.metadata['smp:bounds'], 'has smp:bounds')
    assert(typeof style.metadata['smp:maxzoom'] === 'number', 'has smp:maxzoom')
    assert(Object.keys(style.sources).length > 0, 'has sources')

    await reader.close()
  })

  test('download output contains readable tiles', async () => {
    const smpStream = download({
      styleUrl: server.baseUrl + 'style.json',
      bbox: [-180, -85, 180, 85],
      maxzoom: 1,
    })

    const smp = await streamToBuffer(smpStream)
    const reader = new Reader(await zipFromBuffer(smp))
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
    const reader = new Reader(await zipFromBuffer(smp))
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

  test('download stream emits error for unreachable URL', async () => {
    const smpStream = download({
      styleUrl: 'http://127.0.0.1:1/nonexistent/style.json',
      bbox: [-1, -1, 1, 1],
      maxzoom: 0,
    })

    await assert.rejects(
      () => streamToBuffer(smpStream),
      (/** @type {any} */ err) => {
        assert(err instanceof Error)
        return true
      },
    )
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
    const reader = new Reader(await zipFromBuffer(smp))
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
