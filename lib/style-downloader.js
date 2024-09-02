import { includeKeys } from 'filter-obj'
import ky from 'ky'
import Queue from 'yocto-queue'
import zlib from 'zlib'

import { downloadTiles } from './tile-downloader.js'
import { FetchQueue } from './utils/fetch.js'
import {
  normalizeGlyphsURL,
  normalizeSourceURL,
  normalizeSpriteURL,
  normalizeStyleURL,
} from './utils/mapbox.js'
import { clone, noop } from './utils/misc.js'
import { assertTileJSON, mapFontStacks } from './utils/style.js'

/** @import { StyleSpecification } from '@maplibre/maplibre-gl-style-spec' */
/** @import { TileSource } from './types.js' */
/** @import { TileInfo, GlyphInfo, GlyphRange, TileFormat } from './writer.js' */
/** @import { TileDownloadStats } from './tile-downloader.js' */

/** @typedef { import('ky').ResponsePromise & { body: ReadableStream<Uint8Array> } } ResponsePromise */
/** @typedef { import('type-fest').SetRequired<TileSource, 'tiles'> } TileSourceWithTiles */
/** @import { DownloadResponse } from './utils/fetch.js' */

/**
 * @typedef {object} GlyphDownloadStats
 * @property {number} total
 * @property {number} downloaded
 * @property {number} totalBytes
 */

/**
 * Download a style and its resources for offline use. Please check the terms of
 * service of the map provider you are using before downloading any resources.
 */
export default class StyleDownloader {
  /** @type {null | string} */
  #styleURL = null
  /** @type {null | StyleSpecification} */
  #style = null
  /** @type {FetchQueue} */
  #fetchQueue
  #mapboxAccessToken

  /**
   * @param {string | StyleSpecification} style A url to a style JSON file or a style object
   * @param {object} [opts]
   * @param {number} [opts.concurrency=8]
   * @param {string} [opts.mapboxAccessToken] Downloading a style from Mapbox requires an access token
   */
  constructor(style, { concurrency = 8, mapboxAccessToken } = {}) {
    if (typeof style === 'string') {
      const { searchParams } = new URL(style)
      this.#mapboxAccessToken =
        searchParams.get('access_token') || mapboxAccessToken
      this.#styleURL = normalizeStyleURL(style, this.#mapboxAccessToken)
    } else {
      this.#style = clone(style)
    }
    this.#fetchQueue = new FetchQueue(concurrency)
  }

  /**
   * Number of active downloads.
   */
  get active() {
    return this.#fetchQueue.activeCount
  }

  /**
   * Download the style JSON for this style.
   *
   * @returns {Promise<StyleSpecification>}
   */
  async getStyle() {
    if (!this.#style && this.#styleURL) {
      this.#style = /** @type {StyleSpecification} */ (
        await ky(this.#styleURL).json()
      )
    } else if (!this.#style) {
      throw new Error('Unexpected state: no style or style URL provided')
    }
    return this.#style
  }

  /**
   * Download info about the sources referenced by this style. Will ignore/skip
   * sources which are not raster or vector tiles.
   *
   * @returns {AsyncGenerator<[string, TileSourceWithTiles]>}
   */
  async *getSources() {
    const style = await this.getStyle()
    for (const sourceId in style.sources) {
      let source = style.sources[sourceId]
      if (source.type !== 'raster' && source.type !== 'vector') {
        continue
      }
      if (!source.tiles) {
        if (!source.url) continue
        const sourceUrl = normalizeSourceURL(
          source.url,
          this.#mapboxAccessToken,
        )
        const tilejson = await ky(sourceUrl).json()
        assertTileJSON(tilejson)
        Object.assign(
          source,
          includeKeys(tilejson, [
            'bounds',
            'maxzoom',
            'minzoom',
            'tiles',
            'description',
            'attribution',
            'vector_layers',
          ]),
        )
      }
      yield [
        sourceId,
        // @ts-expect-error - we mutate this to add tiles prop
        source,
      ]
    }
  }

  /**
   * Download the sprite PNGs and JSON files for this style. Returns an async
   * generator of json and png readable streams, and the sprite id and pixel
   * ratio. Downloads pixel ratios `1` and `2`.
   *
   * @returns {AsyncGenerator<{ json: import('stream').Readable, png: import('stream').Readable, id: string, pixelRatio: number }>}
   */
  async *getSprites() {
    const style = await this.getStyle()
    if (!style.sprite) return
    const accessToken = this.#mapboxAccessToken
    const spriteDefs = Array.isArray(style.sprite)
      ? style.sprite
      : [{ id: 'default', url: style.sprite }]
    for (const { id, url } of spriteDefs) {
      for (const pixelRatio of [1, 2]) {
        const format = pixelRatio === 1 ? '' : '@2x'
        const jsonUrl = normalizeSpriteURL(url, format, '.json', accessToken)
        const pngUrl = normalizeSpriteURL(url, format, '.png', accessToken)
        const [{ body: json }, { body: png }] = await Promise.all([
          this.#fetchQueue.fetch(jsonUrl),
          this.#fetchQueue.fetch(pngUrl),
        ])
        yield { json, png, id, pixelRatio }
      }
    }
  }

