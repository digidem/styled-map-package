import createError from 'http-errors'

import Reader from './reader.js'
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
      const reader = await deferredReader.get()
      await reader.close()
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
  /** @type {Promise<Reader> | undefined} */
  #readerOpeningPromise
  #filepath

  /**
   * @param {string} filepath
   */
  constructor(filepath) {
    this.#filepath = filepath
    this.get().catch(noop)
  }

  async get() {
    // A lovely promise tangle to confuse future readers... sorry.
    //
    // 1. If the reader is already open, return it.
    // 2. If the reader is in the process of opening, return a promise that will
    //    return the reader instance if it opened without error, or throw.
    // 3. If the reader threw an error during opening, try to open it again next
    //    time this is called.
    if (this.#reader) return this.#reader
    if (this.#readerOpeningPromise) return this.#readerOpeningPromise
    const maybeReader = new Reader(this.#filepath)
    this.#readerOpeningPromise = maybeReader
      .opened()
      .then(() => {
        this.#reader = maybeReader
        return this.#reader
      })
      .finally(() => {
        this.#readerOpeningPromise = undefined
      })
    return this.#readerOpeningPromise
  }
}
