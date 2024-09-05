/**
 * @typedef {object} PluginOptions
 * @property {string} filepath
 * @property {boolean} [lazy=false]
 */
import Reader from './reader.js'

/** @import { FastifyPluginCallback, FastifyReply } from 'fastify' */
/** @import { Resource } from './reader.js' */

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
export default function (fastify, { filepath, lazy = false }, done) {
  /** @type {Reader | undefined} */
  let reader
  if (!lazy) {
    reader = new Reader(filepath)
  }

  fastify.get('/style.json', async (_request, reply) => {
    if (!reader) {
      reader = new Reader(filepath)
    }
    return sendResource(reply, await reader.getStyle(fastify.listeningOrigin))
  })

  fastify.get('*', async (request, reply) => {
    if (!reader) {
      reader = new Reader(filepath)
    }

    /** @type {Resource} */
    let resource
    try {
      resource = await reader.getResource(decodeURI(request.url))
    } catch (e) {
      // @ts-ignore
      e.statusCode = 404
      throw e
    }

    return sendResource(reply, resource)
  })
  done()
}