  /**
   * Download all the glyphs for the fonts used in this style. When font stacks
   * are used in the style.json (e.g. lists of prefered fonts like with CSS),
   * then the first font in the stack is downloaded. Defaults to downloading all
   * UTF character ranges, which may be overkill for some styles. TODO: add more
   * options here.
   *
   * Returns an async generator of readable streams of glyph data and glyph info
   * objects.
   *
   * @param {object} opts
   * @param {(progress: GlyphDownloadStats) => void} [opts.onprogress]
   * @returns {AsyncGenerator<[import('stream').Readable, GlyphInfo]>}
   */
  async *getGlyphs({ onprogress = noop } = {}) {
    const style = await this.getStyle()
    if (!style.glyphs) return

    let completed = 0
    /** @type {GlyphDownloadStats} */
    let stats = {
      total: 0,
      downloaded: 0,
      totalBytes: 0,
    }
    /** @type {import('./utils/streams.js').ProgressCallback} */
    function onDownloadProgress({ chunkBytes }) {
      stats.totalBytes += chunkBytes
      onprogress(stats)
    }
    function onDownloadComplete() {
      stats.downloaded = ++completed
      onprogress(stats)
    }

    /** @type {Queue<[Promise<void | DownloadResponse>, GlyphInfo]>} */
    const queue = new Queue()
    /** @type {Map<string, string>} */
    const fontStacks = new Map()
    mapFontStacks(style.layers, (fontStack) => {
      // Assume that the font we get back from the API is the first font in the
      // font stack. TODO: When we know the API, we can check this font is
      // actually available.
      fontStacks.set(fontStack[0], fontStack.join(','))
      return []
    })
    const glyphUrl = normalizeGlyphsURL(style.glyphs, this.#mapboxAccessToken)

    for (const [font, fontStack] of fontStacks.entries()) {
      for (let i = 0; i < Math.pow(2, 16); i += 256) {
        /** @type {GlyphRange} */
        const range = `${i}-${i + 255}`
        const url = glyphUrl
          .replace('{fontstack}', fontStack)
          .replace('{range}', range)
        const result = this.#fetchQueue
          .fetch(url, { onprogress: onDownloadProgress })
          // TODO: Handle errors downloading glyphs
          .catch(noop)
        queue.enqueue([result, { font, range }])
      }
    }

    stats.total = queue.size
    if (onprogress) onprogress(stats)

    for (const [result, glyphInfo] of queue) {
      // TODO: Handle errors downloading glyphs
      const downloadResponse = await result.catch(noop)
      if (!downloadResponse) continue
      const { body } = downloadResponse
      // Glyphs are always gzipped. Unfortunately we can't stop fetch from ungzipping, so we need to re-gzip it.
      const gzipper = zlib.createGzip()
      // Cleanup on error, assumes byteCounter won't error.
      body.on('error', (err) => gzipper.destroy(err))
      body.on('end', onDownloadComplete)
      yield [body.pipe(gzipper), glyphInfo]
    }
  }

  /**
   * Get all the tiles for this style within the given bounds and zoom range.
   * Returns an async generator of readable streams of tile data and tile info
   * objects.
   *
   * The returned iterator also has a `skipped` property which is an
   * array of tiles which could not be downloaded, and a `stats` property which
   * is an object with the total number of tiles, downloaded tiles, and total
   * bytes downloaded.
   *
   * @param {object} opts
   * @param {import('./utils/geo.js').BBox} opts.bounds
   * @param {number} opts.maxzoom
   * @param {(progress: TileDownloadStats) => void} [opts.onprogress]
   * @param {boolean} [opts.trackErrors=false] Include errors in the returned array of skipped tiles - this has memory overhead so should only be used for debugging.
   * @returns {AsyncGenerator<[import('stream').Readable, TileInfo]> & { readonly skipped: Array<TileInfo & { error?: Error }>, readonly stats: TileDownloadStats }}
   */
  getTiles({ bounds, maxzoom, onprogress = noop, trackErrors = false }) {
    const _this = this
    /** @type {Array<TileInfo & { error?: Error }>} */
    const skipped = []
    /** @type {TileDownloadStats} */
    let stats = {
      total: 0,
      downloaded: 0,
      skipped: 0,
      totalBytes: 0,
    }

    /** @type {ReturnType<StyleDownloader['getTiles']>} */
    const tiles = (async function* () {
      for await (const [sourceId, source] of _this.getSources()) {
        // Baseline stats for this source, used in the `onprogress` closure
        // below. Sorry for the hard-to-follow code! `onprogress` can be called
        // after we are already reading the next source, hence the need for a
        // closure.
        const statsBaseline = { ...stats }
        const sourceTiles = downloadTiles({
          tileUrls: source.tiles,
          bounds,
          maxzoom: Math.min(maxzoom, source.maxzoom || maxzoom),
          minzoom: source.minzoom || 0,
          sourceBounds: source.bounds,
          boundsBuffer: true,
          scheme: source.scheme,
          fetchQueue: _this.#fetchQueue,
          onprogress: (sourceStats) => {
            stats = addStats(statsBaseline, sourceStats)
            onprogress(stats)
          },
          trackErrors,
        })
        for await (const [tileDataStream, tileInfo] of sourceTiles) {
          yield [tileDataStream, { ...tileInfo, sourceId }]
        }
        Array.prototype.push.apply(
          skipped,
          sourceTiles.skipped.map((tile) => ({ ...tile, sourceId })),
        )
      }
    })()

    Object.defineProperty(tiles, 'skipped', {
      get() {
        return skipped
      },
    })

    Object.defineProperty(tiles, 'stats', {
      get() {
        return stats
      },
    })

    return tiles
  }
}

/**
 * Add two TileDownloadStats objects together.
 *
 * @param {TileDownloadStats} statsA
 * @param {TileDownloadStats} statsB
 * @returns {TileDownloadStats}
 */
function addStats(statsA, statsB) {
  return {
    total: statsA.total + statsB.total,
    downloaded: statsA.downloaded + statsB.downloaded,
    skipped: statsA.skipped + statsB.skipped,
    totalBytes: statsA.totalBytes + statsB.totalBytes,
  }
}
