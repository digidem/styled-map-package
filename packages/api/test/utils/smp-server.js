import { createServerAdapter } from '@whatwg-node/server'
import { error } from 'itty-router/error'

import { createServer as createHTTPServer } from 'node:http'

import { createServer, Reader } from '../../lib/index.js'

/**
 * Start a local HTTP server that serves an SMP fixture.
 *
 * @param {string} fixturePath - Absolute path to an .smp file
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
export async function startSMPServer(fixturePath) {
  const reader = new Reader(fixturePath)
  const smpServer = createServer()
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
    close: () =>
      new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()))
        reader.close()
      }),
  }
}
