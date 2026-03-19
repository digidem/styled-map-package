/**
 * Web stream equivalents of node:stream/consumers functions.
 * These work in both Node.js and browsers.
 */

/**
 * Collect a web ReadableStream into a Uint8Array.
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {Promise<Uint8Array>}
 */
export async function streamToBuffer(stream) {
  const chunks = []
  const reader = stream.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/**
 * Parse a web ReadableStream as JSON.
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {Promise<any>}
 */
export async function streamToJson(stream) {
  return JSON.parse(new TextDecoder().decode(await streamToBuffer(stream)))
}
