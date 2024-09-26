import { createHash } from 'node:crypto'
import { Transform } from 'node:stream'

/**
 * A passthrough stream that calculates a digest of the data passing through it.
 */
export class DigestStream extends Transform {
  #hash
  /** @param {string} algorithm */
  constructor(algorithm) {
    super()
    this.#hash = createHash(algorithm)
  }
  /**
   * @param {*} chunk
   * @param {BufferEncoding} encoding
   * @param {import('node:stream').TransformCallback} callback
   */
  _transform(chunk, encoding, callback) {
    this.#hash.update(chunk)
    callback(null, chunk)
  }
  /**
   * Calculates the digest of all of the data passed through the stream. If
   * encoding is provided a string will be returned; otherwise a Buffer is
   * returned.
   *
   * The stream can not be used again after the `digest()` method has been
   * called. Multiple calls will cause an error to be thrown.
   *
   * @param {import('node:crypto').BinaryToTextEncoding} [encoding]
   */
  digest(encoding = 'binary') {
    return this.#hash.digest(encoding)
  }
}
