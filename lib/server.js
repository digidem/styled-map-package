import { once } from 'events'
import createError from 'http-errors'

import fs from 'node:fs'
import fsPromises from 'node:fs/promises'

import Reader from './reader.js'
import { ENOENT } from './utils/errors.js'
import { noop } from './utils/misc.js'

/** @import { FastifyPluginCallback, FastifyReply } from 'fastify' */
/** @import { Resource } from './reader.js' */

/**
 * @typedef {object} PluginOptions
 * @property {string} [prefix]
 * @property {string} filepath Path to styled map package (`.smp`) file
 */

/**
 * @param {FastifyReply} reply
 * @param {Resource} resource
 * @returns {FastifyReply} reply
 */
function sendResource(reply, resource) {
  reply
    .type(resource.contentType)
    .header('content-length', resource.contentLength)
  if (resource.contentEncoding) {
    reply.header('content-encoding', resource.contentEncoding)
  }
  return reply.send(resource.stream)
}

/**
 * Fastify plugin for serving a styled map package. User `lazy: true` to defer
 * opening the file until the first request.
 *
 * @type {FastifyPluginCallback<PluginOptions>}
 */
export default function (fastify, { filepath }, done) {
  const deferredReader = new DeferredReader(filepath)

  fastify.addHook('onClose', async () => {
    try {
      await deferredReader.close()
    } catch {
      // ignore
    }
  })

  fastify.get('/style.json', async () => {
    try {
      const reader = await deferredReader.get()
      const baseUrl = new URL(fastify.prefix, fastify.listeningOrigin)
      return reader.getStyle(baseUrl.href)
    } catch (error) {
      if (isENOENT(error)) {
        throw createError(404, error.message)
      }
      console.error(error)
      throw error
    }
  })

  fastify.get('*', async (request, reply) => {
    // @ts-expect-error - not worth the hassle of type casting this
    const path = request.params['*']

    try {
      const reader = await deferredReader.get()
      const resource = await reader.getResource(path)
      return sendResource(reply, resource)
    } catch (error) {
      if (isENOENT(error)) {
        throw createError(404, error.message)
      }
      console.error(error)
      throw error
    }
  })
  done()
}

/**
 * @param {unknown} error
 * @returns {error is Error & { code: 'ENOENT' }}
 */
function isENOENT(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

class DeferredReader {
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
    this.get().catch(noop)
  }

  #tryToWatchFile() {
    if (this.#watch) return
    try {
      this.#watch = fs
        .watch(this.#filepath, { persistent: false }, (eventType) => {
          console.log('File event:', eventType, !!this.#reader)
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
        .on('error', (error) => {
          console.log('Error event watching file:', error)
        })
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'EPERM')
      ) {
        // Ignore: File does not exist yet, but we'll try to open it later
      } else {
        throw error
      }
    }
  }

  async get() {
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

  async close() {
    const reader = await this.get()
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
