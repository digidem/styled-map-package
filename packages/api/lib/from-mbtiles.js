import { MBTiles } from 'mbtiles-reader'

import { noop } from './utils/misc.js'
import { readableFromAsync } from './utils/streams.js'
import { Writer } from './writer.js'

const SOURCE_ID = 'mbtiles-source'

/**
 * Convert a MBTiles file to a styled map package, returned as a web
 * ReadableStream. The async MBTiles.open() happens lazily inside the
 * stream's start(), so this function is synchronous.
 *
 * Requires Node >= 20 (uses better-sqlite3 which dropped Node 18 support).
 *
 * @param {string | ArrayBuffer | Uint8Array} source MBTiles source — file path
 *   (Node), OPFS path (browser Worker), or in-memory buffer.
 * @returns {ReadableStream<Uint8Array>}
 */
export function fromMBTiles(source) {
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
  let outputReader
  /** @type {Promise<void> | undefined} */
  let conversionDone
  const pipeAbort = new AbortController()

  return new ReadableStream({
    async start() {
      const reader = await MBTiles.open(source)
      if (reader.metadata.format === 'pbf') {
        throw new Error('Vector MBTiles are not yet supported')
      }
      const {
        name,
        minzoom,
        maxzoom,
        scheme,
        attribution,
        description,
        version: tilesetVersion,
      } = reader.metadata
      /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */
      const style = {
        version: 8,
        name,
        sources: {
          [SOURCE_ID]: {
            type: 'raster',
            tileSize: 256,
            minzoom,
            maxzoom,
            scheme,
            attribution,
          },
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': 'white',
            },
          },
          {
            id: 'raster',
            type: 'raster',
            source: SOURCE_ID,
            paint: {
              'raster-opacity': 1,
            },
          },
        ],
      }

      if (description || tilesetVersion) {
        style.metadata = {
          'mbtiles:description': description,
          'mbtiles:version': tilesetVersion,
        }
      }

      const writer = new Writer(style)
      outputReader = writer.outputStream.getReader()

      conversionDone = (async () => {
        try {
          await readableFromAsync(mbtilesToTileArgs(reader)).pipeTo(
            writer.createTileWriteStream(),
            { signal: pipeAbort.signal },
          )
          writer.finish()
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
      const { done, value } =
        await /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (
          outputReader
        ).read()
      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    },
    async cancel(reason) {
      pipeAbort.abort(reason)
      await conversionDone
      await /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (
        outputReader
      )
        .cancel(reason)
        .catch(noop)
    },
  })
}

/**
 * @param {MBTiles} mbtiles
 */
async function* mbtilesToTileArgs(mbtiles) {
  for (const { z, x, y, data, format } of mbtiles) {
    yield [data, { z, x, y, format, sourceId: SOURCE_ID }]
  }
}
