import { ZipReader } from '@gmaclennan/zip-reader'
import { BufferSource } from '@gmaclennan/zip-reader/buffer-source'
import SphericalMercator from '@mapbox/sphericalmercator'
import { bbox as turfBbox } from '@turf/bbox'
import { describe, expect, test } from 'vitest'

import { Reader } from '../lib/reader.js'
import { tileIterator } from '../lib/tile-downloader.js'
import { unionBBox } from '../lib/utils/geo.js'
import { Writer } from '../lib/writer.js'
import { assertBboxEqual } from './utils/assert-bbox-equal.js'
import { DigestStream } from './utils/digest-stream.js'
import { readTextFile, writeTextFile, readdir } from './utils/io.js'
import { ReaderHelper } from './utils/reader-helper.js'
import { streamToBuffer, streamToJson } from './utils/stream-consumers.js'

/** @import { BBox } from '../lib/utils/geo.js' */

/** @param {string | URL} url */
async function readJson(url) {
  return JSON.parse(await readTextFile(url))
}

const updateSnapshots =
  typeof process !== 'undefined' && !!process.env.UPDATE_SNAPSHOTS

/**
 * Browser-compatible random bytes ReadableStream.
 * @param {{ size: number }} opts
 * @returns {ReadableStream<Uint8Array>}
 */
function randomWebStream({ size }) {
  /** @type {any} */
  let crypto = globalThis.crypto
  return new ReadableStream({
    async start(controller) {
      const bytes = new Uint8Array(size)
      // For node 18 support
      if (!crypto) {
        crypto = (await import('crypto')).webcrypto
      }
      crypto.getRandomValues(bytes)
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/**
 * Compute SHA-256 hex digest of a Uint8Array.
 * @param {Uint8Array} data
 * @returns {Promise<string>}
 */
async function sha256hex(data) {
  /** @type {any} */
  let crypto = globalThis.crypto
  // For node 18 support
  if (!crypto) {
    crypto = (await import('crypto')).webcrypto
  }
  // @ts-ignore - Uint8Array is a valid BufferSource despite TS type mismatch with ArrayBufferLike
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('Invalid styles', async () => {
  const fixturesDir = new URL('./fixtures/invalid-styles/', import.meta.url)
  // Vite may strip the trailing slash during static URL transformation; restore it
  if (!fixturesDir.pathname.endsWith('/')) fixturesDir.pathname += '/'
  const fixtures = await readdir(fixturesDir)
  for (const fixture of fixtures) {
    test(fixture, async () => {
      const stylePath = new URL(fixture, fixturesDir)
      const style = await readJson(stylePath)
      expect(() => {
        new Writer(style)
      }, `Expected ${fixture} to throw an error`).toThrow(/Invalid style/)
    })
  }
})

test('Minimal write & read', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/minimal.input.json',
    import.meta.url,
  )
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  // Start consuming the output stream before adding tiles so backpressure is respected
  const smpPromise = streamToBuffer(writer.outputStream)
  const sm = new SphericalMercator()

  const bounds = /** @type {BBox} */ ([-40.6, -50.6, 151.6, 76.0])
  const sourceId = 'maplibre'
  const maxzoom = 5
  const { minX, minY, maxX, maxY } = sm.xyz(bounds, maxzoom)
  const expectedOutputBounds = unionBBox([
    sm.bbox(minX, minY, maxzoom),
    sm.bbox(maxX, maxY, maxzoom),
  ])

  const tileHashes = new Map()
  for (const { x, y, z } of tileIterator({ maxzoom: 5, bounds })) {
    const digest = new DigestStream()
    const stream = randomWebStream({ size: random(2048, 4096) }).pipeThrough(
      digest,
    )
    await writer.addTile(stream, { x, y, z, sourceId, format: 'mvt' })
    const tileId = `${z}/${x}/${y}`
    tileHashes.set(tileId, await digest.digest())
  }

  writer.finish()

  const smp = await smpPromise
  const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
  const readerHelper = new ReaderHelper(reader)

  const styleOut = await reader.getStyle()
  compareAndSnapshotStyle({ styleInUrl, styleOut })

  assertBboxEqual(
    // @ts-expect-error
    styleOut.sources[sourceId].bounds,
    expectedOutputBounds,
    'Source has correct bounds added',
  )
  assertBboxEqual(
    styleOut.metadata['smp:bounds'],
    expectedOutputBounds,
    'Style has correct bounds metadata added',
  )

  for (const { x, y, z } of tileIterator({ maxzoom: 5, bounds })) {
    const hash = await readerHelper.getTileHash({ x, y, z, sourceId })
    expect(hash, `Tile ${z}/${x}/${y} is the same`).toBe(
      tileHashes.get(`${z}/${x}/${y}`),
    )
  }
})

test('Inline GeoJSON is not removed from style', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/inline-geojson.input.json',
    import.meta.url,
  )
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  writer.finish()

  const smp = await smpPromise
  const reader = new Reader(await ZipReader.from(new BufferSource(smp)))

  const styleOut = await reader.getStyle()
  await compareAndSnapshotStyle({ styleInUrl, styleOut })

  expect(styleOut.sources.crimea.type).toBe('geojson')
  // @ts-ignore
  const { bbox, ...geoJsonOut } = styleOut.sources.crimea.data
  expect(geoJsonOut, 'GeoJSON is the same').toEqual(styleIn.sources.crimea.data)
  const expectedBbox = turfBbox(styleIn.sources.crimea.data)
  assertBboxEqual(bbox, expectedBbox, 'GeoJSON has correct bbox added')
  assertBboxEqual(
    styleOut.metadata['smp:bounds'],
    expectedBbox,
    'Style has correct bounds metadata added',
  )
  expect(
    styleOut.metadata['smp:maxzoom'],
    'Style has correct maxzoom metadata added for GeoJSON',
  ).toBe(16)
})

test('Un-added source is stripped from output', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/maplibre-unlabelled.input.json',
    import.meta.url,
  )

  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  expect(
    'maplibre' in styleIn.sources,
    'input style contains maplibre source',
  ).toBe(true)
  const styleInGeoJsonSourceEntry = Object.entries(styleIn.sources).find(
    ([, source]) => source.type === 'geojson',
  )
  expect(
    styleInGeoJsonSourceEntry,
    'input style contains geojson source',
  ).toBeTruthy()
  expect(
    styleIn.layers.filter((l) => 'source' in l && l.source === 'maplibre')
      .length > 0,
    'input style contains layers with maplibre source',
  ).toBe(true)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  writer.finish()

  const smp = await smpPromise
  const reader = new Reader(await ZipReader.from(new BufferSource(smp)))

  const styleOut = await reader.getStyle()
  await compareAndSnapshotStyle({ styleInUrl, styleOut })
  expect(
    Object.keys(styleOut.sources),
    'output style only contains geojson source',
  ).toEqual([styleInGeoJsonSourceEntry?.[0]])
  expect(styleOut.layers.length > 0, 'output style contains layers').toBe(true)
  expect(
    styleOut.layers.filter((l) => 'source' in l && l.source === 'maplibre')
      .length,
    'output style does not contain layers with maplibre source',
  ).toBe(0)
})

