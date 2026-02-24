import archiver from 'archiver'
import randomStream from 'random-bytes-readable-stream'
import { temporaryWrite } from 'tempy'
import { test } from 'vitest'
import { fromBuffer } from 'yauzl-promise'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { buffer, buffer as streamToBuffer } from 'node:stream/consumers'

import { Reader, Writer } from '../lib/index.js'

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
  await writer.addTile(randomStream({ size: 1024 }), {
    x: 0,
    y: 0,
    z: 0,
    sourceId: 'test',
    format: 'mvt',
  })
  writer.finish()
  const smpBuf = await streamToBuffer(writer.outputStream)
  const zip = await fromBuffer(smpBuf)
  const reader = new Reader(zip)
  const version = await reader.getVersion()
  assert.equal(version, '1.0')
  await reader.close()
})

test('Reader.getVersion() returns null for SMP without VERSION file', async () => {
  const archive = archiver('zip')
  archive.append(JSON.stringify({ version: 8, sources: {}, layers: [] }), {
    name: 'style.json',
  })
  archive.finalize()
  const zipBuffer = await buffer(archive)
  const zip = await fromBuffer(zipBuffer)
  const reader = new Reader(zip)
  const version = await reader.getVersion()
  assert.equal(version, null)
  await reader.close()
})

test('Reader, invalid smp file', async () => {
  const archive = archiver('zip')
  archive.append('string cheese!', { name: 'file2.txt' })
  archive.finalize()
  const zipBuffer = await buffer(archive)
  const zip = await fromBuffer(zipBuffer)
  // check zip file is valid
  const entries = await zip.readEntries()
  assert(entries.find((entry) => entry.filename === 'file2.txt'))
  const expectedError = { code: 'ENOENT' }
  const reader = new Reader(zip)
  await assert.rejects(reader.getStyle(), expectedError)
  await assert.rejects(reader.getResource('/style.json'), expectedError)
  // closes without error
  await reader.close()
})
