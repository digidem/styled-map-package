import { assert, describe, test } from 'vitest'

import {
  analyzeTextField,
  GlyphRangeCollector,
} from '../lib/utils/glyph-ranges.js'
import { scanTileText } from '../lib/utils/mvt-text.js'
import { encodeTile } from './utils/mvt-encode.js'

/** @import { StyleInlinedSources } from '../lib/types.js' */

/**
 * @param {Uint8Array} tile
 * @param {Map<string, Set<string> | null>} layerKeys
 */
function scan(tile, layerKeys) {
  /** @type {string[]} */
  const texts = []
  scanTileText(tile, layerKeys, (text) => texts.push(text))
  return texts.sort()
}

describe('scanTileText', () => {
  const tile = encodeTile([
    {
      name: 'place',
      features: [
        { name: 'Αθήνα', class: 'city', rank: 1 },
        { name: 'city', 'name:ru': 'Афины', capital: true },
        { class: 'Кафе', ele: 1.5 },
      ],
    },
    { name: 'poi', features: [{ name: 'Café' }] },
  ])

  test('reads only values of wanted keys', () => {
    const texts = scan(tile, new Map([['place', new Set(['name'])]]))
    assert.deepEqual(texts, ['city', 'Αθήνα'])
  })

  test('reads every string value when keys are null', () => {
    const texts = scan(tile, new Map([['place', null]]))
    assert.deepEqual(texts, ['city', 'Αθήνα', 'Афины', 'Кафе'])
  })

  test('skips layers that are not listed', () => {
    const texts = scan(tile, new Map([['poi', new Set(['name'])]]))
    assert.deepEqual(texts, ['Café'])
  })

  test('skips layers with no wanted keys', () => {
    const texts = scan(tile, new Map([['place', new Set(['missing'])]]))
    assert.deepEqual(texts, [])
  })

  test('handles the layer name after the other fields', () => {
    const reordered = encodeTile([
      { name: 'place', features: [{ name: 'Αθήνα' }], nameLast: true },
    ])
    const texts = scan(reordered, new Map([['place', new Set(['name'])]]))
    assert.deepEqual(texts, ['Αθήνα'])
  })

  test('reads unpacked feature tags', () => {
    const unpacked = encodeTile([
      {
        name: 'place',
        features: [{ name: 'Αθήνα', class: 'Кафе' }],
        unpackedTags: true,
      },
    ])
    const texts = scan(unpacked, new Map([['place', new Set(['name'])]]))
    assert.deepEqual(texts, ['Αθήνα'])
  })

  test('reads an empty tile', () => {
    assert.deepEqual(scan(new Uint8Array(0), new Map([['place', null]])), [])
  })

  test('throws on truncated data', () => {
    assert.throws(() =>
      scan(tile.subarray(0, tile.length - 3), new Map([['poi', null]])),
    )
  })

  test('throws on gzipped data', () => {
    const gzipped = new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3])
    assert.throws(() => scan(gzipped, new Map([['place', null]])))
  })
})

describe('analyzeTextField', () => {
  test('finds keys in get expressions', () => {
    const { keys, needsAllRanges } = analyzeTextField([
      'case',
      ['has', 'name:nonlatin'],
      ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']],
      ['coalesce', ['get', 'name_en'], ['get', 'name']],
    ])
    assert.deepEqual(
      [...(keys ?? [])].sort(),
      ['name', 'name:latin', 'name:nonlatin', 'name_en'].sort(),
    )
    assert.equal(needsAllRanges, false)
  })

  test('finds keys in legacy token strings', () => {
    const { keys, literals } = analyzeTextField('{name:latin} – {ref}')
    assert.deepEqual([...(keys ?? [])], ['name:latin', 'ref'])
    assert.include(literals, '{name:latin} – {ref}')
  })

  test('collects literal strings', () => {
    const { literals } = analyzeTextField([
      'format',
      ['get', 'name'],
      {},
      ['literal', ['Ω', { x: 'Ж' }]],
      { 'font-scale': 0.8 },
    ])
    assert.includeMembers(literals, ['Ω', 'Ж'])
  })

  test('returns null keys for dynamic lookups', () => {
    assert.equal(
      analyzeTextField(['get', ['concat', 'name:', ['get', 'lang']]]).keys,
      null,
    )
    assert.equal(analyzeTextField(['get', 'name', ['properties']]).keys, null)
    assert.equal(analyzeTextField(['to-string', ['properties']]).keys, null)
  })

  test('number-format uses the device locale unless one is given', () => {
    const deviceLocale = analyzeTextField(['number-format', ['get', 'ele'], {}])
    assert.equal(deviceLocale.formatsNumbers, true)
    assert.equal(deviceLocale.needsAllRanges, false)

    const arabic = analyzeTextField([
      'number-format',
      ['get', 'ele'],
      { locale: 'ar-EG' },
    ])
    assert.equal(arabic.formatsNumbers, false)
    assert(
      arabic.literals.some((text) => text.includes('٤')),
      'formats a sample number with the given locale',
    )
  })

  test('needs all ranges for currency formatting', () => {
    const { needsAllRanges } = analyzeTextField([
      'number-format',
      ['get', 'price'],
      { currency: 'EUR' },
    ])
    assert.equal(needsAllRanges, true)
  })

  test('detects case, id and global-state expressions', () => {
    assert.equal(
      analyzeTextField(['upcase', ['get', 'name']]).changesCase,
      true,
    )
    assert.equal(analyzeTextField(['to-string', ['id']]).usesId, true)
    assert.equal(
      analyzeTextField(['global-state', 'label']).usesGlobalState,
      true,
    )
  })
})

