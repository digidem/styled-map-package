import { ZipReader } from '@gmaclennan/zip-reader'
import { BufferSource } from '@gmaclennan/zip-reader/buffer-source'
import { MBTiles } from 'mbtiles-reader'
import { describe, expect, test } from 'vitest'

import { fromMBTiles } from '../lib/from-mbtiles.js'
import { Reader } from '../lib/reader.js'
import { streamToBuffer } from './utils/stream-consumers.js'

const isNode = typeof window === 'undefined'

/**
 * Fetch the plain_1.mbtiles fixture as an ArrayBuffer, cross-platform.
 * @returns {Promise<ArrayBuffer>}
 */
async function getFixtureBuffer() {
  if (isNode) {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = fileURLToPath(
      new URL('./fixtures/plain_1.mbtiles', import.meta.url),
    )
    const buf = readFileSync(path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  const res = await fetch('/test/fixtures/plain_1.mbtiles')
  if (!res.ok) throw new Error('Failed to fetch fixture')
  return res.arrayBuffer()
}

/**
 * @param {string} template
 * @param {Record<string, string | number>} variables
 * @returns {string}
 */
function replaceVariables(template, variables) {
  return template.replace(/{(.*?)}/g, (match, varName) => {
    return varName in variables ? String(variables[varName]) : match
  })
}

/**
 * Verify that SMP buffer produced by fromMBTiles contains correct tiles.
 *
 * @param {Uint8Array} smpBuffer
 * @param {MBTiles} mbtiles
 */
async function verifySmp(smpBuffer, mbtiles) {
  const reader = new Reader(await ZipReader.from(new BufferSource(smpBuffer)))
  const style = await reader.getStyle('')
  const sourceMetadata = Object.values(style.sources)[0]
  expect(sourceMetadata.type).toBe('raster')
  const tileUrl = /** @type {string[]} */ (
    /** @type {any} */ (sourceMetadata).tiles
  )[0]

  let tileCount = 0
  for (const { x, y, z, data } of mbtiles) {
    tileCount++
    const path = replaceVariables(tileUrl, { x, y, z })
    const smpTile = await reader.getResource(path)
    const tileData = await streamToBuffer(smpTile.stream)
    expect(tileData).toEqual(data)
    expect(smpTile.contentType).toBe('image/png')
  }
  expect(tileCount).toBeGreaterThan(10)
}

test('convert from MBTiles with buffer', { timeout: 30_000 }, async () => {
  const fixtureBuffer = await getFixtureBuffer()

  const smpBuffer = await streamToBuffer(
    fromMBTiles(new Uint8Array(fixtureBuffer)),
  )

  const mbtiles = await MBTiles.open(new Uint8Array(fixtureBuffer))
  await verifySmp(smpBuffer, mbtiles)
  mbtiles.close()
})

test('style has correct source and root properties', async () => {
  const fixtureBuffer = await getFixtureBuffer()
  const smpBuffer = await streamToBuffer(
    fromMBTiles(new Uint8Array(fixtureBuffer)),
  )
  const reader = new Reader(await ZipReader.from(new BufferSource(smpBuffer)))
  const style = await reader.getStyle('')
  const source = Object.values(style.sources)[0]

  // tileSize must be 256 (MBTiles standard tile size, not MapLibre default of 512)
  expect(source.tileSize).toBe(256)

  // Valid source properties should be present
  expect(source.type).toBe('raster')
  expect(source.minzoom).toBe(0)
  expect(source.maxzoom).toBe(4)
  expect(source.scheme).toBe('xyz')

  // Non-source properties from MBTiles metadata should not leak into the source
  expect(source).not.toHaveProperty('name')
  expect(source).not.toHaveProperty('format')
  expect(source).not.toHaveProperty('description')
  expect(source).not.toHaveProperty('version')
  expect(source).not.toHaveProperty('center')

  // MBTiles description and version are preserved in style.metadata
  expect(style.metadata['mbtiles:description']).toBe('demo description')
  expect(style.metadata['mbtiles:version']).toBe('1.0.3')
})

test('parallel conversions from same buffer', { timeout: 30_000 }, async () => {
  const fixtureBuffer = await getFixtureBuffer()

  const [smpBuffer1, smpBuffer2] = await Promise.all([
    streamToBuffer(fromMBTiles(new Uint8Array(fixtureBuffer))),
    streamToBuffer(fromMBTiles(new Uint8Array(fixtureBuffer))),
  ])

  const mbtiles = await MBTiles.open(new Uint8Array(fixtureBuffer))
  await verifySmp(smpBuffer1, mbtiles)
  mbtiles.close()

  const mbtiles2 = await MBTiles.open(new Uint8Array(fixtureBuffer))
  await verifySmp(smpBuffer2, mbtiles2)
  mbtiles2.close()
})

// Browser-specific tests are guarded behind a dynamic import-style check
// to avoid referencing browser globals (navigator, Worker) in Node.
if (!isNode) {
  /**
   * @param {Worker} worker
   * @param {any} message
   * @param {Transferable[]} [transfer]
   * @returns {Promise<any>}
   */
  function workerRpc(worker, message, transfer = []) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Worker timeout')),
        30000,
      )
      worker.onmessage = (event) => {
        clearTimeout(timeout)
        if (event.data.type === 'error') {
          reject(new Error(event.data.message))
        } else {
          resolve(event.data)
        }
      }
      worker.onerror = (error) => {
        clearTimeout(timeout)
        reject(error)
      }
      worker.postMessage(message, transfer)
    })
  }

  // OPFS requires a Worker context. Playwright WebKit uses ephemeral
  // contexts that do not support OPFS.
  const isSafariWebKit =
    /AppleWebKit/.test(navigator.userAgent) &&
    !/Chrome/.test(navigator.userAgent)

  describe('OPFS worker', () => {
    test.skipIf(isSafariWebKit)(
      'convert from MBTiles via OPFS worker',
      async () => {
        const worker = new globalThis.Worker(
          new URL('./opfs-smp-worker.js', import.meta.url),
          { type: 'module' },
        )
        try {
          const fixtureBuffer = await getFixtureBuffer()

          const result = await workerRpc(
            worker,
            { type: 'convert', buffer: fixtureBuffer },
            [fixtureBuffer],
          )
          expect(result.type).toBe('result')
          expect(result.buffer).toBeInstanceOf(ArrayBuffer)

          const smpBuffer = new Uint8Array(result.buffer)
          const mbtiles = await MBTiles.open(await getFixtureBuffer())
          await verifySmp(smpBuffer, mbtiles)
          mbtiles.close()
        } finally {
          worker.terminate()
        }
      },
    )
  })
}
