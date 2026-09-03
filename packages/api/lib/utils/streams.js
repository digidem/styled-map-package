/**
 * Create a ReadableStream from an async iterable. Uses the native
 * `ReadableStream.from()` when available, otherwise falls back to a manual
 * approach: Chromium does not implement it.
 *
 * @template T
 * @param {AsyncIterable<T>} iterable
 * @returns {ReadableStream<T>}
 */
export function readableFromAsync(iterable) {
  // @ts-ignore - ReadableStream.from() is missing from the DOM types
  if (typeof ReadableStream.from === 'function') {
    // @ts-ignore
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
  /** @type {{ reason: unknown } | undefined} */
  let failure
  return new WritableStream(
    {
      write(chunk) {
        if (failure) return Promise.reject(failure.reason)
        const p = fn(...chunk)
        pending.add(p)
        // A rejected promise is removed from `pending` as soon as it settles,
        // so the failure must be remembered here or `close()` never sees it.
        // `.then(del, onError)` rather than `.finally(del)`: finally forwards
        // the rejection to a derived promise nobody handles, which crashes Node.
        const del = () => pending.delete(p)
        p.then(del, (reason) => {
          failure ??= { reason }
          del()
        })
        if (pending.size >= concurrency) {
          return Promise.race(pending)
        }
      },
      async close() {
        await Promise.all(pending)
        if (failure) throw failure.reason
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
