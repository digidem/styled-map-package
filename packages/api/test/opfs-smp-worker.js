/* global self */
/// <reference lib="webworker" />
import { fromMBTiles } from '../lib/from-mbtiles.js'

const OPFS_FILENAME = 'test.mbtiles'

self.onmessage = async (event) => {
  try {
    const { type, buffer } = event.data
    switch (type) {
      case 'convert': {
        await copyToOpfs(buffer, OPFS_FILENAME)
        const smpBuffer = await streamToArrayBuffer(fromMBTiles(OPFS_FILENAME))
        await removeFromOpfs(OPFS_FILENAME)
        self.postMessage({ type: 'result', buffer: smpBuffer }, [smpBuffer])
        break
      }
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: /** @type {Error} */ (error)?.message,
    })
  }
}

/**
 * Collect a ReadableStream into an ArrayBuffer.
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {Promise<ArrayBuffer>}
 */
async function streamToArrayBuffer(stream) {
  const reader = stream.getReader()
  const chunks = []
  let totalLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLength += value.byteLength
  }
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result.buffer
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 */
async function copyToOpfs(buffer, filename) {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(filename).catch(() => {})
  const fileHandle = await root.getFileHandle(filename, { create: true })
  const accessHandle = await fileHandle.createSyncAccessHandle()
  try {
    accessHandle.write(new Uint8Array(buffer), { at: 0 })
  } finally {
    accessHandle.flush()
    accessHandle.close()
  }
}

/**
 * @param {string} filename
 */
async function removeFromOpfs(filename) {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(filename).catch(() => {})
}
