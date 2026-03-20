import { temporaryWrite } from 'tempy'
import { assert, describe, test } from 'vitest'
import { ZipWriter } from 'zip-writer'

import { randomBytes } from 'node:crypto'

import { validate } from '../lib/validator.js'
import { Writer } from '../lib/writer.js'
import { streamToBuffer } from './utils/stream-consumers.js'

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

describe('validate', () => {
  test('valid SMP file returns valid: true', async () => {
    const smpBuf = await createValidSmp()
    const filepath = await temporaryWrite(smpBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert.deepEqual(result.errors, [])
  })

  test('nonexistent file returns error', async () => {
    const result = await validate('/nonexistent/path/file.smp')
    assert.equal(result.valid, false)
    assert(result.errors[0].includes('File not found'))
  })

  test('non-ZIP file returns error', async () => {
    const filepath = await temporaryWrite(randomBytes(1024))
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors[0].includes('Not a valid ZIP'))
  })

  test('ZIP without style.json returns error', async () => {
    const zipBuf = await createZip([{ name: 'other.txt', data: 'hello' }])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors.some((e) => e.includes('Missing style.json')))
  })

  test('ZIP with invalid JSON style.json returns error', async () => {
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: 'not json{{{' },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors.some((e) => e.includes('not valid JSON')))
  })

  test('SMP without VERSION file returns warning', async () => {
    const smpBuf = await createValidSmp()
    // Create a new ZIP with all entries except VERSION
    const { ZipReader } = await import('@gmaclennan/zip-reader')
    const { BufferSource } =
      await import('@gmaclennan/zip-reader/buffer-source')
    const zip = await ZipReader.from(new BufferSource(smpBuf))
    const files = []
    for await (const entry of zip) {
      if (entry.name === 'VERSION') continue
      const chunks = []
      const reader = entry.readable().getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
      const data = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      files.push({ name: entry.name, data })
    }
    const newZipBuf = await createZip(files)
    const filepath = await temporaryWrite(newZipBuf)
    const result = await validate(filepath)
    assert(result.warnings.some((w) => w.includes('Missing VERSION')))
  })

  test('SMP with unsupported major version returns error', async () => {
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
    assert(result.errors.some((e) => e.includes('Unsupported major version')))
  })

  test('SMP with compatible minor version is accepted', async () => {
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.1\n' },
      {
        name: 'style.json',
        data: JSON.stringify({
          version: 8,
          sources: {},
          layers: [],
          metadata: {
            'smp:bounds': [-180, -85, 180, 85],
            'smp:maxzoom': 5,
          },
        }),
      },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert.deepEqual(result.errors, [])
  })

  test('SMP with invalid version format returns error', async () => {
    const zipBuf = await createZip([
      { name: 'VERSION', data: 'abc\n' },
      {
        name: 'style.json',
        data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors.some((e) => e.includes('Invalid version format')))
  })

  test('SMP missing smp:bounds returns error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      metadata: {
        'smp:maxzoom': 5,
        'smp:sourceFolders': {},
      },
    }
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors.some((e) => e.includes('smp:bounds')))
  })

  test('SMP missing smp:maxzoom returns error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      metadata: {
        'smp:bounds': [-180, -85, 180, 85],
        'smp:sourceFolders': {},
      },
    }
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors.some((e) => e.includes('smp:maxzoom')))
  })

  test('SMP missing smp:sourceFolders is valid (optional field)', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      metadata: {
        'smp:bounds': [-180, -85, 180, 85],
        'smp:maxzoom': 5,
      },
    }
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert(
      result.errors.every((e) => !e.includes('smp:sourceFolders')),
      'Should not error about missing smp:sourceFolders',
    )
  })

  test('valid SMP created by Writer passes validation', async () => {
    const smpBuf = await createValidSmp()
    const filepath = await temporaryWrite(smpBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, true)
    assert.deepEqual(result.errors, [])
    assert(
      result.warnings.every((w) => !w.includes('Missing VERSION')),
      'Should not warn about VERSION',
    )
  })

  test('SMP with missing tile files for a source returns error', async () => {
    const style = {
      version: 8,
      sources: {
        test: {
          type: 'vector',
          tiles: ['smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz'],
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 5,
        },
      },
      layers: [],
      metadata: {
        'smp:bounds': [-180, -85, 180, 85],
        'smp:maxzoom': 5,
        'smp:sourceFolders': { test: '0' },
      },
    }
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
      // No tile files!
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors.some((e) => e.includes('No tile files found')))
  })

  test('SMP with missing glyph files returns error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      glyphs: 'smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz',
      metadata: {
        'smp:bounds': [-180, -85, 180, 85],
        'smp:maxzoom': 5,
        'smp:sourceFolders': {},
      },
    }
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors.some((e) => e.includes('no glyph files found')))
  })

  test('SMP with missing sprite files returns error', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      sprite: 'smp://maps.v1/sprites/default/sprite',
      metadata: {
        'smp:bounds': [-180, -85, 180, 85],
        'smp:maxzoom': 5,
        'smp:sourceFolders': {},
      },
    }
    const zipBuf = await createZip([
      { name: 'VERSION', data: '1.0\n' },
      { name: 'style.json', data: JSON.stringify(style) },
    ])
    const filepath = await temporaryWrite(zipBuf)
    const result = await validate(filepath)
    assert.equal(result.valid, false)
    assert(result.errors.some((e) => e.includes('Missing sprite file')))
  })

  test('SMP with 1x sprites but no 2x returns warning', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      sprite: 'smp://maps.v1/sprites/default/sprite',
      metadata: {
        'smp:bounds': [-180, -85, 180, 85],
        'smp:maxzoom': 5,
        'smp:sourceFolders': {},
      },
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
    assert(result.warnings.some((w) => w.includes('@2x')))
  })

  test('SMP with array sprites validates each', async () => {
    const style = {
      version: 8,
      sources: {},
      layers: [],
      sprite: [
        { id: 'default', url: 'smp://maps.v1/sprites/default/sprite' },
        { id: 'signs', url: 'smp://maps.v1/sprites/signs/sprite' },
      ],
      metadata: {
        'smp:bounds': [-180, -85, 180, 85],
        'smp:maxzoom': 5,
        'smp:sourceFolders': {},
      },
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
    assert(result.errors.some((e) => e.includes('signs')))
  })

  test('accepts a ZipReader instance', async () => {
    const smpBuf = await createValidSmp()
    const { ZipReader } = await import('@gmaclennan/zip-reader')
    const { BufferSource } =
      await import('@gmaclennan/zip-reader/buffer-source')
    const zipReader = await ZipReader.from(new BufferSource(smpBuf))
    const result = await validate(zipReader)
    assert.equal(result.valid, true)
    assert.deepEqual(result.errors, [])
  })
})
