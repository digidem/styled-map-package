/**
 * @typedef {object} ViewOptions
 * @property {number} port
 * @property {string} filepath
 * @property {boolean} [open]
 * @property {boolean} [fallback] Serve empty tiles and fallback glyphs for missing resources. Defaults to `true`; pass `false` to return 404s instead.
 */

/**
 * @typedef {object} ViewDeps
 * @property {new (filepath: string) => any} Reader
 * @property {(opts: any) => { fetch: (req: any, reader: any) => any }} createServer
 * @property {(port: number, handler: any) => Promise<import('node:http').Server>} listen
 * @property {(url: string) => Promise<void>} openApp
 * @property {(url: string) => void} log
 * @property {(url: string) => Promise<Uint8Array>} readViewerHtml
 * @property {(tileId: any, sourceInfo: any) => Response} [emptyTileFallback]
 * @property {(fontstack: string, range: string) => Response} [emptyGlyphFallback]
 */

/**
 * @param {ViewOptions} options
 * @param {ViewDeps} deps
 * @returns {Promise<string>} The address the server is listening on
 */
export async function runView({ port, filepath, open, fallback }, deps) {
  const { Reader, createServer, openApp, log, readViewerHtml } = deps

  // Fallback is on by default; pass `fallback: false` to disable it. Pass the
  // handlers explicitly (null to disable) rather than relying on the server's
  // own defaults, since the CLI uses Noto glyphs rather than empty ones.
  const useFallback = fallback !== false

  const reader = new Reader(filepath)
  const smpServer = createServer({
    base: '/map',
    // Render buffer tiles that lie outside the data bounds for packages written
    // with `smp:bufferTiles`. No-op for packages without that metadata.
    expandBounds: true,
    fallbackTile: useFallback ? deps.emptyTileFallback : null,
    fallbackGlyph: useFallback ? deps.emptyGlyphFallback : null,
  })

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
