import { validateStyleMin, migrate } from '@maplibre/maplibre-gl-style-spec'
import { bbox } from '@turf/bbox'
import archiver from 'archiver'
import { EventEmitter } from 'events'
import { excludeKeys } from 'filter-obj'
import fs from 'fs'
import { pEvent } from 'p-event'
import { PassThrough, pipeline } from 'readable-stream'
import { Readable } from 'stream'

import { getTileFormatFromStream } from './utils/file-formats.js'
import { MAX_BOUNDS, tileToBBox, unionBBox } from './utils/geo.js'
import { clone } from './utils/misc.js'
import { writeStreamFromAsync } from './utils/streams.js'
import { replaceFontStacks } from './utils/style.js'
import {
  FONTS_FOLDER,
  FORMAT_VERSION,
  getGlyphFilename,
  getSpriteFilename,
  getSpriteUri,
  getTileFilename,
  getTileUri,
  GLYPH_URI,
  SOURCES_FOLDER,
  STYLE_FILE,
  VERSION_FILE,
} from './utils/templates.js'

/** @typedef {string | Buffer | Uint8Array | import('stream').Readable } Source */
/** @typedef {string | Buffer | import('stream').Readable} SourceInternal */
/** @typedef {`${number}-${number}`} GlyphRange */
/** @typedef {'png' | 'mvt' | 'jpg' | 'webp'} TileFormat */
/**
 * @typedef {object} SourceInfo
 * @property {import('./types.js').SMPSource} source
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
/** @import { InputSource, SMPSource } from './types.js' */

export const SUPPORTED_SOURCE_TYPES = /** @type {const} */ ([
  'raster',
  'vector',
  'geojson',
])

/**
 * Write a styled map package to a stream. Stream `writer.outputStream` to a
 * destination, e.g. `fs.createWriteStream('my-map.styledmap')`. You must call
 * `witer.finish()` and then wait for your writable stream to `finish` before
 * using the output.
 */
export class Writer extends EventEmitter {
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
  #outputStream

  static SUPPORTED_SOURCE_TYPES = SUPPORTED_SOURCE_TYPES

  /**
   * @param {any} style A v7 or v8 MapLibre style. v7 styles will be migrated to
   * v8. (There are currently no typescript declarations for v7 styles, hence
   * this is typed as `any` and validated internally)
   * @param {object} opts
   * @param {number} [opts.highWaterMark=1048576] The maximum number of bytes to buffer during write
   */
  constructor(style, { highWaterMark = 1024 * 1024 } = {}) {
    super()
    if (!style || !('version' in style)) {
      throw new Error('Invalid style')
    }
    if (style.version !== 7 && style.version !== 8) {
      throw new Error(`Invalid style: Unsupported version v${style.version}`)
    }
    // Basic validation so migrate can work - more validation is done later
    if (!Array.isArray(style.layers)) {
      throw new Error('Invalid style: missing layers property')
    }

    const styleCopy = clone(style)
    // This mutates the style, so we work on a clone
    migrate(styleCopy)
    const errors = validateStyleMin(styleCopy)
    if (errors.length) {
      throw new AggregateError(errors, 'Invalid style')
    }
    this.#style = styleCopy

    for (const [sourceId, source] of Object.entries(this.#style.sources)) {
      if (source.type !== 'geojson') continue
      // Eagerly add GeoJSON sources - if they reference data via a URL and data
      // is not added, these sources will be excluded from the resulting SMP
      this.#addSource(sourceId, source)
    }

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

  #getBounds() {
    /** @type {import('./utils/geo.js').BBox | undefined} */
    let bounds
    let maxzoom = 0
    for (const { source } of this.#sources.values()) {
      if (source.type === 'geojson') {
        if (isEmptyFeatureCollection(source.data)) continue
        // GeoJSON source always increases the bounds of the map
        const bbox = get2DBBox(source.data.bbox)
        bounds = bounds ? unionBBox([bounds, bbox]) : [...bbox]
      } else {
        // For raster and vector tile sources, a source with a higher max zoom
        // overrides the bounds from lower zooms, because bounds from lower zoom
        // tiles do not really reflect actual bounds (imagine a source of zoom 0
        // - a single tile covers the whole world)
        if (source.maxzoom < maxzoom) continue
        if (source.maxzoom === maxzoom) {
          bounds = bounds ? unionBBox([bounds, source.bounds]) : source.bounds
        } else {
          bounds = source.bounds
          maxzoom = source.maxzoom
        }
      }
    }
    return bounds
  }

  #getMaxZoom() {
    let maxzoom = 0
    for (const { source } of this.#sources.values()) {
      const sourceMaxzoom =
        // For GeoJSON sources, the maxzoom is 16 unless otherwise set
        source.type === 'geojson' ? source.maxzoom || 16 : source.maxzoom
      maxzoom = Math.max(maxzoom, sourceMaxzoom)
    }
    return maxzoom
  }

