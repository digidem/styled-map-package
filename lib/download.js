import { Transform } from 'readable-stream'
import { pipeline } from 'stream/promises'

import Writer from '../lib/writer.js'
import StyleDownloader from './style-downloader.js'

/**
 * @typedef {object} DownloadProgress
 * @property {import('./tile-downloader.js').TileDownloadStats & { done: boolean }} tiles
 * @property {{ done: boolean }} style
 * @property {{ downloaded: number, done: boolean }} sprites
 * @property {import('./style-downloader.js').GlyphDownloadStats & { done: boolean }} glyphs
 * @property {{ totalBytes: number, done: boolean }} output
 * @property {number} elapsedMs
 */

/**
 * Download a map style and its resources for a given bounding box and max zoom
 * level. Returns a readable stream of a "styled map package", a zip file
 * containing all the resources needed to serve the style offline.
 *
 * @param {object} opts
 * @param {import("./utils/geo.js").BBox} opts.bbox Bounding box to download tiles for
 * @param {number} opts.maxzoom Max zoom level to download tiles for
 * @param {string} opts.styleUrl URL of the style to download
 * @param { (progress: DownloadProgress) => void } [opts.onprogress] Optional callback for reporting progress
 * @param {string} [opts.accessToken]
 * @returns {import('./types.js').DownloadStream} Readable stream of the output styled map file
 */
export default function download({
  bbox,
  maxzoom,
  styleUrl,
  onprogress,
  accessToken,
}) {
  const downloader = new StyleDownloader(styleUrl, {
    concurrency: 24,
    mapboxAccessToken: accessToken,
  })

  let start = Date.now()
  /** @type {DownloadProgress} */
  let progress = {
    tiles: { downloaded: 0, totalBytes: 0, total: 0, skipped: 0, done: false },
    style: { done: false },
    sprites: { downloaded: 0, done: false },
    glyphs: { downloaded: 0, total: 0, totalBytes: 0, done: false },
    output: { totalBytes: 0, done: false },
    elapsedMs: 0,
  }

  const sizeCounter = new Transform({
    transform(chunk, encoding, cb) {
      handleProgress({
        output: {
          totalBytes: progress.output.totalBytes + chunk.length,
          done: false,
        },
      })
      cb(null, chunk)
    },
    final(cb) {
      handleProgress({ output: { ...progress.output, done: true } })
      cb()
    },
  })

  /** @param {Partial<DownloadProgress>} update */
  function handleProgress(update) {
    progress = { ...progress, ...update, elapsedMs: Date.now() - start }
    onprogress?.(progress)
  }

  ;(async () => {
    const style = await downloader.getStyle()
    const writer = new Writer(style)
    writer.outputStream.pipe(sizeCounter)
    writer.on('error', (err) => sizeCounter.destroy(err))

    try {
      for await (const [sourceId, source] of downloader.getSources()) {
        writer.addSource(sourceId, source)
      }
      handleProgress({ style: { done: true } })

      for await (const spriteInfo of downloader.getSprites()) {
        await writer.addSprite(spriteInfo)
        handleProgress({
          sprites: { downloaded: progress.sprites.downloaded + 1, done: false },
        })
      }
      handleProgress({ sprites: { ...progress.sprites, done: true } })

      const tiles = downloader.getTiles({
        bounds: bbox,
        maxzoom,
        onprogress: (tileStats) =>
          handleProgress({ tiles: { ...tileStats, done: false } }),
      })
      await pipeline(tiles, writer.createTileWriteStream({ concurrency: 24 }))
      handleProgress({ tiles: { ...progress.tiles, done: true } })

      const glyphs = downloader.getGlyphs({
        onprogress: (glyphStats) =>
          handleProgress({ glyphs: { ...glyphStats, done: false } }),
      })
      await pipeline(glyphs, writer.createGlyphWriteStream())
      handleProgress({ glyphs: { ...progress.glyphs, done: true } })

      writer.finish()
    } catch (err) {
      writer.outputStream.destroy(/** @type {Error} */ (err))
    }
  })()

  return sizeCounter
}
