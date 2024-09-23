import intoStream from 'into-stream'
import { open } from 'yauzl-promise'

import { json } from 'node:stream/consumers'

import { validateStyle } from './utils/style.js'
import {
  getContentType,
  getResourceType,
  STYLE_FILE,
  URI_BASE,
} from './utils/templates.js'

/**
 * @typedef {object} Resource
 * @property {string} resourceType
 * @property {string} contentType
 * @property {number} contentLength
 * @property {import('stream').Readable} stream
 * @property {'gzip'} [contentEncoding]
 */

/**
 * A low-level reader for styled map packages. Returns resources in the package
 * as readable streams, for serving over HTTP for example.
 */
export default class Reader {
  /** @type {Promise<import('yauzl-promise').ZipFile>} */
  #zipPromise
  #entriesPromise
  /** @type {undefined | Promise<void>} */
  #closePromise

  /**
   * @param {string | import('yauzl-promise').ZipFile} filepathOrZip Path to styled map package (`.styledmap`) file, or an instance of yauzl ZipFile
   */
  constructor(filepathOrZip) {
    const zipPromise = (this.#zipPromise =
      typeof filepathOrZip === 'string'
        ? open(filepathOrZip)
        : Promise.resolve(filepathOrZip))
    this.#entriesPromise = (async () => {
      /** @type {Map<string, import('yauzl-promise').Entry>} */
      const entries = new Map()
      if (this.#closePromise) return entries
      const zip = await zipPromise
      if (this.#closePromise) return entries
      for await (const entry of zip) {
        if (this.#closePromise) return entries
        entries.set(entry.filename, entry)
      }
      return entries
    })()
  }

  /**
   * Get the style JSON from the styled map package. The URLs in the style JSON
   * will be transformed to use the provided base URL.
   *
   * @param {string | null} [baseUrl] Base URL where you plan to serve the resources in this styled map package, e.g. `http://localhost:3000/maps/styleA`
   * @returns {Promise<import('@maplibre/maplibre-gl-style-spec').StyleSpecification>}
   */
  async getStyle(baseUrl = null) {
    const styleEntry = (await this.#entriesPromise).get(STYLE_FILE)
    if (!styleEntry) throw new Error(`File not found: ${STYLE_FILE}`)
    const stream = await styleEntry.openReadStream()
    const style = await json(stream)
    if (!validateStyle(style)) {
      throw new Error('Invalid style')
    }
    if (typeof style.glyphs === 'string') {
      style.glyphs = getUrl(style.glyphs, baseUrl)
    }
    if (typeof style.sprite === 'string') {
      style.sprite = getUrl(style.sprite, baseUrl)
    } else if (Array.isArray(style.sprite)) {
      style.sprite = style.sprite.map(({ id, url }) => {
        return { id, url: getUrl(url, baseUrl) }
      })
    }
    for (const source of Object.values(style.sources)) {
      if ('tiles' in source && source.tiles) {
        source.tiles = source.tiles.map((tile) => getUrl(tile, baseUrl))
      }
    }
    return style
  }

  /**
   * Get a resource from the styled map package. The path should be relative to
   * the root of the package.
   *
   * @param {string} path
   * @returns {Promise<Resource>}
   */
  async getResource(path) {
    if (path[0] === '/') path = path.slice(1)
    if (path === STYLE_FILE) {
      const styleJSON = JSON.stringify(await this.getStyle())
      return {
        contentType: 'application/json; charset=utf-8',
        contentLength: Buffer.byteLength(styleJSON, 'utf8'),
        resourceType: 'style',
        stream: intoStream(styleJSON),
      }
    }
    const entry = (await this.#entriesPromise).get(path)
    if (!entry) throw new Error(`File not found: ${path}`)
    const resourceType = getResourceType(path)
    const contentType = getContentType(path)
    const stream = await entry.openReadStream()
    /** @type {Resource} */
    const resource = {
      resourceType,
      contentType,
      contentLength: entry.uncompressedSize,
      stream,
    }
    if (path.endsWith('.gz')) {
      resource.contentEncoding = 'gzip'
    }
    return resource
  }

  /**
   * Close the styled map package file (should be called after reading the file to avoid memory leaks)
   */
  async close() {
    if (this.#closePromise) return this.#closePromise
    this.#closePromise = (async () => {
      const zip = await this.#zipPromise
      await zip.close()
    })()
    return this.#closePromise
  }
}

/**
 * @param {string} smpUri
 * @param {string | null} baseUrl
 */
function getUrl(smpUri, baseUrl) {
  if (!smpUri.startsWith(URI_BASE)) {
    throw new Error(`Invalid SMP URI: ${smpUri}`)
  }
  if (!baseUrl) return smpUri
  return smpUri.replace(URI_BASE, baseUrl + '/')
}
