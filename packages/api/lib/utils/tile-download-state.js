/** @import { TileDownloadStats, TileDownloadGenerator } from '../tile-downloader.js' */
/**
 * Attach the live `skipped`/`stats` accessors to a tile-download generator.
 * Delegating rather than mutating the generator keeps the result checkable: the
 * returned literal is verified against `TileDownloadGenerator`, where
 * `Object.defineProperty` would have needed an unchecked assertion.
 *
 * @template {object} T
 * @param {AsyncGenerator<[ReadableStream<Uint8Array>, T]>} generator
 * @param {object} state
 * @param {() => Array<T & { error?: Error }>} state.skipped
 * @param {() => TileDownloadStats} state.stats
 * @returns {TileDownloadGenerator<T>}
 */
export function withDownloadState(generator, state) {
  return {
    next: (...args) => generator.next(...args),
    return: (...args) => generator.return(...args),
    throw: (...args) => generator.throw(...args),
    [Symbol.asyncIterator]() {
      return this
    },
    get skipped() {
      return state.skipped()
    },
    get stats() {
      return state.stats()
    },
  }
}
