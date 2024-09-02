/**
 * @typedef {object} PluginOptions
 * @property {string} filepath
 * @property {boolean} [lazy=false]
 */
import Reader from './reader.js'

/**
 * Fastify plugin for serving a styled map package. User `lazy: true` to defer
 * opening the file until the first request.
 *
 * @type {import("fastify").FastifyPluginCallback<PluginOptions>}
 */
export default function (fastify, { filepath, lazy = false }, done) {
  /** @type {Reader | undefined} */
  let reader
  if (!lazy) {
    reader = new Reader(filepath)
  }
  const fd = fastify.decorateReply(
    'sendResource',
    /** @param {import('./reader.js').Resource} resource */
    function (resource) {
      this.type(resource.contentType).header(
        'content-length',
        resource.contentLength,
      )
      if (resource.contentEncoding)
        this.header('content-encoding', resource.contentEncoding)
      // @ts-ignore
      return this.send(resource.stream)
    },
  )

  fd.get('/style.json', async (request, reply) => {
    if (!reader) {
      reader = new Reader(filepath)
    }
    // @ts-ignore - can't type this and keep it encapsulated
    return reply.sendResource(await reader.getStyle(fastify.listeningOrigin))
  })
  fd.get('*', async (request, reply) => {
    if (!reader) {
      reader = new Reader(filepath)
    }
    try {
      // @ts-ignore - can't type this and keep it encapsulated
      return reply.sendResource(
        await reader.getResource(decodeURI(request.url)),
      )
    } catch (e) {
      // @ts-ignore
      e.statusCode = 404
      throw e
    }
  })
  done()
}
