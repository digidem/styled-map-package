import { includeKeys } from 'filter-obj'
import { Compression, PMTiles, TileType } from 'pmtiles'

import { tileIterator } from './tile-downloader.js'
import { MAX_BOUNDS } from './utils/geo.js'
import { noop } from './utils/misc.js'

/** @import { Header, RangeResponse, Source } from 'pmtiles' */
/** @import { TileFormat } from './writer.js' */
/** @import { BBox } from './utils/geo.js' */
/** @import { TileInfo, TileDownloadStats } from './tile-downloader.js' */

const PMTILES_PROTOCOL = 'pmtiles://'

/**
 * @typedef {object} PmtilesSourceMetadata
 * @property {BBox} bounds
 * @property {number} minzoom
 * @property {number} maxzoom
 * @property {string} [attribution]
 * @property {string} [description]
 * @property {object[]} [vector_layers]
 */

/**
 * @typedef {object} PmtilesHandle
 * @property {PMTiles} pmtiles
 * @property {Header} header
 * @property {TileFormat} format Tile format of the archive
 * @property {PmtilesSourceMetadata} source Inlined-source metadata derived from the archive
 */

/**
 * Whether a style source `url` points at a PMTiles archive — either via the
 * `pmtiles://` protocol prefix (used by the MapLibre pmtiles plugin) or a plain
 * URL whose path ends in `.pmtiles`.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isPmtilesUrl(url) {
  if (url.startsWith(PMTILES_PROTOCOL)) return true
  const pathname = url.split(/[?#]/, 1)[0]
  return pathname.toLowerCase().endsWith('.pmtiles')
}

/**
 * Strip a leading `pmtiles://` protocol prefix, returning the underlying
 * HTTP(S) URL.
 *
 * @param {string} url
 * @returns {string}
 */
export function resolvePmtilesUrl(url) {
  return url.startsWith(PMTILES_PROTOCOL)
    ? url.slice(PMTILES_PROTOCOL.length)
    : url
}

/**
 * @param {TileType} tileType
 * @returns {TileFormat}
 */
function tileTypeToFormat(tileType) {
  switch (tileType) {
    case TileType.Mvt:
      return 'mvt'
    case TileType.Png:
      return 'png'
    case TileType.Jpeg:
      return 'jpg'
    case TileType.Webp:
      return 'webp'
    default:
      throw new Error(
        `Unsupported PMTiles tile type (${tileType}). Only MVT, PNG, JPEG and WebP are supported.`,
      )
  }
}

/**
 * @param {Header} header
 * @returns {BBox}
 */
function boundsFromHeader({ minLon, minLat, maxLon, maxLat }) {
  if (minLon >= maxLon || minLat >= maxLat) return [...MAX_BOUNDS]
  return [minLon, minLat, maxLon, maxLat]
}

/**
 * Open a PMTiles archive and read its header and metadata. Accepts a URL string
 * (with or without the `pmtiles://` prefix) or a pmtiles `Source`.
 *
 * @param {string | Source} urlOrSource
 * @returns {Promise<PmtilesHandle>}
 */
export async function openPmtiles(urlOrSource) {
  const pmtiles = new PMTiles(
    typeof urlOrSource === 'string'
      ? resolvePmtilesUrl(urlOrSource)
      : urlOrSource,
  )
  const header = await pmtiles.getHeader()
  const format = tileTypeToFormat(header.tileType)
  if (
    header.tileCompression === Compression.Brotli ||
    header.tileCompression === Compression.Zstd
  ) {
    throw new Error(
      'PMTiles archives with brotli or zstd tile compression are not supported',
    )
  }
  /** @type {unknown} */
  let metadata
  try {
    metadata = await pmtiles.getMetadata()
  } catch {
    metadata = undefined
  }
  const meta =
    metadata && typeof metadata === 'object'
      ? /** @type {Record<string, unknown>} */ (metadata)
      : {}
  return {
    pmtiles,
    header,
    format,
    source: {
      bounds: boundsFromHeader(header),
      minzoom: header.minZoom,
      maxzoom: header.maxZoom,
      .../** @type {Partial<PmtilesSourceMetadata>} */ (
        includeKeys(meta, ['attribution', 'description', 'vector_layers'])
      ),
    },
  }
}

