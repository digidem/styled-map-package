import { temporaryWrite } from 'tempy'
import { assert, describe, onTestFinished, test } from 'vitest'
import { ZipWriter } from 'zip-writer'

import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'

import { validate } from '../lib/validator.js'
import { Writer } from '../lib/writer.js'
import { streamToBuffer } from './utils/stream-consumers.js'

/** @param {import('../lib/validator.js').ValidationResult} result */
const errors = (result) => result.issues.filter((i) => i.kind === 'error')
/** @param {import('../lib/validator.js').ValidationResult} result */
const warnings = (result) => result.issues.filter((i) => i.kind === 'warning')
/** @param {import('../lib/validator.js').ValidationResult} result @param {string} type */
const hasError = (result, type) => errors(result).some((i) => i.type === type)
/** @param {import('../lib/validator.js').ValidationResult} result @param {string} type */
const hasWarning = (result, type) =>
  warnings(result).some((i) => i.type === type)

/**
 * Write data to a temp file and schedule cleanup after the current test.
 * @param {Uint8Array | Buffer} data
 * @returns {Promise<string>}
 */
async function writeTempFile(data) {
  const filepath = await temporaryWrite(data)
  onTestFinished(() => rm(filepath, { force: true }))
  return filepath
}

/**
 * Create a minimal valid SMP buffer using the Writer
 */
async function createValidSmp() {
  const style = {
    version: /** @type {const} */ (8),
    sources: {
      test: { type: /** @type {const} */ ('vector') },
    },
    layers: [{ id: 'bg', type: /** @type {const} */ ('background') }],
  }
  const writer = new Writer(style)
  const readable = new ReadableStream({
    pull(controller) {
      controller.enqueue(randomBytes(1024))
      controller.close()
    },
  })
  await writer.addTile(readable, {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'test',
    format: 'mvt',
  })
  writer.finish()
  return streamToBuffer(writer.outputStream)
}

/**
 * Create a ZIP buffer with custom entries using zip-writer
 * @param {Array<{name: string, data: string | Uint8Array}>} files
 */
async function createZip(files) {
  const zipWriter = new ZipWriter()
  for (const { name, data } of files) {
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data
    await zipWriter.addEntry({
      name,
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
    })
  }
  await zipWriter.finalize()
  // @ts-ignore
  return streamToBuffer(zipWriter.readable)
}

/**
 * Create a ZIP buffer, write to temp file, schedule cleanup, and return path.
 * @param {Array<{name: string, data: string | Uint8Array}>} files
 * @returns {Promise<string>}
 */
async function createZipFile(files) {
  return writeTempFile(await createZip(files))
}

