import archiver from 'archiver'
import { temporaryWrite } from 'tempy'
import { fromBuffer } from 'yauzl-promise'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { buffer } from 'node:stream/consumers'
import { test } from 'node:test'

import { Reader } from '../lib/index.js'

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
  // expect to get the same number after close().
  const fdBefore = openSync('/dev/null', 'r')
  closeSync(fdBefore)

  const reader = new Reader(await temporaryWrite(randomBytes(1024)))
  // Wait for the open attempt to settle (it will fail)
  await reader.opened().catch(() => {})
  await reader.close()

  const fdAfter = openSync('/dev/null', 'r')
  closeSync(fdAfter)

  assert.equal(fdAfter, fdBefore, 'no file descriptors should be leaked')
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