/**
 * @param {Uint8Array} data
 * @returns {ReadableStream<Uint8Array>}
 */
function singleChunkStream(data) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
}

/**
 * Read tiles from an open PMTiles archive within a bounding box and zoom range.
 * Returns the same shape as {@link import('./tile-downloader.js').downloadTiles}:
 * an async generator of `[tileData, tileInfo]` tuples, with `skipped` and
 * `stats` properties.
 *
 * @param {object} opts
 * @param {PMTiles} opts.pmtiles An open PMTiles archive (see {@link openPmtiles})
 * @param {TileFormat} opts.format Tile format of the archive (from its header)
 * @param {Readonly<BBox>} opts.bounds Bounding box of the area to download
 * @param {number} opts.maxzoom Maximum zoom level to download
 * @param {(progress: TileDownloadStats) => void} [opts.onprogress] Callback to report download progress
 * @param {boolean} [opts.trackErrors=false] Include errors in the returned array of skipped tiles - this has memory overhead so should only be used for debugging.
 * @param {Readonly<BBox>} [opts.sourceBounds=MAX_BOUNDS] Bounding box of source data.
 * @param {boolean} [opts.boundsBuffer=false] Buffer the bounds by one tile at each zoom level to ensure no tiles are missed at the edges.
 * @param {number} [opts.minzoom=0] Minimum zoom level to download
 * @param {number} [opts.concurrency=8] Number of concurrent tile reads
 * @returns {AsyncGenerator<[ReadableStream<Uint8Array>, TileInfo]> & { readonly skipped: Array<TileInfo & { error?: Error }>, readonly stats: TileDownloadStats }}
 */
export function downloadPmtilesTiles({
  pmtiles,
  format,
  bounds,
  maxzoom,
  onprogress = noop,
  trackErrors = false,
  sourceBounds = MAX_BOUNDS,
  boundsBuffer = false,
  minzoom = 0,
  concurrency = 8,
}) {
  /** @type {Array<TileInfo & { error?: Error }>} */
  const skipped = []
  /** @type {TileDownloadStats} */
  const stats = { total: 0, downloaded: 0, skipped: 0, totalBytes: 0 }

  /** @type {ReturnType<downloadPmtilesTiles>} */
  const tiles = (async function* () {
    const coords = [
      ...tileIterator({ bounds, minzoom, maxzoom, sourceBounds, boundsBuffer }),
    ]
    stats.total = coords.length
    onprogress(stats)

    // Keep a sliding window of in-flight `getZxy` reads. Only `concurrency`
    // reads are started ahead of the consumer, so a slow consumer applies
    // backpressure rather than buffering the whole archive in memory.
    let nextIndex = 0
    /** @type {Array<{ tileInfo: TileInfo, promise: Promise<RangeResponse | undefined> }>} */
    const inFlight = []
    const startNext = () => {
      if (nextIndex >= coords.length) return
      const { x, y, z } = coords[nextIndex++]
      inFlight.push({
        tileInfo: { z, x, y },
        promise: pmtiles.getZxy(z, x, y),
      })
    }
    for (let i = 0; i < concurrency; i++) startNext()

    while (inFlight.length > 0) {
      const { tileInfo, promise } = /** @type {(typeof inFlight)[number]} */ (
        inFlight.shift()
      )
      startNext()
      /** @type {RangeResponse | undefined} */
      let response
      try {
        response = await promise
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        skipped.push(trackErrors ? { ...tileInfo, error } : tileInfo)
        stats.skipped = skipped.length
        onprogress(stats)
        continue
      }
      if (!response) {
        // Tile is absent from the archive (normal for sparse tilesets) — drop
        // it from the total rather than reporting it as a failed download.
        stats.total--
        onprogress(stats)
        continue
      }
      const data = new Uint8Array(response.data)
      stats.downloaded++
      stats.totalBytes += data.byteLength
      onprogress(stats)
      let stream = singleChunkStream(data)
      if (format === 'mvt') {
        // SMP stores MVT gzip-compressed; `getZxy` returns it decompressed.
        stream = stream.pipeThrough(
          /** @type {TransformStream<Uint8Array, Uint8Array>} */ (
            new CompressionStream('gzip')
          ),
        )
      }
      yield [stream, { ...tileInfo, format }]
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
