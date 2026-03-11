import { MBTiles } from 'mbtiles-reader'

import { readableFromAsync } from './utils/streams.js'
import { Writer } from './writer.js'

const SOURCE_ID = 'mbtiles-source'

/**
 * Convert a MBTiles file to a styled map package, returned as a web
 * ReadableStream.
 *
 * @param {string} mbtilesPath
 * @returns {ReadableStream<Uint8Array>}
 */
export function fromMBTiles(mbtilesPath) {
  const reader = new MBTiles(mbtilesPath)
  if (reader.metadata.format === 'pbf') {
    throw new Error('Vector MBTiles are not yet supported')
  }
  const style = {
    version: 8,
    name: reader.metadata.name,
    sources: {
      [SOURCE_ID]: {
        ...reader.metadata,
        type: 'raster',
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

  const writer = new Writer(style)

  ;(async () => {
    try {
      await readableFromAsync(mbtilesToTileArgs(reader)).pipeTo(
        writer.createTileWriteStream(),
      )
      writer.finish()
    } catch (err) {
      writer.abort(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return writer.outputStream
}

/**
 * @param {MBTiles} mbtiles
 */
async function* mbtilesToTileArgs(mbtiles) {
  for (const { z, x, y, data, format } of mbtiles) {
    yield [data, { z, x, y, format, sourceId: SOURCE_ID }]
  }
}
