import { createServerAdapter } from '@whatwg-node/server'
import { error } from 'itty-router/error'

import { createServer as createHTTPServer } from 'node:http'

import { Reader } from '../../lib/reader.js'
import { createServer } from '../../lib/server.js'

/**
 * Start a local HTTP server that serves an SMP fixture.
 *
 * @param {string} fixturePath - Absolute path to an .smp file
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
export async function startSMPServer(fixturePath) {
  const reader = new Reader(fixturePath)
  // Emulate a real origin server: missing tiles/glyphs return 404, not fallbacks.
  const smpServer = createServer({ fallbackTile: null, fallbackGlyph: null })
  /** @type {Set<ReadableStreamDefaultReader<Uint8Array>>} */
  const activeBodies = new Set()
  const httpServer = createHTTPServer(
    createServerAdapter(async (request) => {
      const response = await smpServer.fetch(request, reader).catch(error)
      return response.body
        ? new Response(trackBody(response.body, activeBodies), response)
        : response
    }),
  )
  await /** @type {Promise<void>} */ (
    new Promise((resolve) => httpServer.listen(0, resolve))
  )
  const { port } = /** @type {import('node:net').AddressInfo} */ (
    httpServer.address()
  )
  return {
    baseUrl: `http://localhost:${port}/`,
    close: async () => {
      // Destroy sockets before closing the reader: a response still streaming
      // from a closed FileSource is never ended by @whatwg-node/server, so the
      // socket leaks and httpServer.close() never calls back.
      httpServer.closeAllConnections()
      await /** @type {Promise<void>} */ (
        new Promise((resolve, reject) =>
          httpServer.close((err) => (err ? reject(err) : resolve())),
        )
      )
      // Bodies of requests the client aborted keep reading from the file, and
      // fail with an unhandled rejection once the reader is closed
      await Promise.all(
        [...activeBodies].map((body) => body.cancel().catch(() => {})),
      )
      await reader.close()
    },
  }
}

/**
 * Pass a response body through, keeping its reader in `active` until the body
 * ends or is cancelled.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {Set<ReadableStreamDefaultReader<Uint8Array>>} active
 */
function trackBody(body, active) {
  const bodyReader = body.getReader()
  active.add(bodyReader)
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await bodyReader.read()
      if (done) {
        active.delete(bodyReader)
        controller.close()
      } else {
        controller.enqueue(value)
      }
    },
    cancel(reason) {
      active.delete(bodyReader)
      return bodyReader.cancel(reason)
    },
  })
}
