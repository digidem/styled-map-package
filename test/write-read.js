import SphericalMercator from '@mapbox/sphericalmercator'
import { bbox as turfBbox } from '@turf/bbox'
import randomStream from 'random-bytes-readable-stream'
import { fromBuffer as zipFromBuffer } from 'yauzl-promise'

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { buffer as streamToBuffer } from 'node:stream/consumers'
import { test } from 'node:test'

import { Reader, Writer } from '../lib/index.js'
import { tileIterator } from '../lib/tile-downloader.js'
import { unionBBox } from '../lib/utils/geo.js'
import { assertBboxEqual } from './utils/assert-bbox-equal.js'
import { DigestStream } from './utils/digest-stream.js'
import { ReaderHelper } from './utils/reader-helper.js'

/** @import { BBox } from '../lib/utils/geo.js' */

/** @param {string | URL} filePath */
async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

const updateSnapshots = !!process.env.UPDATE_SNAPSHOTS

test('Invalid styles', async (t) => {
  const fixturesDir = new URL('./fixtures/invalid-styles/', import.meta.url)
  const fixtures = await fs.readdir(fixturesDir)
  for (const fixture of fixtures) {
    await t.test(fixture, async () => {
      const stylePath = new URL(fixture, fixturesDir)
      const style = await readJson(stylePath)
      await assert.rejects(
        async () => {
          new Writer(style)
        },
        {
          message: /Invalid style/,
        },
        `Expected ${fixture} to throw an error`,
      )
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
    const stream = randomStream({ size: random(2048, 4096) }).pipe(
      new DigestStream('md5'),
    )
    await writer.addTile(stream, { x, y, z, sourceId, format: 'mvt' })
    const tileId = `${z}/${x}/${y}`
    tileHashes.set(tileId, await stream.digest('hex'))
  }

  writer.finish()

  const smp = await streamToBuffer(writer.outputStream)
  const reader = new Reader(await zipFromBuffer(smp))
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
    assert.equal(
      hash,
      tileHashes.get(`${z}/${x}/${y}`),
      `Tile ${z}/${x}/${y} is the same`,
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

  writer.finish()

  const smp = await streamToBuffer(writer.outputStream)
  const reader = new Reader(await zipFromBuffer(smp))

  const styleOut = await reader.getStyle()
  await compareAndSnapshotStyle({ styleInUrl, styleOut })

  assert.equal(styleOut.sources.crimea.type, 'geojson')
  const { bbox, ...geoJsonOut } = styleOut.sources.crimea.data
  assert.deepEqual(
    geoJsonOut,
    styleIn.sources.crimea.data,
    'GeoJSON is the same',
  )
  const expectedBbox = turfBbox(styleIn.sources.crimea.data)
  assertBboxEqual(bbox, expectedBbox, 'GeoJSON has correct bbox added')
  assertBboxEqual(
    styleOut.metadata['smp:bounds'],
    expectedBbox,
    'Style has correct bounds metadata added',
  )
  assert.equal(
    styleOut.metadata['smp:maxzoom'],
    16,
    'Style has correct maxzoom metadata added for GeoJSON',
  )
})

test('Un-added source is stripped from output', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/maplibre-unlabelled.input.json',
    import.meta.url,
  )

  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  assert('maplibre' in styleIn.sources, 'input style contains maplibre source')
  const styleInGeoJsonSourceEntry = Object.entries(styleIn.sources).find(
    ([, source]) => source.type === 'geojson',
  )
  assert(styleInGeoJsonSourceEntry, 'input style contains geojson source')
  assert(
    styleIn.layers.filter((l) => 'source' in l && l.source === 'maplibre')
      .length > 0,
    'input style contains layers with maplibre source',
  )
  const writer = new Writer(styleIn)

  writer.finish()

  const smp = await streamToBuffer(writer.outputStream)
  const reader = new Reader(await zipFromBuffer(smp))

  const styleOut = await reader.getStyle()
  await compareAndSnapshotStyle({ styleInUrl, styleOut })
  assert.deepEqual(
    Object.keys(styleOut.sources),
    [styleInGeoJsonSourceEntry[0]],
    'output style only contains geojson source',
  )
  assert(styleOut.layers.length > 0, 'output style contains layers')
  assert.equal(
    styleOut.layers.filter((l) => 'source' in l && l.source === 'maplibre')
      .length,
    0,
    'output style does not contain layers with maplibre source',
  )
})

test('Glyphs can be written and read', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/minimal-labelled.input.json',
    import.meta.url,
  )
  /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)

  assert(typeof styleIn.glyphs === 'string', 'input style has glyphs URL')
  const font = 'Open Sans Semibold'

  // Need to add at least one tile for the source
  await writer.addTile(randomStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'maplibre',
    format: 'mvt',
  })

  /** @type {Map<string, string>} */
  const glyphHashes = new Map()
  for (const range of glyphRanges()) {
    const stream = randomStream({ size: random(256, 1024) }).pipe(
      new DigestStream('md5'),
    )
    await writer.addGlyphs(stream, { range, font })
    glyphHashes.set(range, await stream.digest('hex'))
  }
  writer.finish()

  const smp = await streamToBuffer(writer.outputStream)
  const reader = new Reader(await zipFromBuffer(smp))
  const readerHelper = new ReaderHelper(reader)

  const styleOut = await reader.getStyle()
  await compareAndSnapshotStyle({ styleInUrl, styleOut })

  for (const range of glyphRanges()) {
    const hash = await readerHelper.getGlyphHash({ range, font })
    assert.equal(
      hash,
      glyphHashes.get(range),
      `Glyphs for ${range} are the same`,
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

  assert(typeof styleIn.glyphs === 'string', 'input style has glyphs URL')

  // Need to add at least one tile for the source
  await writer.addTile(randomStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'maplibre',
    format: 'mvt',
  })

  await assert.rejects(async () => writer.finish(), {
    message: /Missing fonts/,
  })
})

test('Finishing writer with no sources throws and error', async () => {
  const styleInUrl = new URL(
    './fixtures/valid-styles/minimal.input.json',
    import.meta.url,
  )
  const styleIn = await readJson(styleInUrl)
  const writer = new Writer(styleIn)

  await assert.rejects(async () => writer.finish(), {
    message: /Missing sources/,
  })
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
    await fs.writeFile(snapshotUrl, JSON.stringify(styleOut, null, 2))
  } else {
    const expected = await readJson(snapshotUrl)
    assert.deepEqual(styleOut, expected)
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
