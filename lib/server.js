import createError from 'http-errors'

import { Reader } from './reader.js'
import { isFileNotThereError } from './utils/errors.js'
import { noop } from './utils/misc.js'

/** @import { FastifyPluginCallback, FastifyReply } from 'fastify' */
/** @import { Resource } from './reader.js' */

/**
 * @typedef {object} PluginOptionsFilepath
 * @property {string} filepath Path to styled map package (`.smp`) file
 */
/**
 * @typedef {object} PluginOptionsReader
 * @property {Pick<Reader, keyof Reader>} reader SMP Reader interface (also supports ReaderWatch)
 */
/**
 * @typedef {PluginOptionsFilepath | PluginOptionsReader} PluginOptions
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
 * Fastify plugin for serving a styled map package.
 *
 * If you provide a `Reader` (or `ReaderWatch`) instance via the `reader` opt,
 * you must manually close the instance yourself.
 *
 * @type {FastifyPluginCallback<PluginOptions>}
 */
export function createServer(fastify, opts, done) {
  const reader = 'reader' in opts ? opts.reader : new Reader(opts.filepath)

  // Only close the reader if it was created by this plugin
  if (!('reader' in opts)) {
    fastify.addHook('onClose', () => reader.close().catch(noop))
  }

  fastify.get('/style.json', async () => {
    try {
      const baseUrl = new URL(fastify.prefix, fastify.listeningOrigin)
      const style = await reader.getStyle(baseUrl.href)
      return style
    } catch (error) {
      if (isFileNotThereError(error)) {
        throw createError(404, error.message)
      }
      throw error
    }
  })

  fastify.get('*', async (request, reply) => {
    // @ts-expect-error - not worth the hassle of type casting this
    const path = request.params['*']

    try {
      const resource = await reader.getResource(path)
      return sendResource(reply, resource)
    } catch (error) {
      if (isFileNotThereError(error)) {
        throw createError(404, error.message)
      }
      throw error
    }
  })
  done()
}