  /**
   * Add a source definition to the styled map package
   *
   * @param {string} sourceId
   * @param {InputSource} source
   * @returns {SourceInfo}
   */
  #addSource(sourceId, source) {
    const encodedSourceId = encodeSourceId(this.#sources.size)
    // Most of the body of this function is just to keep Typescript happy.
    // Makes it more verbose, but makes it more type safe.
    const tileSourceOverrides = {
      minzoom: 0,
      maxzoom: 0,
      bounds: /** @type {import('./utils/geo.js').BBox} */ ([...MAX_BOUNDS]),
      tiles: /** @type {string[]} */ ([]),
    }
    /** @type {SMPSource} */
    let smpSource
    switch (source.type) {
      case 'raster':
      case 'vector':
        smpSource = {
          ...excludeKeys(source, ['tiles', 'url']),
          ...tileSourceOverrides,
        }
        break
      case 'geojson':
        smpSource = {
          ...source,
          maxzoom: 0,
          data:
            typeof source.data !== 'string'
              ? // Add a bbox property to the GeoJSON data if it doesn't already have one
                { ...source.data, bbox: source.data.bbox || bbox(source.data) }
              : // If GeoJSON data is referenced by a URL, start with an empty FeatureCollection
                {
                  type: 'FeatureCollection',
                  features: [],
                  bbox: [0, 0, 0, 0],
                },
        }
        break
    }
    const sourceInfo = {
      source: smpSource,
      encodedSourceId,
    }
    this.#sources.set(sourceId, sourceInfo)
    return sourceInfo
  }

