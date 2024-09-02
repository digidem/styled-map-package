import SphericalMercator from '@mapbox/sphericalmercator'
import Queue from 'yocto-queue'
import zlib from 'zlib'

import { FetchQueue } from './utils/fetch.js'
import {
  getFormatFromMimeType,
  getTileFormatFromStream,
} from './utils/file-formats.js'
import { getTileUrl, MAX_BOUNDS } from './utils/geo.js'
import { noop } from './utils/misc.js'

/** @typedef {Omit<import('./writer.js').TileInfo, 'sourceId'>} TileInfo */
/**
 * @typedef {object} TileDownloadStats
 * @property {number} total
 * @property {number} downloaded
 * @property {number} skipped
 * @property {number} totalBytes
 */

/**
 * Download tiles from a list of tile URLs within a bounding box and zoom range.
 * Returns an async generator of tile data as readable streams and tile info objects.
 *
 * @param {object} opts
 * @param {string[]} opts.tileUrls Array of tile URL templates. Use `{x}`, `{y}`, `{z}` placeholders, and optional `{scheme}` placeholder which can be `xyz` or `tms`.
 * @param {import('./utils/geo.js').BBox} opts.bounds Bounding box of the area to download
 * @param {number} opts.maxzoom Maximum zoom level to download
 * @param {(progress: TileDownloadStats) => void} [opts.onprogress] Callback to report download progress
 * @param {boolean} [opts.trackErrors=false] Include errors in the returned array of skipped tiles - this has memory overhead so should only be used for debugging.
 * @param {import('./utils/geo.js').BBox} [opts.sourceBounds=MAX_BOUNDS] Bounding box of source data.
 * @param {boolean} [opts.boundsBuffer=false] Buffer the bounds by one tile at each zoom level to ensure no tiles are missed at the edges. With this set to false, in most instances the map will appear incomplete when viewed because the downloaded tiles at lower zoom levels will not cover the map view area.
 * @param {number} [opts.minzoom=0] Minimum zoom level to download (for most cases this should be left as `0` - the size overhead is minimal, because each zoom level has 4x as many tiles)
 * @param {number} [opts.concurrency=8] Number of concurrent downloads (ignored if `fetchQueue` is provided)
 * @param {FetchQueue} [opts.fetchQueue=new FetchQueue(concurrency)] Optional fetch queue to use for downloading tiles
 * @param {'xyz' | 'tms'} [opts.scheme='xyz'] Tile scheme to use for tile URLs
 * @returns {AsyncGenerator<[import('stream').Readable, TileInfo]> & { readonly skipped: Array<TileInfo & { error?: Error }>, readonly stats: TileDownloadStats }}
 */
export function downloadTiles({
  tileUrls,
  bounds,
  maxzoom,
  onprogress = noop,
  trackErrors = false,
  sourceBounds = MAX_BOUNDS,
  boundsBuffer = false,
  minzoom = 0,
  concurrency = 8,
  fetchQueue = new FetchQueue(concurrency),
  scheme = 'xyz',
}) {
  /** @type {Array<TileInfo & { error?: Error }>} */
  const skipped = []
  let completed = 0
  /** @type {TileDownloadStats} */
  let stats = {
    total: 0,
    downloaded: 0,
    skipped: 0,
    totalBytes: 0,
  }
  /** @type {import('./utils/streams.js').ProgressCallback} */
  function onDownloadProgress({ chunkBytes }) {
    stats.totalBytes += chunkBytes
    onprogress(stats)
  }
  /**
   *
   * @param {Error} error
   * @param {TileInfo} tileInfo
   */
  function onDownloadError(error, tileInfo) {
    if (trackErrors) {
      skipped.push({ ...tileInfo, error })
    } else {
      skipped.push(tileInfo)
    }
    onprogress(stats)
  }
  function onDownloadComplete() {
    stats.downloaded = ++completed - skipped.length
    stats.skipped = skipped.length
    onprogress(stats)
  }

  /** @type {ReturnType<downloadTiles>} */
  const tiles = (async function* () {
    /** @type {Queue<[Promise<void | import('./utils/fetch.js').DownloadResponse>, TileInfo]>} */
    const queue = new Queue()
    const tiles = tileIterator({
      bounds,
      minzoom,
      maxzoom,
      sourceBounds,
      boundsBuffer,
    })
    for (const { x, y, z } of tiles) {
      const tileURL = getTileUrl(tileUrls, { x, y, z, scheme })
      const tileInfo = { z, x, y }
      const result = fetchQueue
        .fetch(tileURL, { onprogress: onDownloadProgress })
        // We handle error here rather than below to avoid uncaught errors
        .catch((err) => onDownloadError(err, tileInfo))
      queue.enqueue([result, tileInfo])
    }

    stats.total = queue.size
    if (onprogress) onprogress(stats)

    for (const [result, tileInfo] of queue) {
      // We handle any error above and add to `skipped`
      const downloadResponse = await result.catch(noop)
      if (!downloadResponse) continue
      let { body, mimeType } = downloadResponse
      body.on('end', onDownloadComplete)
      body.on('error', (err) => onDownloadError(err, tileInfo))
      /** @type {import('./writer.js').TileFormat} */
      let format
      if (mimeType) {
        format = getFormatFromMimeType(mimeType)
      } else {
        ;[format, body] = await getTileFormatFromStream(body)
      }

      let stream = body
      if (format === 'mvt') {
        // MVT tiles are always gzipped. Unfortunately we can't stop fetch from
        // ungzipping the data during download, so we need to re-gzip it.
        const gzipStream = zlib.createGzip()
        stream = body.pipe(gzipStream)
        stream.on('error', (err) => gzipStream.destroy(err))
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

/**
 *
 * @param {object} opts
 * @param {import('./utils/geo.js').BBox} opts.bounds
 * @param {import('./utils/geo.js').BBox} opts.sourceBounds
 * @param {boolean} opts.boundsBuffer
 * @param {number} opts.minzoom
 * @param {number} opts.maxzoom
 */
function* tileIterator({
  bounds,
  minzoom,
  maxzoom,
  sourceBounds,
  boundsBuffer,
}) {
  const sm = new SphericalMercator({ size: 256 })
  for (let z = minzoom; z <= maxzoom; z++) {
    let { minX, minY, maxX, maxY } = sm.xyz(bounds, z)
    let sourceXYBounds = sourceBounds
      ? sm.xyz(sourceBounds, z)
      : { minX, minY, maxX, maxY }
    const buffer = boundsBuffer ? 1 : 0
    minX = Math.max(0, minX - buffer, sourceXYBounds.minX)
    minY = Math.max(0, minY - buffer, sourceXYBounds.minY)
    maxX = Math.min(Math.pow(2, z) - 1, maxX + buffer, sourceXYBounds.maxX)
    maxY = Math.min(Math.pow(2, z) - 1, maxY + buffer, sourceXYBounds.maxY)
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        yield { x, y, z }
      }
    }
  }
}
