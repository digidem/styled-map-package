import { StyleDownloader } from './style-downloader.js'
import { GlyphRangeCollector } from './utils/glyph-ranges.js'
import { noop } from './utils/misc.js'
import { readableFromAsync, writeStreamFromAsync } from './utils/streams.js'
import { isProvidedByCaller } from './utils/templates.js'
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
 * The {@link Writer} methods available to `beforeFinish`. Finishing and the
 * output stream stay with `download()`.
 *
 * @typedef {Pick<Writer, 'addTile' | 'addSprite' | 'addGlyphs' | 'setMetadata' | 'createTileWriteStream' | 'createGlyphWriteStream'>} BeforeFinishWriter
 */

/**
 * @typedef {object} BeforeFinishContext
 * @property {AbortSignal} signal Aborted when the download is cancelled
 * @property {number[] | undefined} glyphRanges Start codepoints of the glyph ranges needed for the labels in the downloaded tiles, or `undefined` if every range is needed. Always `undefined` when a source with `smp:` tiles has labels, since tiles added in `beforeFinish` are not scanned.
 */

/**
 * @typedef {object} DownloadOptionsBase
 * @property {Readonly<import("./utils/geo.js").BBox>} bbox Bounding box to download tiles for
 * @property {number} maxzoom Max zoom level to download tiles for
 * @property { (progress: DownloadProgress) => void } [onprogress] Optional callback for reporting progress
 * @property {string} [mapboxAccessToken]
 * @property {boolean} [skipLocalGlyphs] Skip glyph ranges rendered client-side by MapLibre GL via localIdeographFontFamily (CJK, Hangul, Kana, Yi, etc.)
 * @property {boolean} [allGlyphRanges] Download every glyph range, rather than only the ranges needed for the labels in the downloaded tiles
 * @property {boolean} [dedupe] When true, duplicate tiles are stored only once (see {@link Writer})
 * @property {number} [bufferTiles=0] Number of extra tile rings to download around `bbox` at each zoom level below maxzoom, so the map is not clipped at the edges of the downloaded area when zooming out. Recorded in the package as `metadata['smp:bufferTiles']`.
 * @property {(writer: BeforeFinishWriter, context: BeforeFinishContext) => void | Promise<void>} [beforeFinish] Called once everything is downloaded, before the package is finished, to add resources that the style references by `smp://` URL, which are not downloaded. Throw to fail the download.
 * @property {AbortSignal} [signal] AbortSignal to cancel the download. No further requests are issued once aborted; cancel the returned stream to release downloads already in progress.
 */

/**
 * @typedef {DownloadOptionsBase & import('./types.js').DownloadStyleOptions} DownloadOptions
 */

/**
 * Download a map style and its resources for a given bounding box and max zoom
 * level. Returns a readable stream of a "styled map package", a zip file
 * containing all the resources needed to serve the style offline.
 *
 * @param {DownloadOptions} opts
 * @returns {import('./types.js').DownloadStream} Readable stream of the output styled map file
 */
