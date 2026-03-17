/**
 * A web TransformStream that calculates a SHA-256 digest of the data passing
 * through it. Uses the Web Crypto API so it works in both Node.js 18+ and
 * browsers. Implements ReadableWritablePair for use with pipeThrough().
 */
export class DigestStream {
  #transform
  /** @type {Promise<string>} */
  #digestPromise

  constructor() {
    const chunks = /** @type {Uint8Array[]} */ ([])
    /** @type {(hex: string) => void} */
    let resolve
    this.#digestPromise = new Promise((r) => {
      resolve = r
    })
    let crypto = globalThis.crypto
    this.#transform = new TransformStream({
      async start() {
        // For node 18 support
        if (!crypto) {
          // @ts-ignore
          crypto = (await import('crypto')).webcrypto
        }
      },
      /**
       * @param {Uint8Array} chunk
       * @param {TransformStreamDefaultController} controller
       */
      transform(chunk, controller) {
        chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
        controller.enqueue(chunk)
      },
      flush: async () => {
        const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0)
        const buf = new Uint8Array(totalLen)
        let off = 0
        for (const chunk of chunks) {
          buf.set(chunk, off)
          off += chunk.byteLength
        }
        const hashBuf = await crypto.subtle.digest('SHA-256', buf)
        const hex = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        resolve(hex)
      },
    })
  }

  get readable() {
    return this.#transform.readable
  }

  get writable() {
    return this.#transform.writable
  }

  /**
   * Returns the hex digest of all data passed through the stream.
   * Must be called after the stream has been fully consumed (i.e. after the
   * pipeline has settled).
   *
   * @returns {Promise<string>}
   */
  digest() {
    return this.#digestPromise
  }
}
