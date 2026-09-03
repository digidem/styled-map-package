import { describe, test } from 'vitest'

import assert from 'node:assert/strict'

import { Writer } from '../lib/writer.js'
import { streamToBuffer } from './utils/stream-consumers.js'

describe('Writer.abort()', () => {
  test('abort propagates error to outputStream consumers', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const writer = new Writer(style)
    const smpPromise = streamToBuffer(writer.outputStream)

    // Add a tile so the writer has started producing output
    await writer.addTile(new Uint8Array(1024), {
      z: 0,
      x: 0,
      y: 0,
      sourceId: 'test',
      format: 'mvt',
    })

    // Abort mid-write
    const abortError = new Error('intentional abort')
    writer.abort(abortError)

    await assert.rejects(smpPromise, (/** @type {any} */ err) => {
      assert.equal(err.message, 'intentional abort')
      return true
    })
  })

  test('abort before any writes propagates error', async () => {
    const style = {
      version: 8,
      sources: { test: { type: 'vector' } },
      layers: [{ id: 'bg', type: 'background' }],
    }
    const writer = new Writer(style)
    const smpPromise = streamToBuffer(writer.outputStream)

    writer.abort(new Error('early abort'))

    await assert.rejects(smpPromise, { message: 'early abort' })
  })
})
