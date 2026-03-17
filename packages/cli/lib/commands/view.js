/**
 * @typedef {object} ViewOptions
 * @property {number} port
 * @property {string} filepath
 * @property {boolean} [open]
 */

/**
 * @typedef {object} ViewDeps
 * @property {new (filepath: string) => any} Reader
 * @property {(opts: any) => { fetch: (req: any, reader: any) => any }} createServer
 * @property {(port: number, handler: any) => Promise<import('node:http').Server>} listen
 * @property {(url: string) => Promise<void>} openApp
 * @property {(url: string) => void} log
 * @property {(url: string) => Promise<Uint8Array>} readViewerHtml
 */

/**
 * @param {ViewOptions} options
 * @param {ViewDeps} deps
 * @returns {Promise<string>} The address the server is listening on
 */
export async function runView({ port, filepath, open }, deps) {
  const { Reader, createServer, openApp, log, readViewerHtml } = deps

  const reader = new Reader(filepath)
  const smpServer = createServer({ base: '/map' })

  /** @param {Request} request */
  const handler = async (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/') {
      const index = await readViewerHtml(
        new URL('../../map-viewer/index.html', import.meta.url).pathname,
      )
      return new Response(index, {
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': String(index.byteLength),
          'Cache-Control': 'public, max-age=0',
        },
      })
    }
    if (url.pathname.startsWith('/map/')) {
      return smpServer.fetch(request, reader)
    }
    return new Response('Not found', { status: 404 })
  }

  const address = await deps.listen(port, handler)

  log(`server listening on ${address}`)
  if (open) {
    await openApp(address)
  }
  return address
}