test('Glyphs can be written and read', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/minimal-labelled.input.json',
    import.meta.url,
  )
  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  expect(typeof styleIn.glyphs === 'string', 'input style has glyphs URL').toBe(
    true,
  )
  const font = 'Open Sans Semibold'

  // Need to add at least one tile for the source
  await writer.addTile(randomWebStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'maplibre',
    format: 'mvt',
  })

  /** @type {Map<string, string>} */
  const glyphHashes = new Map()
  for (const range of glyphRanges()) {
    const digest = new DigestStream()
    const stream = randomWebStream({ size: random(256, 1024) }).pipeThrough(
      digest,
    )
    await writer.addGlyphs(stream, { range, font })
    glyphHashes.set(range, await digest.digest())
  }
  writer.finish()

  const smp = await smpPromise
  const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
  const readerHelper = new ReaderHelper(reader)

  const styleOut = await reader.getStyle()
  await compareAndSnapshotStyle({ styleInUrl, styleOut })

  for (const range of glyphRanges()) {
    const hash = await readerHelper.getGlyphHash({ range, font })
    expect(hash, `Glyphs for ${range} are the same`).toBe(
      glyphHashes.get(range),
    )
  }
})

test('Missing glyphs throws an error', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/minimal-labelled.input.json',
    import.meta.url,
  )
  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  expect(typeof styleIn.glyphs === 'string', 'input style has glyphs URL').toBe(
    true,
  )

  // Need to add at least one tile for the source
  await writer.addTile(randomWebStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'maplibre',
    format: 'mvt',
  })

  await expect(() => writer.finish()).rejects.toThrow(/Missing fonts/)
  writer.abort(new Error('cleanup'))
  await smpPromise.catch(() => {})
})

