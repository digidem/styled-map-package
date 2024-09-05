import { validateStyleMin, migrate } from '@maplibre/maplibre-gl-style-spec'
import archiver from 'archiver'
import { EventEmitter } from 'events'
import { excludeKeys } from 'filter-obj'
import fs from 'fs'
import { pEvent } from 'p-event'
import { PassThrough, pipeline } from 'readable-stream'
import { Readable } from 'stream'

import { getTileFormatFromStream } from './utils/file-formats.js'
import { tileToBBox, unionBBox } from './utils/geo.js'
import { clone } from './utils/misc.js'
import { writeStreamFromAsync } from './utils/streams.js'
import { replaceFontStacks } from './utils/style.js'
import {
  getGlyphFilename,
  getSpriteFilename,
  getSpriteUri,
  getTileFilename,
  getTileUri,
  GLYPH_URI,
  STYLE_FILE,
} from './utils/templates.js'

/** @typedef {string | Buffer | Uint8Array | import('stream').Readable } Source */
/** @typedef {string | Buffer | import('stream').Readable} SourceInternal */
/** @typedef {`${number}-${number}`} GlyphRange */
/** @typedef {'png' | 'mvt' | 'jpg' | 'webp'} TileFormat */
/**
 * @typedef {object} SourceInfo
 * @property {SetRequired<TileSource, 'maxzoom'>} source
 * @property {string} encodedSourceId
 * @property {TileFormat} [format]
 */
/**
 * @typedef {object} TileInfo
 * @property {number} z
 * @property {number} x
 * @property {number} y
 * @property {string} sourceId
 * @property {TileFormat} [format]
 */
/**
 * @typedef {object} GlyphInfo
 * @property {string} font
 * @property {GlyphRange} range
 */

/** @import { StyleSpecification } from '@maplibre/maplibre-gl-style-spec' */
/** @import { TileSource } from './types.js' */
/** @import { SetRequired } from 'type-fest' */

/**
 * Write a styled map package to a stream. Stream `writer.outputStream` to a
 * destination, e.g. `fs.createWriteStream('my-map.styledmap')`. You must call
 * `witer.finish()` and then wait for your writable stream to `finish` before
 * using the output.
 */
export default class Writer extends EventEmitter {
  #archive = archiver('zip', { zlib: { level: 9 } })
    .setMaxListeners(Infinity)
    .on('error', console.error)
  /** @type {Set<string>} */
  #addedFiles = new Set()
  /** @type {Set<string>} */
  #fonts = new Set()
  /** @type {Set<string>} */
  #addedSpriteIds = new Set()
  /** @type {Map<string, SourceInfo>} */
  #sources = new Map()
  /** @type {StyleSpecification} */
  #style
  /** @type {import('./utils/geo.js').BBox | undefined} */
  #bounds
  #maxzoom = 0
  #outputStream