describe('validate — issue structure', () => {
  test('issues have kind, severity, type, and message fields', async () => {
    const result = await validate('/nonexistent/path/file.smp')
    assert.equal(result.valid, false)
    assert.equal(result.usable, false)
    assert(result.issues.length > 0)
    const issue = result.issues[0]
    assert.equal(issue.kind, 'error')
    assert.equal(issue.severity, 'fatal')
    assert.equal(issue.type, 'file_not_found')
    assert(typeof issue.message === 'string')
  })

  test('valid SMP returns valid: true and usable: true', async () => {
    const smpBuf = await createValidSmp()
    const filepath = await writeTempFile(smpBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert.equal(result.usable, true)
    assert.equal(errors(result).length, 0)
  })

  test('rendering issues make file invalid but still usable', async () => {
    const style = {
      version: 8,
      sources: {
        test: {
          type: 'vector',
          tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz'],
          bounds: [-1, -1, 1, 1],
          minzoom: 0,
          maxzoom: 0,
        },
      },
      layers: [],
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const result = await validate(filepath)
    assert.equal(result.valid, false, 'missing tiles is a spec error')
    assert.equal(result.usable, true, 'file can still be opened')
    assert(hasError(result, 'missing_tiles'))
    const tileIssue = errors(result).find((i) => i.type === 'missing_tiles')
    assert.equal(tileIssue?.severity, 'rendering')
  })

  test('spec-only warnings leave file valid and usable', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert.equal(result.usable, true)
    // Has spec warnings (missing metadata) but no errors
    assert(result.issues.length > 0)
    assert(result.issues.every((i) => i.severity === 'spec'))
  })
})

describe('validate — ZIP and file errors', () => {
  test('nonexistent file → file_not_found error', async () => {
    const result = await validate('/nonexistent/path/file.smp')
    assert.equal(result.valid, false)
    assert(hasError(result, 'file_not_found'))
  })

  test('non-ZIP file → invalid_zip error', async () => {
    const filepath = await writeTempFile(randomBytes(1024))
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'invalid_zip'))
  })

  test('unsafe ZIP entry with .. → unsafe_entry error', async () => {
    const filepath = await createZipFile([
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
      { name: 'fonts/../etc/passwd', data: 'malicious' },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'unsafe_entry'))
  })

  test('entry name exceeding 255 bytes → entry_name_too_long warning', async () => {
    const longName = 'a'.repeat(256)
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
      { name: longName, data: 'data' },
    ])
    const result = await validate(filepath)
    assert(hasWarning(result, 'entry_name_too_long'))
  })

  test('maxEntries option limits entry count', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
      { name: 'extra1', data: 'data' },
      { name: 'extra2', data: 'data' },
    ])
    const result = await validate(filepath, { maxEntries: 3 })
    assert.equal(result.valid, false)
    assert(hasError(result, 'too_many_entries'))
  })
})

describe('validate — VERSION file', () => {
  test('missing VERSION → missing_version warning', async () => {
    const smpBuf = await createValidSmp()
    // Rebuild without VERSION
    const { ZipReader } = await import('@gmaclennan/zip-reader')
    const { BufferSource } =
      await import('@gmaclennan/zip-reader/buffer-source')
    const zip = await ZipReader.from(new BufferSource(smpBuf))
    const files = []
    for await (const entry of zip) {
      if (entry.name === 'VERSION') continue
      const data = await streamToBuffer(entry.readable())
      files.push({ name: entry.name, data })
    }
    const filepath = await writeTempFile(await createZip(files))
    const result = await validate(filepath)
    assert(hasWarning(result, 'missing_version'))
  })

  test('unsupported major version → unsupported_version error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '2.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
    ])
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'unsupported_version'))
  })

  test('unsupported version short-circuits further validation', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '2.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'unsupported_version'))
    // Should NOT have any style/metadata/source errors — validation stopped early
    assert(!hasError(result, 'missing_style'))
    assert(!hasWarning(result, 'missing_smp_bounds'))
    assert.equal(result.issues.length, 1)
  })

  test('compatible minor version is accepted', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.1\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
    ])
    const result = await validate(filepath)
    assert(!hasError(result, 'unsupported_version'))
  })

  test('invalid version format → invalid_version_format warning', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: 'abc\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
    ])
    const result = await validate(filepath)
    assert(hasWarning(result, 'invalid_version_format'))
  })
})

describe('validate — style.json', () => {
  test('missing style.json → missing_style error', async () => {
    const filepath = await createZipFile([{ name: 'other.txt', data: 'hello' }])
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'missing_style'))
  })

  test('invalid JSON → invalid_style_json error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: 'not json{{{' },
    ])
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'invalid_style_json'))
  })
})