export function download({
  bbox,
  maxzoom,
  style: styleInput,
  styleUrl,
  beforeFinish,
  onprogress,
  mapboxAccessToken,
  skipLocalGlyphs,
  allGlyphRanges,
  dedupe,
  bufferTiles = 0,
  signal: signalExt,
}) {
  const styleSource = styleInput ?? styleUrl
  if (!styleSource) throw new TypeError('download() requires a style')
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
    if (signal.aborted) return
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

      const downloader = new StyleDownloader(styleSource, {
        concurrency: 24,
        mapboxAccessToken,
      })

      const style = await downloader.getStyle()
      const provided = getProvidedResources(style)
      if (!beforeFinish && provided.descriptions.length > 0) {
        throw new Error(
          `The style references ${provided.descriptions.join(', ')} with smp: URLs, which are not downloaded: add them with beforeFinish`,
        )
      }
      handleProgress({ style: { done: true } })

      const writer = new Writer(style, { dedupe: !!dedupe })
      outputReader = writer.outputStream.getReader()

      downloadDone = (async () => {
        try {
          for await (const spriteInfo of downloader.getSprites({ signal })) {
            await writer.addSprite(spriteInfo)
            handleProgress({
              sprites: {
                downloaded: progress.sprites.downloaded + 1,
                done: false,
              },
            })
          }
          handleProgress({ sprites: { ...progress.sprites, done: true } })

          const glyphRanges = allGlyphRanges
            ? undefined
            : new GlyphRangeCollector(style)
          // Tiles added in beforeFinish are not scanned for label text
          if (provided.sourceIds.some((id) => glyphRanges?.wantsTile(id))) {
            glyphRanges?.setNeedsAllRanges()
          }
          const tiles = downloader.getTiles({
            bounds: bbox,
            maxzoom,
            bufferTiles,
            signal,
            onTileData: glyphRanges
              ? (data, sourceId) => glyphRanges.addTile(data, sourceId)
              : undefined,
            onprogress: (tileStats) =>
              handleProgress({ tiles: { ...tileStats, done: false } }),
          })
          await readableFromAsync(tiles).pipeTo(
            writer.createTileWriteStream({ concurrency: 24 }),
            { signal },
          )
          handleProgress({ tiles: { ...progress.tiles, done: true } })

          const ranges = glyphRanges?.getRanges() ?? undefined
          if (ranges && style.glyphs && !provided.glyphs) {
            writer.setMetadata('smp:glyphRanges', 'used')
          }
          const glyphs = downloader.getGlyphs({
            skipLocalGlyphs,
            ranges,
            signal,
            onprogress: (glyphStats) =>
              handleProgress({ glyphs: { ...glyphStats, done: false } }),
          })
          await readableFromAsync(glyphs).pipeTo(
            writer.createGlyphWriteStream(),
            { signal },
          )
          handleProgress({ glyphs: { ...progress.glyphs, done: true } })

          if (beforeFinish) {
            /** @type {Set<string>} */
            const addedSourceIds = new Set()
            await beforeFinish(toBeforeFinishWriter(writer, addedSourceIds), {
              signal,
              glyphRanges: ranges,
            })
            const missing = provided.sourceIds.filter(
              (id) => !addedSourceIds.has(id),
            )
            if (missing.length > 0) {
              throw new Error(
                `beforeFinish added no tiles for ${missing.map((id) => `source "${id}"`).join(', ')}, which the style references with smp: tiles`,
              )
            }
          }
          signal.throwIfAborted()
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
      // Release the output before awaiting the download: `addTile` blocks
      // writing into the zip stream while nobody reads it, which blocks the
      // tile pipe's abort, which is what `downloadDone` is waiting on.
      await outputReader?.cancel(reason).catch(noop)
      await downloadDone
    },
  })
}

/**
 * Resources that the style references with `smp:` URLs, which the caller adds
 * in `beforeFinish` rather than them being downloaded.
 *
 * @param {Awaited<ReturnType<StyleDownloader['getStyle']>>} style
 */
function getProvidedResources(style) {
  const sprites =
    typeof style.sprite === 'string'
      ? [{ id: 'default', url: style.sprite }]
      : (style.sprite ?? [])
  const sourceIds = Object.entries(style.sources)
    .filter(
      ([, source]) =>
        (source.type === 'vector' || source.type === 'raster') &&
        isProvidedByCaller(source.tiles),
    )
    .map(([id]) => id)
  const spriteIds = sprites
    .filter(({ url }) => isProvidedByCaller(url))
    .map(({ id }) => id)
  const glyphs = isProvidedByCaller(style.glyphs)
  const descriptions = [
    ...sourceIds.map((id) => `source "${id}"`),
    ...spriteIds.map((id) => `sprite "${id}"`),
    ...(glyphs ? ['glyphs'] : []),
  ]
  return { sourceIds, glyphs, descriptions }
}

/**
 * @param {Writer} writer
 * @param {Set<string>} addedSourceIds Updated with the source of each tile added
 * @returns {BeforeFinishWriter}
 */
function toBeforeFinishWriter(writer, addedSourceIds) {
  /** @type {Writer['addTile']} */
  const addTile = async (tileData, tileInfo) => {
    await writer.addTile(tileData, tileInfo)
    addedSourceIds.add(tileInfo.sourceId)
  }
  return {
    addTile,
    addSprite: writer.addSprite.bind(writer),
    addGlyphs: writer.addGlyphs.bind(writer),
    setMetadata: writer.setMetadata.bind(writer),
    createTileWriteStream: ({ concurrency = 16 } = {}) =>
      writeStreamFromAsync(addTile, { concurrency }),
    createGlyphWriteStream: writer.createGlyphWriteStream.bind(writer),
  }
}