test('Finishing writer with no sources throws and error', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/minimal.input.json',
    import.meta.url,
  )
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  await expect(() => writer.finish()).rejects.toThrow(/Missing sources/)
  writer.abort(new Error('cleanup'))
  await smpPromise.catch(() => {})
})

test('External GeoJSON & layers that use it are excluded if not added', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/external-geojson.input.json',
    import.meta.url,
  )
  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  expect(
    'crimea' in styleIn.sources && styleIn.sources.crimea.type === 'geojson',
    'input style contains crimea geojson source',
  ).toBe(true)
  expect(
    // @ts-ignore
    typeof styleIn.sources.crimea.data,
    'geojson source is external (data is URL)',
  ).toBe('string')
  expect(
    styleIn.layers.find((l) => 'source' in l && l.source === 'crimea'),
    'input style contains layers with crimea source',
  ).toBeTruthy()

  // Need to add at least one tile for the source
  await writer.addTile(randomWebStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'maplibre',
    format: 'mvt',
  })

  writer.finish()

  const smp = await smpPromise
  const reader = new Reader(await ZipReader.from(new BufferSource(smp)))

  const styleOut = await reader.getStyle()
  await compareAndSnapshotStyle({ styleInUrl, styleOut })

  expect(
    'crimea' in styleOut.sources,
    'output style does not contain crimea geojson source',
  ).toBe(false)
  expect(
    styleOut.layers.find((l) => 'source' in l && l.source === 'crimea'),
    'output style does not contain layers with crimea source',
  ).toBeFalsy()
})

test('Missing sprites throws an error', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/minimal-sprites.input.json',
    import.meta.url,
  )
  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  expect(typeof styleIn.sprite === 'string', 'input style has sprite URL').toBe(
    true,
  )

  // Need to add at least one tile for the source
  await writer.addTile(randomWebStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'openmaptiles',
    format: 'mvt',
  })

  await expect(() => writer.finish()).rejects.toThrow(/Missing sprite/)
  writer.abort(new Error('cleanup'))
  await smpPromise.catch(() => {})
})

test('Can write and read sprites', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/minimal-sprites.input.json',
    import.meta.url,
  )
  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  expect(typeof styleIn.sprite === 'string', 'input style has sprite URL').toBe(
    true,
  )

  // Need to add at least one tile for the source
  await writer.addTile(randomWebStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'openmaptiles',
    format: 'mvt',
  })

  const sprite1xDigest = new DigestStream()
  const sprite1xImageStream = randomWebStream({
    size: random(1024, 2048),
  }).pipeThrough(sprite1xDigest)
  const sprite2xDigest = new DigestStream()
  const sprite2xImageStream = randomWebStream({
    size: random(1024, 2048),
  }).pipeThrough(sprite2xDigest)
  const spriteLayoutIn = {
    airfield_11: {
      height: 17,
      pixelRatio: 1,
      width: 17,
      x: 21,
      y: 0,
    },
  }
  await writer.addSprite({
    png: sprite1xImageStream,
    json: JSON.stringify(spriteLayoutIn),
  })
  const sprite1xImageHash = await sprite1xDigest.digest()
  await writer.addSprite({
    png: sprite2xImageStream,
    json: JSON.stringify(spriteLayoutIn),
    pixelRatio: 2,
  })
  const sprite2xImageHash = await sprite2xDigest.digest()

  writer.finish()

  const smp = await smpPromise
  const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
  const readerHelper = new ReaderHelper(reader)

  const styleOut = await reader.getStyle('')
  await compareAndSnapshotStyle({ styleInUrl, styleOut })

  const sprite1xImageHashOut = await readerHelper.getSpriteHash({ ext: 'png' })
  const sprite2xImageHashOut = await readerHelper.getSpriteHash({
    ext: 'png',
    pixelRatio: 2,
  })
  const spriteJsonResource = await reader.getResource(styleOut.sprite + '.json')
  expect(spriteJsonResource.contentType).toBe('application/json; charset=utf-8')
  const spriteLayoutOut = await streamToJson(spriteJsonResource.stream)

  expect(sprite1xImageHashOut, 'Sprite image is the same').toBe(
    sprite1xImageHash,
  )
  expect(sprite2xImageHashOut, 'Sprite @2x image is the same').toBe(
    sprite2xImageHash,
  )
  expect(spriteLayoutOut, 'Sprite layout is the same').toEqual(spriteLayoutIn)
})