describe('validate — SMP metadata (§4.3)', () => {
  test('missing smp:bounds → warning (not error)', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:maxzoom': 5 },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasWarning(result, 'missing_smp_bounds'))
    assert(
      !hasError(result, 'missing_smp_bounds'),
      'should be warning not error',
    )
  })

  test('smp:bounds with non-numeric values → warning', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: {
            'smp:bounds': ['foo', -85, 180, 85],
            'smp:maxzoom': 5,
          },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasWarning(result, 'invalid_smp_bounds'))
  })

  test('missing smp:maxzoom → warning (not error)', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:bounds': [-180, -85, 180, 85] },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasWarning(result, 'missing_smp_maxzoom'))
    assert(
      !hasError(result, 'missing_smp_maxzoom'),
      'should be warning not error',
    )
  })

  test('smp:maxzoom non-integer → warning', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:bounds': [-180, -85, 180, 85], 'smp:maxzoom': 2.5 },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasWarning(result, 'invalid_smp_maxzoom'))
  })

  test('smp:maxzoom out of range (> 30) → error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:bounds': [-180, -85, 180, 85], 'smp:maxzoom': 31 },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'invalid_smp_maxzoom'))
  })

  test('smp:maxzoom negative → error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:bounds': [-180, -85, 180, 85], 'smp:maxzoom': -1 },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'invalid_smp_maxzoom'))
  })

  test('smp:maxzoom at boundaries (0 and 30) pass', async () => {
    for (const maxzoom of [0, 30]) {
      const filepath = await createZipFile([
        { name: 'VERSION', data: '1.0\n' },
        {
          name: 'style.json',
          data: JSON.stringify({
            version: 8,
            sources: {},
            layers: [],
            metadata: {
              'smp:bounds': [-180, -85, 180, 85],
              'smp:maxzoom': maxzoom,
            },
          }),
        },
      ])
      const result = await validate(filepath)
      assert(
        !hasError(result, 'invalid_smp_maxzoom'),
        `maxzoom ${maxzoom} should be valid`,
      )
    }
  })

  test('missing smp:sourceFolders is valid (optional)', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:bounds': [-180, -85, 180, 85], 'smp:maxzoom': 5 },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(!hasWarning(result, 'invalid_smp_source_folders'))
  })
})

describe('validate — source properties (§5.6)', () => {
  test('source missing required properties → missing_source_property errors', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: { test: { type: 'vector' } },
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'missing_source_property'))
    const propErrors = errors(result).filter(
      (i) => i.type === 'missing_source_property',
    )
    const paths = propErrors.map((i) => i.path)
    assert(paths.includes('sources.test.bounds'))
    assert(paths.includes('sources.test.tiles'))
  })

  test('source with url property → source_has_url error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {
            test: {
              type: 'vector',
              url: 'https://example.com/tilejson.json',
              tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz'],
              bounds: [-180, -85, 180, 85],
              minzoom: 0,
              maxzoom: 0,
            },
          },
          layers: [],
        }),
      },
      { name: 's/0/0/0/0.mvt.gz', data: new Uint8Array(64) },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'source_has_url'))
  })

  test('geojson sources skip source property validation', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {
            places: {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            },
          },
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert(!hasError(result, 'missing_source_property'))
  })
})

describe('validate — tile format consistency (§5.3)', () => {
  test('mixed tile formats → mixed_tile_formats error', async () => {
    const style = {
      version: 8,
      sources: {
        test: {
          type: 'raster',
          tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.png'],
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 0,
        },
      },
      layers: [],
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 's/0/0/0/0.png', data: new Uint8Array(64) },
      { name: 's/0/0/0/1.jpg', data: new Uint8Array(64) },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'mixed_tile_formats'))
  })

  test('non-tile files under source prefix do not trigger mixed format', async () => {
    const style = {
      version: 8,
      sources: {
        test: {
          type: 'vector',
          tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz'],
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 0,
        },
      },
      layers: [],
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 's/0/0/0/0.mvt.gz', data: new Uint8Array(64) },
      { name: 's/0/metadata.json', data: '{}' },
    ])
    const result = await validate(filepath)
    assert(!hasError(result, 'mixed_tile_formats'))
  })

  test('consistent tile formats pass', async () => {
    const smpBuf = await createValidSmp()
    const filepath = await writeTempFile(smpBuf)
    const result = await validate(filepath)
    assert(!hasError(result, 'mixed_tile_formats'))
  })
})