  /**
   * Add a tile to the styled map package
   *
   * @param {Source} tileData
   * @param {TileInfo} opts
   */
  async addTile(tileData, { z, x, y, sourceId, format }) {
    let sourceInfo = this.#sources.get(sourceId)
    if (!sourceInfo) {
      const source = this.#style.sources[sourceId]
      if (!source) {
        throw new Error(`Source not referenced in style.json: ${sourceId}`)
      }
      if (source.type !== 'raster' && source.type !== 'vector') {
        throw new Error(`Unsupported source type: ${source.type}`)
      }
      sourceInfo = this.#addSource(sourceId, source)
    }
    const { source, encodedSourceId } = sourceInfo
    // Mainly to keep Typescript happy...
    if (source.type !== 'raster' && source.type !== 'vector') {
      throw new Error(`Unsupported source type: ${source.type}`)
    }

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
    if (z > source.maxzoom) {
      source.maxzoom = z
      source.bounds = bbox
    } else if (z === source.maxzoom) {
      source.bounds = unionBBox([source.bounds, bbox])
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
   * @param {number} [options.pixelRatio]
   * @param {string} [options.id='default']
   * @returns {Promise<void>}
   */
  async addSprite({ json, png, pixelRatio = 1, id = 'default' }) {
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
   * @param {GlyphInfo} glyphInfo
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
  async finish() {
    await this.#append(FORMAT_VERSION + '\n', { name: VERSION_FILE })
    this.#prepareStyle()
    const style = JSON.stringify(this.#style)
    await this.#append(style, { name: STYLE_FILE })
    sortEntries(this.#archive)
    await this.#archive.finalize()
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

    this.#style.sources = {}
    for (const [sourceId, { source, encodedSourceId, format = 'mvt' }] of this
      .#sources) {
      if (source.type === 'geojson' && isEmptyFeatureCollection(source.data)) {
        // Skip empty GeoJSON sources
        continue
      }
      this.#style.sources[sourceId] = source
      if (!('tiles' in source)) continue
      // Add a tile URL (with custom schema) for each tile source
      source.tiles = [getTileUri({ sourceId: encodedSourceId, format })]
    }

    this.#style.layers = this.#style.layers.filter(
      (layer) => !('source' in layer) || !!this.#style.sources[layer.source],
    )

    /** @type {Record<string, any>} */
    const metadata = this.#style.metadata || (this.#style.metadata = {})
    const bounds = this.#getBounds()
    if (bounds) {
      metadata['smp:bounds'] = bounds
      const [w, s, e, n] = bounds
      this.#style.center = [w + (e - w) / 2, s + (n - s) / 2]
    }
    metadata['smp:maxzoom'] = this.#getMaxZoom()
    /** @type {Record<string, string>} */
    metadata['smp:sourceFolders'] = {}
    for (const [sourceId, { encodedSourceId }] of this.#sources) {
      metadata['smp:sourceFolders'][sourceId] = encodedSourceId
    }
    this.#style.zoom = Math.max(0, this.#getMaxZoom() - 2)
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

/** @param {import('geojson').GeoJSON} data */
function isEmptyFeatureCollection(data) {
  return data.type === 'FeatureCollection' && data.features.length === 0
}

/**
 * Strictly a GeoJSON bounding box could be 3D, but we only support 2D bounding
 * @param {import('geojson').BBox} bbox
 * @returns {import('./utils/geo.js').BBox}
 */
function get2DBBox(bbox) {
  if (bbox.length === 4) return bbox
  return [bbox[0], bbox[1], bbox[3], bbox[4]]
}

/**
 * @typedef {object} ZipEntry
 * @property {string} name
 */

/**
 * Dive into the internals of Archiver to sort the central directory entries of
 * the zip, so that the style.json, ASCII glyphs, and initial tiles are listed
 * first, which improves read speed (the map can be displayed before the entire
 * central directory is indexed)
 * @param {import('archiver').Archiver} archive
 */
function sortEntries(archive) {
  // @ts-expect-error
  const entries = /** @type {unknown} */ (archive._module?.engine?._entries)
  if (!Array.isArray(entries)) {
    throw new Error(
      'Cannot find zip entries: check implementation changes in Archiver',
    )
  }
  const sortedEntries = entries.sort(
    /**
     * @param {unknown} a
     * @param {unknown} b
     */
    function (a, b) {
      assertValidEntry(a)
      assertValidEntry(b)
      if (a.name === VERSION_FILE) return -1
      if (b.name === VERSION_FILE) return 1
      if (a.name === 'style.json') return -1
      if (b.name === 'style.json') return 1
      const foldersA = a.name.split('/')
      const foldersB = b.name.split('/')
      if (foldersA[0] === FONTS_FOLDER && foldersA[2] === '0-255.pbf.gz')
        return -1
      if (foldersB[0] === FONTS_FOLDER && foldersB[2] === '0-255.pbf.gz')
        return 1
      if (foldersA[0] === SOURCES_FOLDER && foldersB[0] !== SOURCES_FOLDER)
        return -1
      if (foldersB[0] === SOURCES_FOLDER && foldersA[0] !== SOURCES_FOLDER)
        return 1
      if (foldersA[0] === SOURCES_FOLDER && foldersB[0] === SOURCES_FOLDER) {
        const zoomA = +foldersA[2]
        const zoomB = +foldersB[2]
        return zoomA - zoomB
      }
      return 0
    },
  )
  // @ts-expect-error
  archive._module.engine._entries = sortedEntries
}

/**
 * @param {unknown} maybeEntry
 * @returns {asserts maybeEntry is ZipEntry}
 */
function assertValidEntry(maybeEntry) {
  if (
    !maybeEntry ||
    typeof maybeEntry !== 'object' ||
    !('name' in maybeEntry) ||
    typeof maybeEntry.name !== 'string'
  ) {
    throw new Error(
      'Unexpected zip entry type: check implementation changes in Archiver',
    )
  }
}
