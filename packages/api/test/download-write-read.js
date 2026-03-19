import { ZipReader } from '@gmaclennan/zip-reader'
import { BufferSource } from '@gmaclennan/zip-reader/buffer-source'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { assert, inject, test } from 'vitest'

import { download } from '../lib/download.js'
import { Reader } from '../lib/reader.js'
import { streamToBuffer } from './utils/stream-consumers.js'

// World bounds in Web Mercator (matches what the tile downloader clips to)
const TEST_MAP_AREA = /** @type {const} */ ([-180, -85.051129, 180, 85.051129])

test('Everything written can be read', { timeout: 30_000 }, async () => {
  const smpServerUrl = inject('smpServerUrl')
  const smpReadStream = download({
    styleUrl: `${smpServerUrl}/style.json`,
    bbox: [...TEST_MAP_AREA],
    maxzoom: 2,
  })
  const smpBuf = await streamToBuffer(smpReadStream)
  const zip = await ZipReader.from(new BufferSource(smpBuf))
  const reader = new Reader(zip)
  const smpStyle = await reader.getStyle()
  assert.deepEqual(validateStyleMin(smpStyle), [], 'Style is valid')
})