describe('validate — tile completeness (§5.7)', () => {
  test('missing tiles → missing_tiles error with count', async () => {
    const style = {
      version: 8,
      sources: {
        test: {
          type: 'vector',
          tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz'],
          bounds: [-1, -1, 1, 1],
          minzoom: 0,
          maxzoom: 0,
        },
      },
      layers: [],
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      // No tile files
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'missing_tiles'))
    const tileError = errors(result).find((i) => i.type === 'missing_tiles')
    assert(tileError?.message.includes('missing'))
    assert.equal(tileError?.path, 'sources.test')
  })

  test('complete tiles pass validation', async () => {
    const smpBuf = await createValidSmp()
    const filepath = await writeTempFile(smpBuf)
    const result = await validate(filepath)
    assert(!hasError(result, 'missing_tiles'))
  })

  test('partial tiles report count of missing', async () => {
    const style = {
      version: 8,
      sources: {
        test: {
          type: 'vector',
          tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz'],
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 1,
        },
      },
      layers: [],
    }
    // z0 has 1 tile, z1 has 4 tiles — only provide z0
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 's/0/0/0/0.mvt.gz', data: new Uint8Array(64) },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'missing_tiles'))
    const tileError = errors(result).find((i) => i.type === 'missing_tiles')
    assert(tileError?.message.includes('4'), 'should report 4 missing z1 tiles')
  })
})

describe('validate — glyphs (§6)', () => {
  test('missing glyph files → missing_glyphs error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      glyphs: 'smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz',
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'missing_glyphs'))
  })

  test('glyph template missing placeholders → invalid_glyph_template error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      glyphs: 'smp://maps.v1/fonts/all-glyphs.pbf.gz',
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 'fonts/all-glyphs.pbf.gz', data: new Uint8Array(64) },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'invalid_glyph_template'))
  })

  test('font with no glyph files → missing_font_glyphs error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          layout: { 'text-field': '{name}', 'text-font': ['Missing Font'] },
        },
      ],
      glyphs: 'smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz',
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      // Glyph files for a different font, so missing_glyphs won't fire
      { name: 'fonts/Other Font/0-255.pbf.gz', data: new Uint8Array(64) },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'missing_font_glyphs'))
  })

  test('font with partial glyph ranges → incomplete_font_glyphs warning', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          layout: {
            'text-field': '{name}',
            'text-font': ['Noto Sans Regular'],
          },
        },
      ],
      glyphs: 'smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz',
    }
    // Only provide 3 of 93 required (non-locally-rendered) ranges
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      {
        name: 'fonts/Noto Sans Regular/0-255.pbf.gz',
        data: new Uint8Array(64),
      },
      {
        name: 'fonts/Noto Sans Regular/256-511.pbf.gz',
        data: new Uint8Array(64),
      },
      {
        name: 'fonts/Noto Sans Regular/512-767.pbf.gz',
        data: new Uint8Array(64),
      },
    ])
    const result = await validate(filepath)
    assert(hasWarning(result, 'incomplete_font_glyphs'))
    const w = warnings(result).find((i) => i.type === 'incomplete_font_glyphs')
    // 93 required ranges (256 total minus 163 locally-rendered)
    assert(w?.message.includes('3 of 93'))
  })

  test('locally-rendered CJK/Hangul/Kana ranges are not required', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          layout: {
            'text-field': '{name}',
            'text-font': ['Test Font'],
          },
        },
      ],
      glyphs: 'smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz',
    }
    // Provide all 93 non-locally-rendered ranges (skip CJK/Hangul/Kana)
    /** @type {Array<{name: string, data: string | Uint8Array}>} */
    const files = [
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ]
    for (let i = 0; i < 256; i++) {
      const start = i * 256
      // Skip locally-rendered ranges (same ranges as LOCAL_GLYPH_RANGES)
      if (
        (start >= 0x3000 && start < 0x3400) ||
        (start >= 0x3400 && start < 0x4e00) ||
        (start >= 0x4e00 && start < 0xa000) ||
        (start >= 0xa000 && start < 0xa400) ||
        (start >= 0xac00 && start < 0xd800) ||
        (start >= 0xf900 && start < 0xfb00) ||
        (start >= 0xff00 && start < 0x10000)
      )
        continue
      files.push({
        name: `fonts/Test Font/${start}-${start + 255}.pbf.gz`,
        data: new Uint8Array(8),
      })
    }
    const filepath = await writeTempFile(await createZip(files))
    const result = await validate(filepath)
    assert(!hasError(result, 'missing_font_glyphs'))
    assert(!hasWarning(result, 'incomplete_font_glyphs'))
  })

  test('demotiles fixture has complete non-CJK glyph coverage', async () => {
    // demotiles has 255 of 256 total ranges — the missing one should be
    // a locally-rendered range, so no warning after excluding local ranges
    const result = await validate('test/fixtures/demotiles-z2.smp')
    assert(result.valid, 'fixture should be valid overall')
    assert(!hasWarning(result, 'incomplete_font_glyphs'))
  })

  test('expression-based text-font fontstacks are checked', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'labels',
          type: 'symbol',
          source: 'test',
          layout: {
            'text-field': '{name}',
            'text-font': [
              'match',
              ['get', 'type'],
              'park',
              ['literal', ['Italic Font']],
              ['literal', ['Regular Font']],
            ],
          },
        },
      ],
      glyphs: 'smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz',
    }
    // Only provide a few ranges for Regular Font, none for Italic Font
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      {
        name: 'fonts/Regular Font/0-255.pbf.gz',
        data: new Uint8Array(8),
      },
    ])
    const result = await validate(filepath)
    // Italic Font should error (zero ranges), Regular Font should warn (incomplete)
    assert(hasError(result, 'missing_font_glyphs'))
    const fontError = errors(result).find(
      (i) => i.type === 'missing_font_glyphs',
    )
    assert(fontError?.message.includes('Italic Font'))
    assert(hasWarning(result, 'incomplete_font_glyphs'))
  })
})

