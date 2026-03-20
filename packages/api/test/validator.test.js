import { temporaryWrite } from 'tempy'
import { assert, describe, test } from 'vitest'
import { ZipWriter } from 'zip-writer'

import { randomBytes } from 'node:crypto'

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
  return streamToBuffer(zipWriter.readable)
}

describe('validate — issue structure', () => {
  test('issues have kind, type, and message fields', async () => {
    const result = await validate('/nonexistent/path/file.smp')
    assert.equal(result.valid, false)
    assert(result.issues.length > 0)
    const issue = result.issues[0]
    assert.equal(issue.kind, 'error')
    assert.equal(issue.type, 'file_not_found')
    assert(typeof issue.message === 'string')
  })

  test('valid SMP returns valid: true with no errors', async () => {
    const smpBuf = await createValidSmp()
    const filepath = await temporaryWrite(smpBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert.equal(errors(result).length, 0)
  })

  test('issues can be filtered by type for programmatic handling', async () => {
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
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    // Has errors, but if we filter out missing_tiles, no fatal errors remain
    assert(hasError(result, 'missing_tiles'))
    const fatalErrors = errors(result).filter((i) => i.type !== 'missing_tiles')
    assert.equal(fatalErrors.length, 0)
  })
})

describe('validate — ZIP and file errors', () => {
  test('nonexistent file → file_not_found error', async () => {
    const result = await validate('/nonexistent/path/file.smp')
    assert.equal(result.valid, false)
    assert(hasError(result, 'file_not_found'))
  })

  test('non-ZIP file → invalid_zip error', async () => {
    const filepath = await temporaryWrite(randomBytes(1024))
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'invalid_zip'))
  })

  test('unsafe ZIP entry with .. → unsafe_entry error', async () => {
    const zipBuf = await createZip([
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
      { name: 'fonts/../etc/passwd', data: 'malicious' },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(hasError(result, 'unsafe_entry'))
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
    const newZipBuf = await createZip(files)
    const filepath = await temporaryWrite(newZipBuf)
    const result = await validate(filepath)
    assert(hasWarning(result, 'missing_version'))
  })

  test('unsupported major version → unsupported_version error', async () => {
    const zipBuf = await createZip([
      { name: 'VERSION', data: '2.0\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'unsupported_version'))
  })

  test('compatible minor version is accepted', async () => {
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.1\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(!hasError(result, 'unsupported_version'))
  })

  test('invalid version format → invalid_version_format warning', async () => {
    const zipBuf = await createZip([
      { name: 'VERSION', data: 'abc\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(hasWarning(result, 'invalid_version_format'))
  })
})

describe('validate — style.json', () => {
  test('missing style.json → missing_style error', async () => {
    const zipBuf = await createZip([{ name: 'other.txt', data: 'hello' }])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'missing_style'))
  })

  test('invalid JSON → invalid_style_json error', async () => {
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: 'not json{{{' },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(hasError(result, 'invalid_style_json'))
  })
})

describe('validate — SMP metadata (§4.3, all OPTIONAL)', () => {
  test('missing smp:bounds → warning (not error)', async () => {
    const zipBuf = await createZip([
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
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(hasWarning(result, 'missing_smp_bounds'))
    assert(
      !hasError(result, 'missing_smp_bounds'),
      'should be warning not error',
    )
  })

  test('missing smp:maxzoom → warning (not error)', async () => {
    const zipBuf = await createZip([
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
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(hasWarning(result, 'missing_smp_maxzoom'))
    assert(
      !hasError(result, 'missing_smp_maxzoom'),
      'should be warning not error',
    )
  })

  test('missing smp:sourceFolders is valid (optional)', async () => {
    const zipBuf = await createZip([
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
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(!hasWarning(result, 'invalid_smp_source_folders'))
  })
})

describe('validate — source properties (§5.6)', () => {
  test('source missing required properties → missing_source_property errors', async () => {
    const zipBuf = await createZip([
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
    const filepath = await temporaryWrite(zipBuf)
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
    const zipBuf = await createZip([
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
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(hasError(result, 'source_has_url'))
  })

  test('geojson sources skip source property validation', async () => {
    const zipBuf = await createZip([
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
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(!hasError(result, 'missing_source_property'))
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
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      // No tile files
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(hasError(result, 'missing_tiles'))
    const tileError = errors(result).find((i) => i.type === 'missing_tiles')
    assert(tileError?.message.includes('missing'))
    assert.equal(tileError?.path, 'sources.test')
  })

  test('complete tiles pass validation', async () => {
    const smpBuf = await createValidSmp()
    const filepath = await temporaryWrite(smpBuf)
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
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 's/0/0/0/0.mvt.gz', data: new Uint8Array(64) },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(hasError(result, 'missing_tiles'))
    const tileError = errors(result).find((i) => i.type === 'missing_tiles')
    assert(tileError?.message.includes('4'), 'should report 4 missing z1 tiles')
  })
})

describe('validate — glyphs (§6, §9)', () => {
  test('missing glyph files → missing_glyphs error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      glyphs: 'smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz',
    }
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert(hasError(result, 'missing_glyphs'))
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
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const filepath = await temporaryWrite(zipBuf)
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
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 'sprites/default/sprite.json', data: '{}' },
      {
        name: 'sprites/default/sprite.png',
        data: new Uint8Array([0x89, 0x50]),
      },
    ])
    const filepath = await temporaryWrite(zipBuf)
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
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      { name: 'sprites/default/sprite.json', data: '{}' },
      {
        name: 'sprites/default/sprite.png',
        data: new Uint8Array([0x89, 0x50]),
      },
      // Missing signs sprites
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    const spriteErrors = errors(result).filter(
      (i) => i.type === 'missing_sprite',
    )
    assert(spriteErrors.some((i) => i.message.includes('signs')))
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
    const filepath = await temporaryWrite(smpBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert.equal(errors(result).length, 0)
    assert(!hasWarning(result, 'missing_version'), 'Writer includes VERSION')
  })
})
