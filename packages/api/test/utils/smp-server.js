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
  const httpServer = createHTTPServer(
    createServerAdapter((request) =>
      smpServer.fetch(request, reader).catch(error),
    ),
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
      await reader.close()
    },
  }
}