describe('validate — sprites (§7)', () => {
  test('missing 1x sprite files → missing_sprite error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      sprite: 'smp://maps.v1/sprites/default/sprite',
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'missing_sprite'))
  })

  test('1x sprites present but no 2x → missing_sprite_2x warning', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      sprite: 'smp://maps.v1/sprites/default/sprite',
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 'sprites/default/sprite.json', data: '{}' },
      {
        name: 'sprites/default/sprite.png',
        data: new Uint8Array([0x89, 0x50]),
      },
    ])
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert(hasWarning(result, 'missing_sprite_2x'))
  })

  test('array sprites validates each entry', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      sprite: [
        { id: 'default', url: 'smp://maps.v1/sprites/default/sprite' },
        { id: 'signs', url: 'smp://maps.v1/sprites/signs/sprite' },
      ],
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 'sprites/default/sprite.json', data: '{}' },
      {
        name: 'sprites/default/sprite.png',
        data: new Uint8Array([0x89, 0x50]),
      },
      // Missing signs sprites
    ])
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    const spriteErrors = errors(result).filter(
      (i) => i.type === 'missing_sprite',
    )
    assert(spriteErrors.some((i) => i.message.includes('signs')))
  })

  test('external URL in sprite array → external_resource error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      sprite: [
        { id: 'default', url: 'smp://maps.v1/sprites/default/sprite' },
        { id: 'ext', url: 'https://example.com/sprites/ext/sprite' },
      ],
    }
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 'sprites/default/sprite.json', data: '{}' },
      {
        name: 'sprites/default/sprite.png',
        data: new Uint8Array([0x89, 0x50]),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'external_resource'))
    const extError = errors(result).find(
      (i) => i.type === 'external_resource' && i.path === 'sprite',
    )
    assert(extError?.message.includes('https://example.com'))
  })
})

describe('validate — tile template (§5.5)', () => {
  test('tile URL without SMP URI scheme → invalid_tile_template error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {
            test: {
              type: 'vector',
              tiles: ['https://example.com/{z}/{x}/{y}.mvt'],
              bounds: [-180, -85, 180, 85],
              minzoom: 0,
              maxzoom: 0,
            },
          },
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'invalid_tile_template'))
  })

  test('tile URL missing placeholders → invalid_tile_template error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {
            test: {
              type: 'vector',
              tiles: ['smp://maps.v1/s/0/tiles.mvt.gz'],
              bounds: [-180, -85, 180, 85],
              minzoom: 0,
              maxzoom: 0,
            },
          },
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'invalid_tile_template'))
  })
})

