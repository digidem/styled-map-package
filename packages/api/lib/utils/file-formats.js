import { hasOwn } from './misc.js'

const MAGIC_BYTES = /** @type {const} */ ({
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
  // eslint-disable-next-line no-sparse-arrays
  webp: [0x52, 0x49, 0x46, 0x46, , , , , 0x57, 0x45, 0x42, 0x50],
  // Include the compression-type byte, which is always 0x08 (DEFLATE) for gzip
  gz: [0x1f, 0x8b, 0x08],
})

const MIME_TYPES = /** @type {const} */ ({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
})

/** @type {Map<number, keyof typeof MAGIC_BYTES>} */
const magicByteMap = new Map()
for (const [ext, bytes] of Object.entries(MAGIC_BYTES)) {
  magicByteMap.set(
    bytes[0],
    // @ts-ignore
    ext,
  )
}
/**
 * For a given buffer, determine the tile format based on the magic bytes.
 * Will throw for unknown file types.
 * Smaller and faster version of magic-bytes.js due to the limited use case.
 *
 * @param {Buffer | Uint8Array} buf
 * @returns {import("../writer.js").TileFormat}
 */
export function getTileFormatFromBuffer(buf) {
  const ext = magicByteMap.get(buf[0])
  if (!ext) {
    throw new Error('Unknown file type')
  }
  const sig = MAGIC_BYTES[ext]
  for (let i = 1; i < sig.length; i++) {
    if (typeof sig[i] !== 'undefined' && sig[i] !== buf[i]) {
      throw new Error('Unknown file type')
    }
  }
  if (ext === 'gz') {
    // Gzipped tiles are always MVT
    return 'mvt'
  }
  return ext
}

/**
 * Determine the tile format from a readable stream from the magic bytes at the
 * start of the file. Used if data is served without a content-type header.
 * Returns the format and a new readable stream that includes all original data.
 *
 * @param {ReadableStream<Uint8Array>} tileData Web ReadableStream
 * @returns {Promise<[import("../writer.js").TileFormat, ReadableStream<Uint8Array>]>}
 */
export async function getTileFormatFromStream(tileData) {
  const [stream1, stream2] = tileData.tee()

  // Read enough bytes to detect the format from the first branch
  // 12 bytes is enough for all magic byte signatures (WEBP needs 12)
  const reader = stream1.getReader()
  let buffer = new Uint8Array(0)
  while (buffer.length < 12) {
    const { done, value } = await reader.read()
    if (done) break
    const newBuffer = new Uint8Array(buffer.length + value.length)
    newBuffer.set(buffer)
    newBuffer.set(value, buffer.length)
    buffer = newBuffer
  }
  reader.cancel()

  const format = getTileFormatFromBuffer(buffer)
  return [format, stream2]
}

/**
 * Get the tile format from a MIME type. Throws for unsupported types.
 *
 * @param {string} mimeType
 * @returns {import("../writer.js").TileFormat}
 */
export function getFormatFromMimeType(mimeType) {
  if (mimeType.startsWith('application/')) return 'mvt'
  if (hasOwn(MIME_TYPES, mimeType)) return MIME_TYPES[mimeType]
  throw new Error('Unsupported MIME type ' + mimeType)
}
