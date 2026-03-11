/**
 * Create a ReadableStream from an async iterable. Uses the native
 * `ReadableStream.from()` when available (Node 20+), otherwise falls back to a
 * manual approach for Node 18 compatibility.
 *
 * @template T
 * @param {AsyncIterable<T>} iterable
 * @returns {ReadableStream<T>}
 */
export function readableFromAsync(iterable) {
  // @ts-expect-error - types are from node 18
  if (typeof ReadableStream.from === 'function') {
    // @ts-expect-error - types are from node 18
    return ReadableStream.from(iterable)
  }
  const iterator = iterable[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next()
      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    },
    async cancel(reason) {
      await iterator.return?.(reason)
    },
  })
}

/**
 * Create a writable stream from an async function. Default concurrency is 16 -
 * this is the number of parallel functions that will be pending before
 * backpressure is applied on the stream.
 *
 * @template {(...args: any[]) => Promise<void>} T
 * @param {T} fn
 * @returns {WritableStream}
 */
export function writeStreamFromAsync(fn, { concurrency = 16 } = {}) {
  const pending = new Set()
  return new WritableStream(
    {
      write(chunk) {
        const p = fn(...chunk)
        pending.add(p)
        p.finally(() => pending.delete(p))
        if (pending.size >= concurrency) {
          return Promise.race(pending)
        }
      },
      async close() {
        await Promise.all(pending)
      },
    },
    new CountQueuingStrategy({ highWaterMark: concurrency }),
  )
}

/** @typedef {(opts: { totalBytes: number, chunkBytes: number }) => void} ProgressCallback */

/**
 * A web TransformStream that counts the bytes passing through it. Pass an
 * optional `onprogress` callback that will be called with the accumulated
 * total byte count and the chunk byte count after each chunk.
 */
export class ProgressStream {
  #byteLength = 0
  #ts

  /**
   * @param {{ onprogress?: ProgressCallback }} [opts]
   */
  constructor({ onprogress } = {}) {
    const self = this
    this.#ts = new TransformStream({
      transform(chunk, controller) {
        self.#byteLength += chunk.byteLength
        onprogress?.({
          totalBytes: self.#byteLength,
          chunkBytes: chunk.byteLength,
        })
        controller.enqueue(chunk)
      },
    })
  }

  get readable() {
    return this.#ts.readable
  }

  get writable() {
    return this.#ts.writable
  }

  /** Total bytes that have passed through this stream */
  get byteLength() {
    return this.#byteLength
  }
}
