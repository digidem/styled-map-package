import { ZipReader } from '@gmaclennan/zip-reader'

import { ENOENT } from './utils/errors.js'
import { noop } from './utils/misc.js'
import { validateStyle } from './utils/style.js'
import {
  getContentType,
  getResourceType,
  STYLE_FILE,
  URI_BASE,
  VERSION_FILE,
} from './utils/templates.js'

/**
 * Read a web ReadableStream into a string.
 * Browser-compatible replacement for node:stream/consumers `text()`.
 * @param {ReadableStream<Uint8Array>} readable
 * @returns {Promise<string>}
 */
async function streamToText(readable) {
  const chunks = /** @type {Uint8Array[]} */ ([])
  const reader = readable.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value))
    }
  } finally {
    reader.releaseLock()
  }
  const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0)
  const buf = new Uint8Array(totalLen)
  let off = 0
  for (const chunk of chunks) {
    buf.set(chunk, off)
    off += chunk.byteLength
  }
  return new TextDecoder().decode(buf)
}

/**
 * Read a web ReadableStream into a parsed JSON value.
 * Browser-compatible replacement for node:stream/consumers `json()`.
 * @param {ReadableStream<Uint8Array>} readable
 * @returns {Promise<unknown>}
 */
async function streamToJson(readable) {
  return JSON.parse(await streamToText(readable))
}

/**
 * @typedef {object} Resource
 * @property {string} resourceType
 * @property {string} contentType
 * @property {number} contentLength
 * @property {ReadableStream<Uint8Array>} stream
 * @property {'gzip'} [contentEncoding]
 */

/**
 * A low-level reader for styled map packages. Returns resources in the package
 * as readable streams, for serving over HTTP for example.
 */
export class Reader {
  #entriesPromise
  /** @type {undefined | Promise<void>} */
  #closePromise
  /** @type {import('@gmaclennan/zip-reader/file-source').FileSource | null} */
  #fileSource = null

  /**
   * @param {string | import('@gmaclennan/zip-reader').ZipReader} filepathOrZip Path to styled map package (`.styledmap`) file, or a ZipReader instance
   */
  constructor(filepathOrZip) {
    /** @type {Promise<import('@gmaclennan/zip-reader').ZipReader>} */
    let zipPromise
    if (typeof filepathOrZip === 'string') {
      // Dynamic import so FileSource (which uses node:fs) is never loaded
      // in browser environments where only ZipReader instances are passed.
      const sourcePromise = import('@gmaclennan/zip-reader/file-source').then(
        ({ FileSource }) => FileSource.open(filepathOrZip),
      )
      sourcePromise.catch(noop)
      zipPromise = sourcePromise.then((source) => {
        this.#fileSource = source
        return ZipReader.from(source)
      })
    } else {
      zipPromise = Promise.resolve(filepathOrZip)
    }
    zipPromise.catch(noop)

    this.#entriesPromise = (async () => {
      /** @type {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} */
      const entries = new Map()
      if (this.#closePromise) return entries
      let zip
      try {
        zip = await zipPromise
      } catch (err) {
        // Close the internally-opened file source on failure to avoid FD leaks
        if (this.#fileSource) {
          await this.#fileSource.close().catch(noop)
        }
        throw err
      }
      if (this.#closePromise) return entries
      for await (const entry of zip) {
        if (this.#closePromise) return entries
        entries.set(entry.name, entry)
      }
      return entries
    })()
    this.#entriesPromise.catch(noop)
  }

  /**
   * Resolves when the styled map package has been opened and the entries have
   * been read. Throws any error that occurred during opening.
   */
  async opened() {
    await this.#entriesPromise
  }

  /**
   * Get the format version from the VERSION file in the styled map package.
   * Returns "1.0" if no VERSION file exists (older SMP files did not have a
   * VERSION file, so we assume version 1.0).
   *
   * @returns {Promise<string>}
   */
  async getVersion() {
    const entries = await this.#entriesPromise
    const versionEntry = entries.get(VERSION_FILE)
    if (!versionEntry) return '1.0'
    return (await streamToText(versionEntry.readable())).trim()
  }

  /**
   * Get the style JSON from the styled map package. The URLs in the style JSON
   * will be transformed to use the provided base URL.
   *
   * @param {string | null} [baseUrl] Base URL where you plan to serve the resources in this styled map package, e.g. `http://localhost:3000/maps/styleA`
   * @returns {Promise<import('./types.js').SMPStyle>}
   */
  async getStyle(baseUrl = null) {
    const styleEntry = (await this.#entriesPromise).get(STYLE_FILE)
    if (!styleEntry) throw new ENOENT(STYLE_FILE)
    const style = await streamToJson(styleEntry.readable())
    if (!validateStyle(style)) {
      throw new AggregateError(validateStyle.errors, 'Invalid style')
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
    // Hard to get this type-safe without a validation function. Instead we
    // trust the Writer and the tests for now.
    return /** @type {import('./types.js').SMPStyle} */ (style)
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
      const bytes = new TextEncoder().encode(styleJSON)
      return {
        contentType: 'application/json; charset=utf-8',
        contentLength: bytes.byteLength,
        resourceType: 'style',
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
      }
    }
    const entry = (await this.#entriesPromise).get(path)
    if (!entry) throw new ENOENT(path)
    const resourceType = getResourceType(path)
    const contentType = getContentType(path)
    const stream = entry.readable()
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
      // Wait for entries to be fully read (or failed) before closing
      await this.#entriesPromise.catch(noop)
      if (this.#fileSource) {
        await this.#fileSource.close().catch(noop)
      }
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
  if (typeof baseUrl !== 'string') return smpUri
  if (!baseUrl.endsWith('/')) {
    baseUrl += '/'
  }
  return smpUri.replace(URI_BASE, baseUrl)
}
