import { IttyRouter } from 'itty-router/IttyRouter'
import { StatusError } from 'itty-router/StatusError'
import { createResponse } from 'itty-router/createResponse'

import { isFileNotThereError } from './utils/errors.js'
import { URI_BASE, templateToRegex } from './utils/templates.js'

/** @import { Resource, Reader } from './reader.js' */
/** @import {IRequestStrict, RequestLike} from 'itty-router' */

/** @typedef {Pick<Reader, keyof Reader>} ReaderLike */
/** @typedef {typeof IttyRouter<IRequestStrict, [ReaderLike], Response>} RouterType */

/**
 * @param {Resource} resource
 * @param {ResponseInit} [options]
 * @returns {Response} reply
 */
function resourceResponse(resource, options = {}) {
  const response = new Response(resource.stream, options)
  response.headers.set('Content-Type', resource.contentType)
  response.headers.set('Content-Length', resource.contentLength.toString())
  if (resource.contentEncoding) {
    response.headers.set('Content-Encoding', resource.contentEncoding)
  }
  return response
}

const jsonRaw = createResponse('application/json; charset=utf-8')
const encoder = new TextEncoder()

/** @param {unknown} obj */
function json(obj) {
  const data = encoder.encode(JSON.stringify(obj))
  return jsonRaw(data, {
    headers: { 'Content-Length': data.length.toString() },
  })
}

/**
 * Create a server for serving styled map packages (SMP) over http. The server
 * is a `fetch` handler that must be provided a WHATWG `Request` and a SMP
 * `Reader` instance. Use `@whatwg-node/server` to use with Node.js HTTP server.
 *
 * To handle errors, catch errors from `fetch` and return appropriate HTTP responses.
 * You can use `itty-router/error` for this.
 *
 * @example
 * ```js
 * import { createServer } from 'node:http'
 * import { createServerAdapter } from '@whatwg-node/server'
 * import { createServer as createSMPServer } from 'styled-map-package-api/server'
 * import { Reader } from 'styled-map-package-api/reader'
 *
 * const reader = new Reader('path/to/your-style.smp')
 * const smpServer = createSMPServer()
 * const httpServer = createServer(createServerAdapter((request) => {
 *   return smpServer.fetch(request, reader)
 * }))
 * ```
 *
 * @param {object} [options]
 * @param {string} [options.base='/'] Base path for the server routes
 * @param {(tileId: { x: number, y: number, z: number }, sourceInfo: { sourceId: string, source: import('./types.js').SMPSource }) => Response | Promise<Response>} [options.fallbackTile] Called when a tile is missing from the SMP
 * @param {(fontstack: string, range: string) => Response | Promise<Response>} [options.fallbackGlyph] Called when a glyph is missing from the SMP
 * @returns {{ fetch: (request: RequestLike, reader: ReaderLike) => Promise<Response> }} server instance
 */
export function createServer({ base = '/', fallbackTile, fallbackGlyph } = {}) {
  base = base.endsWith('/') ? base : base + '/'

  /** @type {WeakMap<ReaderLike, Promise<import('./types.js').SMPStyle>>} */
  const styleCache = new WeakMap()

  /** @type {WeakMap<ReaderLike, TileMatcher[]>} */
  const tileMatcherCache = new WeakMap()

  /** @type {WeakMap<ReaderLike, RegExp | null>} */
  const glyphRegexCache = new WeakMap()

  /**
   * Get the raw style for a reader, caching the promise per reader.
   * @param {ReaderLike} reader
   */
  function getCachedStyle(reader) {
    let promise = styleCache.get(reader)
    if (!promise) {
      promise = reader.getStyle()
      styleCache.set(reader, promise)
    }
    return promise
  }

  const router = IttyRouter({
    base,
  })
    .get('/style.json', async (request, reader) => {
      const baseUrl = new URL('.', request.url)
      const style = await reader.getStyle(baseUrl.href)
      return json(style)
    })
    .get(':path+', async (request, reader) => {
      const path = decodeURIComponent(request.params.path)
      try {
        const resource = await reader.getResource(path)
        return resourceResponse(resource)
      } catch (err) {
        if (!isFileNotThereError(err)) throw err

        if (fallbackTile) {
          let matchers = tileMatcherCache.get(reader)
          if (!matchers) {
            const style = await getCachedStyle(reader)
            matchers = buildTileMatchers(style.sources)
            tileMatcherCache.set(reader, matchers)
          }
          for (const { regex, sourceId, source } of matchers) {
            const match = path.match(regex)
            if (match?.groups) {
              return fallbackTile(
                {
                  x: Number(match.groups.x),
                  y: Number(match.groups.y),
                  z: Number(match.groups.z),
                },
                { sourceId, source },
              )
            }
          }
        }

        if (fallbackGlyph) {
          let glyphRegex = glyphRegexCache.get(reader)
          if (glyphRegex === undefined) {
            const style = await getCachedStyle(reader)
            glyphRegex = buildGlyphRegex(style.glyphs)
            glyphRegexCache.set(reader, glyphRegex)
          }
          if (glyphRegex) {
            const match = path.match(glyphRegex)
            if (match?.groups) {
              return fallbackGlyph(match.groups.fontstack, match.groups.range)
            }
          }
        }

        throw new StatusError(404, 'Not Found')
      }
    })
  return {
    fetch: async (request, reader) => {
      return router.fetch(request, reader).catch((err) => {
        if (isFileNotThereError(err)) {
          throw new StatusError(404, 'Not Found')
        } else {
          throw err
        }
      })
    },
  }
}

/**
 * @typedef {{ regex: RegExp, sourceId: string, source: import('./types.js').SMPSource }} TileMatcher
 */

const TILE_PLACEHOLDERS = { z: '\\d+', x: '\\d+', y: '\\d+' }

/** Check that a tile URL template has {z}, {x}, {y} and no adjacent placeholders.
 * @param {string} template */
function isValidTileTemplate(template) {
  return (
    template.includes('{z}') &&
    template.includes('{x}') &&
    template.includes('{y}') &&
    !template.includes('}{')
  )
}

/**
 * Build precompiled regex matchers for all tile sources.
 *
 * @param {{ [_: string]: import('./types.js').SMPSource }} sources
 * @returns {TileMatcher[]}
 */
function buildTileMatchers(sources) {
  /** @type {TileMatcher[]} */
  const matchers = []
  for (const [sourceId, source] of Object.entries(sources)) {
    if (!('tiles' in source) || !source.tiles) continue
    for (const tileUrl of source.tiles) {
      if (!tileUrl.startsWith(URI_BASE)) continue
      const templatePath = tileUrl.slice(URI_BASE.length)
      if (!isValidTileTemplate(templatePath)) continue
      const regex = templateToRegex(templatePath, TILE_PLACEHOLDERS)
      matchers.push({ regex, sourceId, source })
    }
  }
  return matchers
}

const GLYPH_PLACEHOLDERS = { fontstack: '.+', range: '[^/]+' }

/**
 * Build a regex to parse fontstack and range from a glyph resource path,
 * based on the style's glyphs URI template.
 *
 * @param {string | undefined} glyphsUri
 * @returns {RegExp | null}
 */
function buildGlyphRegex(glyphsUri) {
  if (!glyphsUri || !glyphsUri.startsWith(URI_BASE)) return null
  const template = glyphsUri.slice(URI_BASE.length)
  if (
    !template.includes('{fontstack}') ||
    !template.includes('{range}') ||
    template.includes('}{')
  ) {
    return null
  }
  return templateToRegex(template, GLYPH_PLACEHOLDERS)
}
