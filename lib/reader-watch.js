import { once } from 'events'

import fs from 'node:fs'
import fsPromises from 'node:fs/promises'

import { Reader } from './reader.js'
import { ENOENT, isFileNotThereError } from './utils/errors.js'
import { noop } from './utils/misc.js'

/** @implements {Pick<Reader, keyof Reader>} */
export class ReaderWatch {
  /** @type {Reader | undefined} */
  #reader
  /** @type {Reader | undefined} */
  #maybeReader
  /** @type {Promise<Reader> | undefined} */
  #readerOpeningPromise
  #filepath
  /** @type {fs.FSWatcher | undefined} */
  #watch

  /**
   * @param {string} filepath
   */
  constructor(filepath) {
    this.#filepath = filepath
    // Call this now to catch any synchronous errors
    this.#tryToWatchFile()
    // eagerly open Reader
    this.#get().catch(noop)
  }

  #tryToWatchFile() {
    if (this.#watch) return
    try {
      this.#watch = fs
        .watch(this.#filepath, { persistent: false }, () => {
          this.#reader?.close().catch(noop)
          this.#reader = undefined
          this.#maybeReader = undefined
          this.#readerOpeningPromise = undefined
          // Close the watcher (which on some platforms will continue watching
          // the previous file) so on the next request we will start watching
          // the new file
          this.#watch?.close()
          this.#watch = undefined
        })
        .on('error', noop)
    } catch (error) {
      if (isFileNotThereError(error)) {
        // Ignore: File does not exist yet, but we'll try to open it later
      } else {
        throw error
      }
    }
  }

  async #get() {
    if (isWin() && (this.#reader || this.#readerOpeningPromise)) {
      // On Windows, the file watcher does not recognize file deletions, so we
      // need to check if the file still exists each time
      try {
        await fsPromises.stat(this.#filepath)
      } catch {
        this.#watch?.close()
        this.#watch = undefined
        this.#reader?.close().catch(noop)
        this.#reader = undefined
        this.#maybeReader = undefined
        this.#readerOpeningPromise = undefined
      }
    }
    // Need to retry this each time in case it failed initially because the file
    // was not present, or if the file was moved or deleted.
    this.#tryToWatchFile()
    // A lovely promise tangle to confuse future readers... sorry.
    //
    // 1. If the reader is already open, return it.
    // 2. If the reader is in the process of opening, return a promise that will
    //    return the reader instance if it opened without error, or throw.
    // 3. If the reader threw an error during opening, try to open it again next
    //    time this is called.
    if (this.#reader) return this.#reader
    if (this.#readerOpeningPromise) return this.#readerOpeningPromise
    this.#maybeReader = new Reader(this.#filepath)
    this.#readerOpeningPromise = this.#maybeReader
      .opened()
      .then(() => {
        if (!this.#maybeReader) {
          throw new ENOENT(this.#filepath)
        }
        this.#reader = this.#maybeReader
        return this.#reader
      })
      .finally(() => {
        this.#maybeReader = undefined
        this.#readerOpeningPromise = undefined
      })
    return this.#readerOpeningPromise
  }

  /** @type {Reader['opened']} */
  async opened() {
    const reader = await this.#get()
    return reader.opened()
  }

  /** @type {Reader['getStyle']} */
  async getStyle(baseUrl = null) {
    const reader = await this.#get()
    return reader.getStyle(baseUrl)
  }

  /** @type {Reader['getResource']} */
  async getResource(path) {
    const reader = await this.#get()
    return reader.getResource(path)
  }

  async close() {
    const reader = await this.#get()
    if (this.#watch) {
      this.#watch.close()
      await once(this.#watch, 'close')
    }
    await reader.close()
  }
}

/** @returns {boolean} */
function isWin() {
  return process.platform === 'win32'
}
