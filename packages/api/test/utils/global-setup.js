import { createServerAdapter } from '@whatwg-node/server'

import http from 'node:http'
import { fileURLToPath } from 'node:url'

import { Reader } from '../../lib/reader.js'
import { createServer as createSMPServer } from '../../lib/server.js'

/**
 * Vitest global setup: start a local HTTP server that serves the
 * demotiles-z2.smp fixture via the SMP server. The server URL is exposed to
 * all test files via `inject('smpServerUrl')`.
 *
 * CORS headers are added so browser-environment tests can fetch from it.
 *
 * @param {{ provide: (key: string, value: unknown) => void }} opts
 */
export default async function setup({ provide }) {
  const fixturePath = fileURLToPath(
    new URL('../fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(fixturePath)
  // Emulate a real origin server: missing tiles/glyphs return 404, not fallbacks.
  const smpServer = createSMPServer({ fallbackTile: null, fallbackGlyph: null })

  const adapter = createServerAdapter((request) => {
    return smpServer
      .fetch(request, reader)
      .then((response) => {
        response.headers.set('Access-Control-Allow-Origin', '*')
        return response
      })
      .catch((err) => {
        const status = typeof err.status === 'number' ? err.status : 500
        return new Response(String(err.message || 'Internal Server Error'), {
          status,
          headers: { 'Access-Control-Allow-Origin': '*' },
        })
      })
  })

  const server = http.createServer(adapter)
  await /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve())
      server.on('error', reject)
    })
  )

  const address = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  )
  provide('smpServerUrl', `http://127.0.0.1:${address.port}`)

  return async () => {
    // Close the HTTP server before the reader: a response still streaming from
    // a closed FileSource is never ended, leaving a socket that stops
    // server.close() from ever calling back.
    server.closeAllConnections()
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve(undefined))),
    )
    await reader.close()
  }
}