/**
 * @param {Array<Record<string, any>>} layers
 * @param {Record<string, any>} [sources]
 * @returns {StyleInlinedSources}
 */
function makeStyle(layers, sources) {
  return /** @type {any} */ ({
    version: 8,
    sources: sources ?? {
      vt: { type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
    },
    layers,
  })
}

const labelLayer = {
  id: 'labels',
  type: 'symbol',
  source: 'vt',
  'source-layer': 'place',
  layout: { 'text-field': ['get', 'name'] },
}

/**
 * @param {GlyphRangeCollector} collector
 * @param {string[]} names
 */
function addNames(collector, names) {
  collector.addTile(
    encodeTile([{ name: 'place', features: names.map((name) => ({ name })) }]),
    'vt',
  )
}

/** @param {number[]} starts */
const hex = (starts) => starts.map((s) => s.toString(16))

describe('GlyphRangeCollector', () => {
  test('always includes range 0-255', () => {
    const collector = new GlyphRangeCollector(makeStyle([labelLayer]))
    assert.deepEqual(collector.getRanges(), [0])
  })

  test('adds ranges for text in wanted properties', () => {
    const collector = new GlyphRangeCollector(makeStyle([labelLayer]))
    collector.addTile(
      encodeTile([
        { name: 'place', features: [{ name: 'Αθήνα', other: 'Афины' }] },
        { name: 'poi', features: [{ name: 'Кафе' }] },
      ]),
      'vt',
    )
    assert.deepEqual(hex(collector.getRanges() ?? []), ['0', '300'])
  })

  test('ignores tiles from sources without labels', () => {
    const collector = new GlyphRangeCollector(makeStyle([labelLayer]))
    collector.addTile(new Uint8Array([0xff]), 'other')
    assert.deepEqual(collector.getRanges(), [0])
  })

  test('adds presentation form ranges for Arabic', () => {
    const collector = new GlyphRangeCollector(makeStyle([labelLayer]))
    addNames(collector, ['القاهرة'])
    assert.deepEqual(hex(collector.getRanges() ?? []), [
      '0',
      '600',
      'fb00',
      'fc00',
      'fd00',
      'fe00',
    ])
  })

  test('adds vertical punctuation ranges for CJK', () => {
    const collector = new GlyphRangeCollector(makeStyle([labelLayer]))
    addNames(collector, ['東京'])
    assert.deepEqual(hex(collector.getRanges() ?? []), [
      '0',
      '2000',
      '3000',
      '4e00',
      '6700',
      'fe00',
      'ff00',
    ])
  })

  test('ignores characters outside the Basic Multilingual Plane', () => {
    const collector = new GlyphRangeCollector(makeStyle([labelLayer]))
    addNames(collector, ['🍕 Pizza'])
    assert.deepEqual(collector.getRanges(), [0])
  })

  test('adds case variants only when text-transform is used', () => {
    // 'ÿ' (U+00FF) uppercases to 'Ÿ' (U+0178)
    const plain = new GlyphRangeCollector(makeStyle([labelLayer]))
    addNames(plain, ['ÿ'])
    assert.deepEqual(plain.getRanges(), [0])

    const transformed = new GlyphRangeCollector(
      makeStyle([
        {
          ...labelLayer,
          layout: { ...labelLayer.layout, 'text-transform': 'uppercase' },
        },
      ]),
    )
    addNames(transformed, ['ÿ'])
    // Also includes ranges for Turkish and Lithuanian locale casing
    assert.deepEqual(transformed.getRanges(), [0, 0x100, 0x300])
  })

  test('adds case variants for upcase expressions', () => {
    const collector = new GlyphRangeCollector(
      makeStyle([
        {
          ...labelLayer,
          layout: { 'text-field': ['upcase', ['get', 'name']] },
        },
      ]),
    )
    addNames(collector, ['Haÿ'])
    assert.deepEqual(collector.getRanges(), [0, 0x100, 0x300])
  })

  test('adds case variants to literals from earlier layers', () => {
    const collector = new GlyphRangeCollector(
      makeStyle([
        { ...labelLayer, layout: { 'text-field': 'ÿ' } },
        {
          ...labelLayer,
          id: 'upper',
          layout: { 'text-field': 'x', 'text-transform': 'uppercase' },
        },
      ]),
    )
    assert.include(collector.getRanges() ?? [], 0x100)
  })

  test('adds vertical punctuation ranges for other upright scripts', () => {
    const collector = new GlyphRangeCollector(makeStyle([labelLayer]))
    addNames(collector, ['ᐃᓄᒃᑎᑐᑦ (Inuktitut)'])
    assert.deepEqual(hex(collector.getRanges() ?? []), [
      '0',
      '1400',
      '2000',
      '3000',
      'fe00',
      'ff00',
    ])
  })

  test('adds digit and separator ranges for number-format', () => {
    const collector = new GlyphRangeCollector(
      makeStyle([
        {
          ...labelLayer,
          layout: { 'text-field': ['number-format', ['get', 'ele'], {}] },
        },
      ]),
    )
    assert.includeMembers(collector.getRanges() ?? [], [0x600, 0x900, 0x2000])
  })

  test('reads promoted ids used as labels', () => {
    const style = makeStyle(
      [{ ...labelLayer, layout: { 'text-field': ['to-string', ['id']] } }],
      {
        vt: {
          type: 'vector',
          tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
          promoteId: { place: 'ref' },
        },
      },
    )
    const collector = new GlyphRangeCollector(style)
    collector.addTile(
      encodeTile([
        { name: 'place', features: [{ ref: 'Αθήνα', name: 'Кафе' }] },
      ]),
      'vt',
    )
    assert.deepEqual(collector.getRanges(), [0, 0x300])
  })

  test('reads string ids of GeoJSON features used as labels', () => {
    const collector = new GlyphRangeCollector(
      makeStyle(
        [
          {
            id: 'geo-labels',
            type: 'symbol',
            source: 'geo',
            layout: { 'text-field': ['to-string', ['id']] },
          },
        ],
        {
          geo: {
            type: 'geojson',
            data: {
              type: 'Feature',
              id: 'Αθήνα',
              geometry: { type: 'Point', coordinates: [0, 0] },
              properties: { name: 'Кафе' },
            },
          },
        },
      ),
    )
    assert.deepEqual(collector.getRanges(), [0, 0x300])
  })

  test('reads every property of clustered GeoJSON', () => {
    const collector = new GlyphRangeCollector(
      makeStyle(
        [
          {
            id: 'geo-labels',
            type: 'symbol',
            source: 'geo',
            layout: { 'text-field': ['get', 'names'] },
          },
        ],
        {
          geo: {
            type: 'geojson',
            cluster: true,
            clusterProperties: {
              names: [
                ['concat', ['accumulated'], '、'],
                ['get', 'name'],
              ],
            },
            data: {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [0, 0] },
              properties: { name: 'Кафе' },
            },
          },
        },
      ),
    )
    assert.includeMembers(collector.getRanges() ?? [], [0x400, 0x3000])
  })

  test('analyzes cluster property expressions', () => {
    const collector = new GlyphRangeCollector(
      makeStyle(
        [
          {
            id: 'geo-labels',
            type: 'symbol',
            source: 'geo',
            layout: { 'text-field': ['get', 'names'] },
          },
        ],
        {
          geo: {
            type: 'geojson',
            cluster: true,
            clusterProperties: {
              names: [
                ['concat', ['accumulated'], ','],
                ['upcase', ['get', 'n']],
              ],
            },
            data: { type: 'FeatureCollection', features: [] },
          },
        },
      ),
    )
    assert.deepEqual(collector.getRanges(), [0, 0x100, 0x300])
  })

  test('returns null for vector sources that are not MVT', () => {
    const style = makeStyle([labelLayer], {
      vt: { type: 'vector', tiles: [], encoding: 'mlt' },
    })
    assert.equal(new GlyphRangeCollector(style).getRanges(), null)
  })

  test('ignores a null promoteId', () => {
    const style = makeStyle([labelLayer], {
      vt: { type: 'vector', tiles: [], promoteId: null },
    })
    const collector = new GlyphRangeCollector(style)
    addNames(collector, ['Αθήνα'])
    assert.deepEqual(collector.getRanges(), [0, 0x300])
  })

  test('returns null for GeoJSON data that was not inlined', () => {
    const collector = new GlyphRangeCollector(
      makeStyle(
        [
          {
            id: 'geo-labels',
            type: 'symbol',
            source: 'geo',
            layout: { 'text-field': ['get', 'name'] },
          },
        ],
        { geo: { type: 'geojson', data: 'https://example.com/data.json' } },
      ),
    )
    assert.equal(collector.getRanges(), null)
  })

  test('includes global-state defaults used in labels', () => {
    const style = makeStyle([
      { ...labelLayer, layout: { 'text-field': ['global-state', 'label'] } },
    ])
    style.state = { label: { default: 'Αθήνα' } }
    const collector = new GlyphRangeCollector(style)
    assert.deepEqual(collector.getRanges(), [0, 0x300])
  })

  test('includes literal strings from text-field', () => {
    const collector = new GlyphRangeCollector(
      makeStyle([
        {
          ...labelLayer,
          layout: { 'text-field': ['concat', ['get', 'ele'], ' м'] },
        },
      ]),
    )
    assert.deepEqual(collector.getRanges(), [0, 0x400])
  })

  test('scans every string when keys are dynamic', () => {
    const collector = new GlyphRangeCollector(
      makeStyle([
        {
          ...labelLayer,
          layout: { 'text-field': ['get', ['concat', 'name:', 'ru']] },
        },
      ]),
    )
    collector.addTile(
      encodeTile([{ name: 'place', features: [{ 'name:ru': 'Афины' }] }]),
      'vt',
    )
    assert.deepEqual(collector.getRanges(), [0, 0x400])
  })

  test('merges keys from layers on the same source-layer', () => {
    const collector = new GlyphRangeCollector(
      makeStyle([
        labelLayer,
        {
          ...labelLayer,
          id: 'labels-ru',
          layout: { 'text-field': ['get', 'name:ru'] },
        },
      ]),
    )
    collector.addTile(
      encodeTile([
        {
          name: 'place',
          features: [{ name: 'Αθήνα', 'name:ru': 'Афины', 'name:he': 'אתונה' }],
        },
      ]),
      'vt',
    )
    assert.deepEqual(collector.getRanges(), [0, 0x300, 0x400])
  })

  test('returns null when a tile cannot be parsed', () => {
    const collector = new GlyphRangeCollector(makeStyle([labelLayer]))
    collector.addTile(new Uint8Array([0x1f, 0x8b, 0x08, 0]), 'vt')
    assert.equal(collector.getRanges(), null)
  })

  test('returns null for currency formatting', () => {
    const collector = new GlyphRangeCollector(
      makeStyle([
        {
          ...labelLayer,
          layout: {
            'text-field': [
              'number-format',
              ['get', 'price'],
              { currency: 'EUR' },
            ],
          },
        },
      ]),
    )
    assert.equal(collector.getRanges(), null)
  })

  test('reads inline GeoJSON properties', () => {
    const collector = new GlyphRangeCollector(
      makeStyle(
        [
          {
            id: 'geo-labels',
            type: 'symbol',
            source: 'geo',
            layout: { 'text-field': ['get', 'title'] },
          },
        ],
        {
          geo: {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: [0, 0] },
                  properties: { title: 'Αθήνα', other: 'Афины' },
                },
              ],
            },
          },
        },
      ),
    )
    assert.deepEqual(collector.getRanges(), [0, 0x300])
  })
})