  /**
   * @param {any} style A v7 or v8 MapLibre style. v7 styles will be migrated to
   * v8. (There are currently no typescript declarations for v7 styles, hence
   * this is typed as `any` and validated internally)
   * @param {object} opts
   * @param {number} [opts.highWaterMark=1048576] The maximum number of bytes to buffer during write
   */
  constructor(style, { highWaterMark = 1024 * 1024 } = {}) {
    super()

    const styleCopy = clone(style)
    // This mutates the style, so we work on a clone
    migrate(styleCopy)
    if (styleCopy.version !== 8) {
      throw new Error(`Unsupported style version: ${styleCopy.version}`)
    }
    const errors = validateStyleMin(styleCopy)
    if (errors.length) {
      throw new Error(`Invalid style: ${errors.join(', ')}`)
    }
    this.#style = styleCopy

    this.#outputStream = new PassThrough({ highWaterMark })
    pipeline(this.#archive, this.#outputStream, (err) => {
      if (err) this.emit('error', err)
    })
  }

  /**
   * @returns {import('stream').Readable} Readable stream of the styled map package
   */
  get outputStream() {
    return this.#outputStream
  }

  /**
   * Add a source definition to the styled map package
   *
   * @param {string} sourceId
   * @param {TileSource} source
   * @returns {void}
   */
  addSource(sourceId, source) {
    if (source.type !== 'raster' && source.type !== 'vector') {
      throw new Error(`Unsupported source type: ${source['type']}`)
    }
    if (this.#sources.has(sourceId)) {
      throw new Error(`${sourceId} already added`)
    }
    this.#sources.set(sourceId, {
      source: {
        ...excludeKeys(source, ['url', 'tiles']),
        maxzoom: 0,
      },
      encodedSourceId: encodeSourceId(this.#sources.size),
    })
  }

  /**
   * Add a tile to the styled map package
   *
   * @param {Source} tileData
   * @param {TileInfo} opts
   */
  async addTile(tileData, { z, x, y, sourceId, format }) {
    const sourceInfo = this.#sources.get(sourceId)
    if (!sourceInfo) {
      throw new Error(`Source ${sourceId} must be added before adding tiles`)
    }
    const { source, encodedSourceId } = sourceInfo
    source.maxzoom = Math.max(source.maxzoom, z)

    if (!format) {
      const tileDataStream =
        typeof tileData === 'string'
          ? fs.createReadStream(tileData)
          : tileData instanceof Uint8Array
            ? Readable.from(tileData)
            : tileData
      ;[format, tileData] = await getTileFormatFromStream(tileDataStream)
    }

    if (!sourceInfo.format) {
      sourceInfo.format = format
    } else if (sourceInfo.format !== format) {
      throw new Error(
        `Tile format mismatch for source ${sourceId}: expected ${sourceInfo.format}, got ${format}`,
      )
    }

    const bbox = tileToBBox({ z, x, y })
    // We calculate the bounds from the tiles at the max zoom level, because at
    // lower zooms the tile bbox is much larger than the actual bounding box
    if (z > this.#maxzoom) {
      this.#maxzoom = z
      this.#bounds = bbox
    } else if (z === this.#maxzoom) {
      this.#bounds = this.#bounds ? unionBBox([this.#bounds, bbox]) : bbox
    }

    const name = getTileFilename({ sourceId: encodedSourceId, z, x, y, format })
    // Tiles are stored without compression, because tiles are normally stored
    // as a compressed format.
    return this.#append(tileData, { name, store: true })
  }

  /**
   * Create a write stream for adding tiles to the styled map package
   *
   * @param {object} opts
   * @param {number} [opts.concurrency=16] The number of concurrent writes
   *
   * @returns
   */
  createTileWriteStream({ concurrency = 16 } = {}) {
    return writeStreamFromAsync(this.addTile.bind(this), { concurrency })
  }

  /**
   * Add a sprite to the styled map package
   *
   * @param {object} options
   * @param {Source} options.json
   * @param {Source} options.png
   * @param {number} options.pixelRatio
   * @param {string} [options.id='default']
   * @returns {Promise<void>}
   */
  async addSprite({ json, png, pixelRatio, id = 'default' }) {
    this.#addedSpriteIds.add(id)
    const jsonName = getSpriteFilename({ id, pixelRatio, ext: '.json' })
    const pngName = getSpriteFilename({ id, pixelRatio, ext: '.png' })
    await Promise.all([
      this.#append(json, { name: jsonName }),
      this.#append(png, { name: pngName }),
    ])
  }

  /**
   * Add glyphs to the styled map package
   *
   * @param {Source} glyphData
   * @param {object} options
   * @param {string} options.font
   * @param {GlyphRange} options.range
   * @returns {Promise<void>}
   */
  addGlyphs(glyphData, { font: fontName, range }) {
    this.#fonts.add(fontName)
    const name = getGlyphFilename({ fontstack: fontName, range })
    return this.#append(glyphData, { name })
  }

  /**
   * Create a write stream for adding glyphs to the styled map package
   *
   * @param {object} opts
   * @param {number} [opts.concurrency=16] The number of concurrent writes
   * @returns
   */
  createGlyphWriteStream({ concurrency = 16 } = {}) {
    return writeStreamFromAsync(this.addGlyphs.bind(this), { concurrency })
  }

  /**
   * Finalize the styled map package and write the style to the archive.
   * This method must be called to complete the archive.
   * You must wait for your destination write stream to 'finish' before using the output.
   */
  finish() {
    this.#prepareStyle()
    const style = JSON.stringify(this.#style)
    this.#append(style, { name: STYLE_FILE })
    this.#archive.finalize()
  }

  /**
   * Mutates the style object to prepare it for writing to the archive.
   * Deterministic: can be run more than once with the same result.
   */
  #prepareStyle() {
    if (this.#sources.size === 0) {
      throw new Error('Missing sources: add at least one source')
    }
    if (this.#style.glyphs && this.#fonts.size === 0) {
      throw new Error(
        'Missing fonts: style references glyphs but no fonts added',
      )
    }

    // Replace any referenced font stacks with a single font choice based on the
    // fonts available in this offline map package.
    replaceFontStacks(this.#style, [...this.#fonts])

    // Use a custom URL schema for referencing glyphs and sprites
    if (this.#style.glyphs) {
      this.#style.glyphs = GLYPH_URI
    }
    if (typeof this.#style.sprite === 'string') {
      if (!this.#addedSpriteIds.has('default')) {
        throw new Error(
          'Missing sprite: style references sprite but none added',
        )
      }
      this.#style.sprite = getSpriteUri()
    } else if (Array.isArray(this.#style.sprite)) {
      this.#style.sprite = this.#style.sprite.map(({ id }) => {
        if (!this.#addedSpriteIds.has(id)) {
          throw new Error(
            `Missing sprite: style references sprite ${id} but none added`,
          )
        }
        return { id, url: getSpriteUri(id) }
      })
    }

    // Add a tile URL (with custom schema) for each source
    for (const sourceId of Object.keys(this.#style.sources)) {
      const sourceInfo = this.#sources.get(sourceId)
      if (!sourceInfo) {
        // TODO: Handle unsupported source types
        continue
      }
      const { encodedSourceId, source, format = 'mvt' } = sourceInfo
      source.tiles = [getTileUri({ sourceId: encodedSourceId, format })]
      this.#style.sources[sourceId] = source
    }

    /** @type {Record<string, any>} */
    const metadata = this.#style.metadata || (this.#style.metadata = {})
    if (this.#bounds) {
      metadata['smp:bounds'] = this.#bounds
      const [w, s, e, n] = this.#bounds
      this.#style.center = [w + (e - w) / 2, s + (n - s) / 2]
    }
    metadata['smp:maxzoom'] = this.#maxzoom
    this.#style.zoom = Math.max(0, this.#maxzoom - 2)
  }

  /**
   *
   * @param {Source} source
   * @param {{ name: string, store?: boolean }} options
   * @returns {Promise<void>}
   */
  async #append(source, { name, store = false }) {
    if (this.#addedFiles.has(name)) {
      throw new Error(`${name} already added`)
    }
    this.#addedFiles.add(name)
    const onAdded = pEvent(
      this.#archive,
      'entry',
      (entry) => entry.name === name,
    )
    this.#archive.append(convertSource(source), { name, store })
    await onAdded
  }
}

/**
 * Simple encoding to keep file names in the Zip as short as possible.
 *
 * @param {number} sourceIndex
 */
function encodeSourceId(sourceIndex) {
  return sourceIndex.toString(36)
}

/**
 * Convert a source to a format that can be appended to the archive (which does
 * not support Uint8Arrays)
 *
 * @param {Source} source
 * @returns {SourceInternal}
 */
function convertSource(source) {
  return !Buffer.isBuffer(source) && source instanceof Uint8Array
    ? Buffer.from(source.buffer, source.byteOffset, source.length)
    : source
}