test('Can write and read style with multiple sprites', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/multiple-sprites.input.json',
    import.meta.url,
  )
  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  expect(
    Array.isArray(styleIn.sprite),
    'input style has array of sprites',
  ).toBe(true)

  // Need to add at least one tile for the source
  await writer.addTile(randomWebStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'openmaptiles',
    format: 'mvt',
  })

  const spriteRoadsignsDigest = new DigestStream()
  const spriteRoadsignsImageStream = randomWebStream({
    size: random(1024, 2048),
  }).pipeThrough(spriteRoadsignsDigest)
  const spriteDefaultDigest = new DigestStream()
  const spriteDefaultImageStream = randomWebStream({
    size: random(1024, 2048),
  }).pipeThrough(spriteDefaultDigest)
  const spriteRoadsignsLayoutIn = {
    airfield_11: {
      height: 17,
      pixelRatio: 1,
      width: 17,
      x: 21,
      y: 0,
    },
  }
  const spriteDefaultLayoutIn = {
    other_sprite: {
      height: 17,
      pixelRatio: 1,
      width: 17,
      x: 21,
      y: 0,
    },
  }
  await writer.addSprite({
    png: spriteDefaultImageStream,
    json: JSON.stringify(spriteDefaultLayoutIn),
  })
  const spriteDefaultImageHash = await spriteDefaultDigest.digest()
  await writer.addSprite({
    id: 'roadsigns',
    png: spriteRoadsignsImageStream,
    json: JSON.stringify(spriteRoadsignsLayoutIn),
  })
  const spriteRoadsignsImageHash = await spriteRoadsignsDigest.digest()

  writer.finish()

  const smp = await smpPromise
  const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
  const readerHelper = new ReaderHelper(reader)

  const styleOut = await reader.getStyle('')
  await compareAndSnapshotStyle({ styleInUrl, styleOut })

  const spriteDefaultImageHashOut = await readerHelper.getSpriteHash({
    ext: 'png',
  })
  const spriteRoadsignsImageHashOut = await readerHelper.getSpriteHash({
    ext: 'png',
    id: 'roadsigns',
  })
  // @ts-expect-error
  const defaultUrl = styleOut.sprite.find((s) => s.id === 'default').url
  // @ts-expect-error
  const roadsignsUrl = styleOut.sprite.find((s) => s.id === 'roadsigns').url
  const defaultJsonResource = await reader.getResource(defaultUrl + '.json')
  const roadsignsJsonResource = await reader.getResource(roadsignsUrl + '.json')
  const defaultLayoutOut = await streamToJson(defaultJsonResource.stream)
  const roadsignsLayoutOut = await streamToJson(roadsignsJsonResource.stream)

  expect(spriteDefaultImageHashOut, 'Sprite image is the same').toBe(
    spriteDefaultImageHash,
  )
  expect(spriteRoadsignsImageHashOut, 'Sprite @2x image is the same').toBe(
    spriteRoadsignsImageHash,
  )
  expect(defaultLayoutOut, 'Sprite layout is the same').toEqual(
    spriteDefaultLayoutIn,
  )
  expect(roadsignsLayoutOut, 'Sprite layout is the same').toEqual(
    spriteRoadsignsLayoutIn,
  )
})

