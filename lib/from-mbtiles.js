import { MBTiles } from 'mbtiles-reader'
import SMPWriter from 'styled-map-package/writer'

import fs from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream'
import { pipeline as pipelinePromise } from 'node:stream/promises'

const SOURCE_ID = 'mbtiles-source'

/**
 * @overload
 * @param {string} mbtilesPath
 * @returns {import('stream').Readable}
 */

/**
 * @overload
 * @param {string} mbtilesPath
 * @param {string} outputPath
 * @returns {Promise<void>}
 */

/**
 * @param {string} mbtilesPath
 * @param {string} [outputPath]
 * @returns {Promise<void> | import('stream').Readable}
 */
export default function fromMBTiles(mbtilesPath, outputPath) {
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

  const writer = new SMPWriter(style)

  const returnValue = outputPath
    ? pipelinePromise(writer.outputStream, fs.createWriteStream(outputPath))
    : writer.outputStream

  const tileWriteStream = writer.createTileWriteStream()

  const transform = new Transform({
    objectMode: true,
    transform({ z, x, y, data, format }, encoding, callback) {
      callback(null, [data, { z, x, y, format, sourceId: SOURCE_ID }])
    },
  })

  pipeline(reader, transform, tileWriteStream, (err) => {
    if (err) return writer.outputStream.destroy(err)
    writer.finish()
  })

  return returnValue
}
