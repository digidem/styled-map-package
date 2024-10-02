import { Readable, Writable, Transform } from 'readable-stream'

/** @import { TransformOptions } from 'readable-stream' */

/**
 * Create a writable stream from an async function. Default concurrecy is 16 -
 * this is the number of parallel functions that will be pending before
 * backpressure is applied on the stream.
 *
 * @template {(...args: any[]) => Promise<void>} T
 * @param {T} fn
 * @returns {import('readable-stream').Writable}
 */
export function writeStreamFromAsync(fn, { concurrency = 16 } = {}) {
  return new Writable({
    highWaterMark: concurrency,
    objectMode: true,
    write(chunk, encoding, callback) {
      fn.apply(null, chunk).then(() => callback(), callback)
    },
  })
}

/**
 * From https://github.com/nodejs/node/blob/430c0269/lib/internal/webstreams/adapters.js#L509
 *
 * @param {ReadableStream} readableStream
 * @param {{
 *   highWaterMark? : number,
 *   encoding? : string,
 *   objectMode? : boolean,
 *   signal? : AbortSignal,
 * }} [options]
 * @returns {import('stream').Readable}
 */

export function fromWebReadableStream(readableStream, options = {}) {
  if (!isWebReadableStream(readableStream)) {
    throw new Error('First argument must be a ReadableStream')
  }

  const { highWaterMark, encoding, objectMode = false, signal } = options

  if (encoding !== undefined && !Buffer.isEncoding(encoding))
    throw new Error('Invalid encoding')

  const reader = readableStream.getReader()
  let closed = false

  const readable = new Readable({
    objectMode,
    highWaterMark,
    encoding,
    // @ts-ignore
    signal,

    read() {
      reader.read().then(
        (chunk) => {
          if (chunk.done) {
            // Value should always be undefined here.
            readable.push(null)
          } else {
            readable.push(chunk.value)
          }
        },
        (error) => readable.destroy(error),
      )
    },

    destroy(error, callback) {
      function done() {
        try {
          callback(error)
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => {
            throw error
          })
        }
      }

      if (!closed) {
        reader.cancel(error).then(done, done)
        return
      }
      done()
    },
  })

  reader.closed.then(
    () => {
      closed = true
    },
    (error) => {
      closed = true
      readable.destroy(error)
    },
  )

  return readable
}

/**
 * @param {unknown} obj
 * @returns {obj is ReadableStream}
 */
export function isWebReadableStream(obj) {
  return !!(
    typeof obj === 'object' &&
    obj !== null &&
    'pipeThrough' in obj &&
    typeof obj.pipeThrough === 'function' &&
    'getReader' in obj &&
    typeof obj.getReader === 'function' &&
    'cancel' in obj &&
    typeof obj.cancel === 'function'
  )
}

/** @typedef {(opts: { totalBytes: number, chunkBytes: number }) => void} ProgressCallback */
/** @typedef {TransformOptions & { onprogress?: ProgressCallback }} ProgressStreamOptions */

/**
 * Passthrough stream that counts the bytes passing through it. Pass an optional
 * `onprogress` callback that will be called with the accumulated total byte
 * count and the chunk byte count after each chunk.
 * @extends {Transform}
 */
export class ProgressStream extends Transform {
  #onprogress
  #byteLength = 0

  /**
   * @param {ProgressStreamOptions} [opts]
   */
  constructor({ onprogress, ...opts } = {}) {
    super(opts)
    this.#onprogress = onprogress
  }

  /** Total bytes that have passed through this stream */
  get byteLength() {
    return this.#byteLength
  }

  /**
   * @override
   * @param {Buffer | Uint8Array} chunk
   * @param {Parameters<Transform['_transform']>[1]} encoding
   * @param {Parameters<Transform['_transform']>[2]} callback
   */
  _transform(chunk, encoding, callback) {
    this.#byteLength += chunk.length
    this.#onprogress?.({
      totalBytes: this.#byteLength,
      chunkBytes: chunk.length,
    })
    callback(null, chunk)
  }
}
