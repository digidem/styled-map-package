import { ZipReader } from '@gmaclennan/zip-reader'
import { BufferSource } from '@gmaclennan/zip-reader/buffer-source'
import { temporaryWrite } from 'tempy'
import { test } from 'vitest'
import { ZipWriter } from 'zip-writer'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'

import { Reader, Writer } from '../lib/index.js'
import { streamToBuffer } from './utils/stream-consumers.js'

const enc = new TextEncoder()

/**
 * Create a zip buffer with given entries using zip-writer.
 * @param {Array<{ name: string, data: string | Uint8Array }>} entries
 * @returns {Promise<Uint8Array>}
 */
async function createZipBuffer(entries) {
  const zw = new ZipWriter()
  const outputPromise = streamToBuffer(
    /** @type {ReadableStream<Uint8Array>} */ (zw.readable),
  )
  for (const { name, data } of entries) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    await zw.addEntry({
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
      name,
    })
  }
  await zw.finalize()
  return outputPromise
}

test('Reader, invalid filepath', async () => {
  const expectedError = { code: 'ENOENT' }
  const reader = new Reader('invalid_file_path')
  await assert.rejects(reader.getStyle(), expectedError)
  // close() resolves without error even when the file couldn't be opened
  await reader.close()
  await assert.rejects(reader.getResource('/style.json'), expectedError)
})

test('Reader, invalid non-zip file', async () => {
  const expectedError = { message: /End of Central Directory Record/ }
  const reader = new Reader(await temporaryWrite(randomBytes(1024)))
  await assert.rejects(reader.getStyle(), expectedError)
  // close() resolves without error even when the file is not a valid zip
  await reader.close()
  await assert.rejects(reader.getResource('/style.json'), expectedError)
})

test('Reader, invalid non-zip file does not leak file descriptors', async () => {
  // Record the next available FD before the test. If no FDs are leaked, we
  // expect to get the same number after close(). Node.js allocates file
  // descriptors sequentially from the lowest available slot on all platforms
  // (via the CRT on Windows, and directly via the kernel on Unix).
  const nullDevice = process.platform === 'win32' ? '\\\\.\\nul' : '/dev/null'
  const fdBefore = openSync(nullDevice, 'r')
  closeSync(fdBefore)

  const reader = new Reader(await temporaryWrite(randomBytes(1024)))
  // Wait for the open attempt to settle (it will fail)
  await reader.opened().catch(() => {})
  await reader.close()

  const fdAfter = openSync(nullDevice, 'r')
  closeSync(fdAfter)

  assert.equal(fdAfter, fdBefore, 'no file descriptors should be leaked')
})

test('Reader.getVersion() returns version from SMP created by Writer', async () => {
  const style = {
    version: 8,
    sources: { test: { type: 'vector' } },
    layers: [{ id: 'bg', type: 'background' }],
  }
  const writer = new Writer(style)
  const smpBufPromise = streamToBuffer(writer.outputStream)
  await writer.addTile(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(1024))
        c.close()
      },
    }),
    {
      x: 0,
      y: 0,
      z: 0,
      sourceId: 'test',
      format: 'mvt',
    },
  )
  writer.finish()
  const smpBuf = await smpBufPromise
  const zip = await ZipReader.from(new BufferSource(smpBuf))
  const reader = new Reader(zip)
  const version = await reader.getVersion()
  assert.equal(version, '1.0')
  await reader.close()
})

test('Reader.getVersion() returns "1.0" for SMP without VERSION file', async () => {
  const zipBuffer = await createZipBuffer([
    {
      name: 'style.json',
      data: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    },
  ])
  const zip = await ZipReader.from(new BufferSource(zipBuffer))
  const reader = new Reader(zip)
  const version = await reader.getVersion()
  assert.equal(version, '1.0')
  await reader.close()
})

test('Reader, invalid smp file', async () => {
  const zipBuffer = await createZipBuffer([
    { name: 'file2.txt', data: 'string cheese!' },
  ])
  // check zip file is valid and contains the expected entry
  const zipReader = await ZipReader.from(new BufferSource(zipBuffer))
  const entries = []
  for await (const entry of zipReader) {
    entries.push(entry)
  }
  assert(entries.find((entry) => entry.name === 'file2.txt'))
  // now test Reader with a fresh ZipReader over the same buffer
  const zip = await ZipReader.from(new BufferSource(zipBuffer))
  const expectedError = { code: 'ENOENT' }
  const reader = new Reader(zip)
  await assert.rejects(reader.getStyle(), expectedError)
  await assert.rejects(reader.getResource('/style.json'), expectedError)
  // closes without error
  await reader.close()
})
