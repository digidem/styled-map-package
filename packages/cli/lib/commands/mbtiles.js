/**
 * @typedef {object} MbtilesOptions
 * @property {string} mbtilesPath
 * @property {string | undefined} output
 */

/**
 * @typedef {object} MbtilesDeps
 * @property {(path: string) => ReadableStream} fromMBTiles
 * @property {(output: string | undefined) => WritableStream} createOutputStream
 */

/**
 * @param {MbtilesOptions} options
 * @param {MbtilesDeps} deps
 */
export async function runMbtiles({ mbtilesPath, output }, deps) {
  const readStream = deps.fromMBTiles(mbtilesPath)
  const outputStream = deps.createOutputStream(output)
  await readStream.pipeTo(outputStream)
}
