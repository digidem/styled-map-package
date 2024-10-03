import Reader from './reader.js'

/** @import { FastifyPluginCallback, FastifyReply } from 'fastify' */
/** @import { Resource } from './reader.js' */

/**
 * @typedef {object} PluginOptions
 * @property {boolean} [lazy=false]
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
export default function (fastify, { lazy = false, filepath }, done) {
  /** @type {Reader | undefined} */
  let reader
  if (!lazy) {
    reader = new Reader(filepath)
  }

  fastify.get('/style.json', async () => {
    if (!reader) {
      reader = new Reader(filepath)
    }
    const baseUrl = new URL(fastify.prefix, fastify.listeningOrigin)
    return reader.getStyle(baseUrl.href)
  })

  fastify.get('*', async (request, reply) => {
    if (!reader) {
      reader = new Reader(filepath)
    }
    // @ts-expect-error - not worth the hassle of type casting this
    const path = request.params['*']

    /** @type {Resource} */
    let resource
    try {
      resource = await reader.getResource(path)
    } catch (e) {
      // @ts-ignore
      e.statusCode = 404
      throw e
    }

    return sendResource(reply, resource)
  })
  done()
}
