import { StyleDownloader } from './style-downloader.js'
import { noop } from './utils/misc.js'
import { readableFromAsync } from './utils/streams.js'
import { Writer } from './writer.js'

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
 * @param {Readonly<import("./utils/geo.js").BBox>} opts.bbox Bounding box to download tiles for
 * @param {number} opts.maxzoom Max zoom level to download tiles for
 * @param {string} opts.styleUrl URL of the style to download
 * @param { (progress: DownloadProgress) => void } [opts.onprogress] Optional callback for reporting progress
 * @param {string} [opts.mapboxAccessToken]
 * @param {boolean} [opts.skipLocalGlyphs] Skip glyph ranges rendered client-side by MapLibre GL via localIdeographFontFamily (CJK, Hangul, Kana, Yi, etc.)
 * @param {boolean} [opts.dedupe] When true, duplicate tiles are stored only once (see {@link Writer})
 * @param {AbortSignal} [opts.signal] AbortSignal to cancel the download
 * @returns {import('./types.js').DownloadStream} Readable stream of the output styled map file
 */
export function download({
  bbox,
  maxzoom,
  styleUrl,
  onprogress,
  mapboxAccessToken,
  skipLocalGlyphs,
  dedupe,
  signal: signalExt,
}) {
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
  let outputReader
  /** @type {Promise<void> | undefined} */
  let downloadDone
  const pipeAbort = new AbortController()
  const signal = signalExt
    ? AbortSignal.any([signalExt, pipeAbort.signal])
    : pipeAbort.signal

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

  /** @param {Partial<DownloadProgress>} update */
  function handleProgress(update) {
    progress = { ...progress, ...update, elapsedMs: Date.now() - start }
    onprogress?.(progress)
  }

  return new ReadableStream({
    async start() {
      if (signal?.aborted) {
        throw (
          signal.reason ||
          new DOMException('The operation was aborted.', 'AbortError')
        )
      }

      const downloader = new StyleDownloader(styleUrl, {
        concurrency: 24,
        mapboxAccessToken,
      })

      const style = await downloader.getStyle()
      handleProgress({ style: { done: true } })

      const writer = new Writer(style, { dedupe: !!dedupe })
      outputReader = writer.outputStream.getReader()

      downloadDone = (async () => {
        try {
          for await (const spriteInfo of downloader.getSprites()) {
            await writer.addSprite(spriteInfo)
            handleProgress({
              sprites: {
                downloaded: progress.sprites.downloaded + 1,
                done: false,
              },
            })
          }
          handleProgress({ sprites: { ...progress.sprites, done: true } })

          const tiles = downloader.getTiles({
            bounds: bbox,
            maxzoom,
            onprogress: (tileStats) =>
              handleProgress({ tiles: { ...tileStats, done: false } }),
          })
          await readableFromAsync(tiles).pipeTo(
            writer.createTileWriteStream({ concurrency: 24 }),
            { signal },
          )
          handleProgress({ tiles: { ...progress.tiles, done: true } })

          const glyphs = downloader.getGlyphs({
            skipLocalGlyphs,
            onprogress: (glyphStats) =>
              handleProgress({ glyphs: { ...glyphStats, done: false } }),
          })
          await readableFromAsync(glyphs).pipeTo(
            writer.createGlyphWriteStream(),
            { signal },
          )
          handleProgress({ glyphs: { ...progress.glyphs, done: true } })

          await writer.finish()
        } catch (err) {
          try {
            writer.abort(err instanceof Error ? err : new Error(String(err)))
          } catch {
            // Output stream may already be cancelled/errored
          }
        }
      })()
    },
    async pull(controller) {
      if (!outputReader) {
        controller.error(
          new Error('Output reader not initialized. This is a bug.'),
        )
        return
      }
      const { done, value } = await outputReader.read()
      if (done) {
        controller.close()
        handleProgress({ output: { ...progress.output, done: true } })
      } else {
        handleProgress({
          output: {
            totalBytes: progress.output.totalBytes + value.byteLength,
            done: false,
          },
        })
        controller.enqueue(value)
      }
    },
    async cancel(reason) {
      pipeAbort.abort(reason)
      await downloadDone
      await outputReader?.cancel(reason).catch(noop)
    },
  })
}
