import { validateStyleMin, migrate } from '@maplibre/maplibre-gl-style-spec'
import tempDir from 'temp-dir'

import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import test from 'node:test'

import { download, Reader, StyleDownloader } from '../lib/index.js'

const TEST_MAP_STYLE = 'https://demotiles.maplibre.org/style.json'
const TEST_MAP_AREA = /** @type {const} */ ([5.956, 45.818, 10.492, 47.808]) // Switzerland

/** @param {import('node:test').TestContext} t */
function tempFile(t) {
  const temporaryPath = path.join(tempDir, randomBytes(16).toString('hex'))
  t.after(async () => {
    await fsPromises.rm(temporaryPath, {
      recursive: true,
      force: true,
      maxRetries: 2,
    })
  })
  return temporaryPath
}

test('Everything written can be read', async (t) => {
  const smpFilePath = tempFile(t)
  const smpReadStream = download({
    styleUrl: TEST_MAP_STYLE,
    bbox: [...TEST_MAP_AREA],
    maxzoom: 10,
  })
  await pipeline(smpReadStream, fs.createWriteStream(smpFilePath))

  const reader = new Reader(smpFilePath)
  const upstream = new StyleDownloader(TEST_MAP_STYLE)

  const smpStyle = await reader.getStyle()
  assert.deepEqual(validateStyleMin(smpStyle), [], 'Style is valid')

  const upstreamStyle = migrate(await upstream.getStyle())

  assert.deepStrictEqual(smpStyle, upstreamStyle)
})
