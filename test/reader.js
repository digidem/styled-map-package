import archiver from 'archiver'
import { fromBuffer } from 'yauzl-promise'

import assert from 'node:assert/strict'
import { buffer } from 'node:stream/consumers'
import { test } from 'node:test'

import { Reader } from '../lib/index.js'

test('Reader, invalid filepath', async () => {
  const expectedError = { code: 'ENOENT' }
  const reader = new Reader('invalid_file_path')
  await assert.rejects(reader.getStyle(), expectedError)
  await assert.rejects(reader.close(), expectedError)
  await assert.rejects(reader.getResource('/style.json'), expectedError)
})

test('Reader, invalid non-zip file', async () => {
  const expectedError = { message: /End of Central Directory Record/ }
  const reader = new Reader('/dev/null')
  await assert.rejects(reader.getStyle(), expectedError)
  await assert.rejects(reader.close(), expectedError)
  await assert.rejects(reader.getResource('/style.json'), expectedError)
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