describe('validate — tile scheme (§5.4)', () => {
  test('source with scheme: "tms" → invalid_tile_scheme error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {
            test: {
              type: 'vector',
              scheme: 'tms',
              tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz'],
              bounds: [-180, -85, 180, 85],
              minzoom: 0,
              maxzoom: 0,
            },
          },
          layers: [],
        }),
      },
      { name: 's/0/0/0/0.mvt.gz', data: new Uint8Array(64) },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'invalid_tile_scheme'))
  })
})

describe('validate — GeoJSON data files (§8)', () => {
  test('missing GeoJSON data file → missing_geojson_data error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {
            places: {
              type: 'geojson',
              data: 'smp://maps.v1/s/places/data.geojson',
            },
          },
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'missing_geojson_data'))
  })

  test('present GeoJSON data file passes', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {
            places: {
              type: 'geojson',
              data: 'smp://maps.v1/s/places/data.geojson',
            },
          },
          layers: [],
        }),
      },
      {
        name: 's/places/data.geojson',
        data: '{"type":"FeatureCollection","features":[]}',
      },
    ])
    const result = await validate(filepath)
    assert(!hasError(result, 'missing_geojson_data'))
  })

  test('inline GeoJSON data does not trigger missing file check', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {
            places: {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            },
          },
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert(!hasError(result, 'missing_geojson_data'))
  })
})

describe('validate — unsupported source types (§5.1)', () => {
  test('raster-dem source → unsupported_source_type warning', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: { terrain: { type: 'raster-dem' } },
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasWarning(result, 'unsupported_source_type'))
  })
})

describe('validate — external resources (§4.2.2)', () => {
  test('external glyphs URL → external_resource error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'external_resource'))
  })

  test('external sprite URL → external_resource error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          sprite: 'https://example.com/sprites/default/sprite',
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'external_resource'))
  })

  test('absent glyphs/sprite is fine (no error)', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
        }),
      },
    ])
    const result = await validate(filepath)
    assert(!hasError(result, 'external_resource'))
  })
})

describe('validate — smp:bounds range (§4.3.1)', () => {
  test('longitude out of range → invalid_smp_bounds error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:bounds': [-200, -85, 180, 85], 'smp:maxzoom': 5 },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'invalid_smp_bounds'))
  })

  test('latitude out of range → invalid_smp_bounds error', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:bounds': [-180, -100, 180, 85], 'smp:maxzoom': 5 },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(hasError(result, 'invalid_smp_bounds'))
  })

  test('valid bounds pass', async () => {
    const filepath = await createZipFile([
      { name: 'VERSION', data: '1.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: { 'smp:bounds': [-180, -85, 180, 85], 'smp:maxzoom': 5 },
        }),
      },
    ])
    const result = await validate(filepath)
    assert(!hasError(result, 'invalid_smp_bounds'))
  })
})

describe('validate — ZipReader input', () => {
  test('accepts a ZipReader instance', async () => {
    const smpBuf = await createValidSmp()
    const { ZipReader } = await import('@gmaclennan/zip-reader')
    const { BufferSource } =
      await import('@gmaclennan/zip-reader/buffer-source')
    const zipReader = await ZipReader.from(new BufferSource(smpBuf))
    const result = await validate(zipReader)
    assert.equal(result.valid, true)
    assert.equal(errors(result).length, 0)
  })
})

describe('validate — Writer output', () => {
  test('valid SMP created by Writer passes validation', async () => {
    const smpBuf = await createValidSmp()
    const filepath = await writeTempFile(smpBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert.equal(errors(result).length, 0)
    assert(!hasWarning(result, 'missing_version'), 'Writer includes VERSION')
  })
})