test('Raster tiles write and read', async () => {
  /**
   * Generate a random image buffer. In Node, uses Sharp directly; in the
   * browser, delegates to the server-side randomImage command and decodes the
   * returned base64 string.
   *
   * @param {{ width: number, height: number, format: 'png' | 'jpg' }} opts
   * @returns {Promise<Uint8Array>}
   */
  async function makeImage(opts) {
    if (typeof window === 'undefined') {
      const { randomImageStream } = await import('./utils/image-streams.js')
      return randomImageStream(opts).toBuffer()
    }
    const { commands } = await import('@vitest/browser/context')
    // @ts-ignore
    const b64 = await commands.randomImage(opts)
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  const styleInUrl = new URL(
    './fixtures/valid-styles/raster-sources.input.json',
    import.meta.url,
  )
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  const pngBuffer = await makeImage({ width: 256, height: 256, format: 'png' })
  const jpgBuffer = await makeImage({ width: 256, height: 256, format: 'jpg' })
  const pngTileId = { x: 0, y: 0, z: 0, sourceId: 'png-tiles' }
  const jpgTileId = { x: 0, y: 0, z: 0, sourceId: 'jpg-tiles' }
  await writer.addTile(pngBuffer, { ...pngTileId, format: 'png' })
  await writer.addTile(jpgBuffer, { ...jpgTileId, format: 'jpg' })
  const pngTileHash = await sha256hex(pngBuffer)
  const jpgTileHash = await sha256hex(jpgBuffer)

  writer.finish()

  const smp = await smpPromise
  const reader = new Reader(await ZipReader.from(new BufferSource(smp)))
  const readerHelper = new ReaderHelper(reader)

  const styleOut = await reader.getStyle()
  compareAndSnapshotStyle({ styleInUrl, styleOut })

  const pngTileHashOut = await readerHelper.getTileHash(pngTileId)
  const jpgTileHashOut = await readerHelper.getTileHash(jpgTileId)

  expect(pngTileHashOut, 'PNG tile is the same').toBe(pngTileHash)
  expect(jpgTileHashOut, 'JPG tile is the same').toBe(jpgTileHash)
})

test('Optimized central directory order', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/all-types.input.json',
    import.meta.url,
  )

  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)
  const smpPromise = streamToBuffer(writer.outputStream)

  const bounds = /** @type {BBox} */ ([-40.6, -50.6, 151.6, 76.0])

  for (const { x, y, z } of tileIterator({ maxzoom: 5, bounds })) {
    for (const sourceId of ['source1', 'source2']) {
      await writer.addTile(randomWebStream({ size: random(2048, 4096) }), {
        x,
        y,
        z,
        sourceId,
        format: 'mvt',
      })
    }
  }

  for (const range of glyphRanges()) {
    for (const font of ['font1', 'font2']) {
      await writer.addGlyphs(randomWebStream({ size: random(256, 1024) }), {
        range,
        font,
      })
    }
  }

  const spriteImageStream = randomWebStream({ size: random(1024, 2048) })
  const spriteLayoutIn = {
    airfield_11: {
      height: 17,
      pixelRatio: 1,
      width: 17,
      x: 21,
      y: 0,
    },
  }
  await writer.addSprite({
    png: spriteImageStream,
    json: JSON.stringify(spriteLayoutIn),
  })

  writer.finish()

  const smp = await smpPromise
  const zipReader = await ZipReader.from(new BufferSource(smp))
  const entries = []
  for await (const entry of zipReader) {
    entries.push(entry)
  }
  const entriesFilenames = entries.map((e) => e.name)

  // 1. VERSION
  // 2. style.json
  // 3. glyphs for 0-255 UTF codes
  // 4. sources ordered by zoom level
  const expectedFirstEntriesFilenames = [
    'VERSION',
    'style.json',
    'fonts/font1/0-255.pbf.gz',
    'fonts/font2/0-255.pbf.gz',
    's/0/0/0/0.mvt.gz',
    's/1/0/0/0.mvt.gz',
    's/0/1/0/0.mvt.gz',
    's/1/1/0/0.mvt.gz',
    's/0/1/0/1.mvt.gz',
    's/1/1/0/1.mvt.gz',
    's/0/1/1/0.mvt.gz',
    's/1/1/1/0.mvt.gz',
    's/0/1/1/1.mvt.gz',
    's/1/1/1/1.mvt.gz',
  ]

  expect(
    entriesFilenames.slice(0, expectedFirstEntriesFilenames.length),
  ).toStrictEqual(expectedFirstEntriesFilenames)
})

/**
 *
 * @param {number} min
 * @param {number} max
 * @returns
 */
function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * @param {{ styleInUrl: URL, styleOut: import('../lib/types.js').SMPStyle }} opts
 */
async function compareAndSnapshotStyle({ styleInUrl, styleOut }) {
  const snapshotUrl = new URL(
    styleInUrl.pathname.replace(/(\.input)?\.json$/, '.output.json'),
    import.meta.url,
  )
  if (styleInUrl.pathname === snapshotUrl.pathname) {
    throw new Error('Snapshot URL is the same as input')
  }
  if (updateSnapshots) {
    await writeTextFile(snapshotUrl, JSON.stringify(styleOut, null, 2))
  } else {
    try {
      const expected = await readJson(snapshotUrl)
      expect(styleOut).toEqual(expected)
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
        await writeTextFile(snapshotUrl, JSON.stringify(styleOut, null, 2))
      }
    }
  }
}

/**
 *
 * @param {number} max
 * @returns {Generator<`${number}-${number}`>}
 */
function* glyphRanges(max = Math.pow(2, 16)) {
  for (let i = 0; i < max; i += 256) {
    yield `${i}-${i + 255}`
  }
}
