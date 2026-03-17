import { InvalidArgumentError } from 'commander'

/**
 * @param {string} z
 * @returns {number}
 */
export function parseZoom(z) {
  const zoom = parseInt(z)
  if (isNaN(zoom) || zoom < 0 || zoom > 22) {
    throw new InvalidArgumentError(
      'Zoom must be a whole number (integer) between 0 and 22.',
    )
  }
  return zoom
}

/**
 * @param {string} bbox
 * @returns {[number, number, number, number]}
 */
export function parseBbox(bbox) {
  const bounds = bbox.split(',').map((s) => parseFloat(s.trim()))
  if (bounds.length !== 4) {
    throw new InvalidArgumentError(
      'Bounding box must have 4 values separated by commas.',
    )
  }
  if (bounds.some(isNaN)) {
    throw new InvalidArgumentError('Bounding box values must be numbers.')
  }
  return /** @type {[number, number, number, number]} */ (bounds)
}

/**
 * @param {string} url
 * @returns {string}
 */
export function parseUrl(url) {
  try {
    return new URL(url).toString()
  } catch (e) {
    const message =
      e !== null &&
      typeof e === 'object' &&
      'message' in e &&
      typeof e.message === 'string'
        ? e.message
        : 'Invalid URL'
    throw new InvalidArgumentError(message)
  }
}

/**
 * @typedef {object} DownloadOptions
 * @property {string | undefined} styleUrl
 * @property {[number, number, number, number] | undefined} bbox
 * @property {number | undefined} zoom
 * @property {string | undefined} output
 * @property {string | undefined} token
 */

/**
 * @typedef {object} DownloadDeps
 * @property {(opts: any) => ReadableStream} download
 * @property {{ input: (opts: any) => Promise<string>, number: (opts: any) => Promise<number | undefined> }} prompt
 * @property {(output: string | undefined) => WritableStream | import('node:fs').WriteStream} createOutputStream
 * @property {() => { write: (p: any) => void }} reporter
 * @property {(url: string) => boolean} isMapboxURL
 * @property {string} mapboxApiUrl
 * @property {boolean} isTTY
 */

/**
 * @param {DownloadOptions} options
 * @param {DownloadDeps} deps
 */
export async function runDownload(
  { styleUrl, bbox, zoom, output, token },
  deps,
) {
  const { download, prompt, isMapboxURL, mapboxApiUrl, isTTY } = deps

  const promptOutput =
    !output && isTTY && (!styleUrl || !bbox || zoom === undefined)

  if (!styleUrl) {
    styleUrl = await prompt.input({
      message: 'Style URL to download',
      required: true,
      validate: (/** @type {string} */ value) => {
        try {
          new URL(value)
          return true
        } catch {
          return 'Please enter a valid URL.'
        }
      },
    })
  }

  if (!bbox) {
    const west = await prompt.number({
      message: 'Bounding box west',
      required: true,
      step: 'any',
      min: -180,
      max: 180,
    })
    const south = await prompt.number({
      message: 'Bounding box south',
      required: true,
      step: 'any',
      min: -90,
      max: 90,
    })
    const east = await prompt.number({
      message: 'Bounding box east',
      required: true,
      step: 'any',
      min: -180,
      max: 180,
    })
    const north = await prompt.number({
      message: 'Bounding box north',
      required: true,
      step: 'any',
      min: -90,
      max: 90,
    })
    if (
      west === undefined ||
      south === undefined ||
      east === undefined ||
      north === undefined
    ) {
      throw new InvalidArgumentError('Bounding box values are required.')
    }
    bbox = [west, south, east, north]
  }

  if (zoom === undefined) {
    zoom = await prompt.number({
      message: 'Max zoom level to download',
      required: true,
      min: 0,
      max: 22,
    })
    if (zoom === undefined) {
      throw new InvalidArgumentError('Zoom level is required.')
    }
  }

  if ((isMapboxURL(styleUrl) || styleUrl.startsWith(mapboxApiUrl)) && !token) {
    token = await prompt.input({
      message: 'Mapbox access token',
      required: true,
    })
  }

  if (promptOutput) {
    output = await prompt.input({
      message: 'Output filename (.smp extension will be added)',
      required: true,
      transformer: (/** @type {string} */ value) =>
        value.endsWith('.smp') ? value : `${value}.smp`,
    })
  }

  if (output && !output.endsWith('.smp')) {
    output += '.smp'
  }

  const reporter = deps.reporter()
  const readStream = download({
    bbox,
    maxzoom: zoom,
    styleUrl,
    onprogress: (/** @type {any} */ p) => reporter.write(p),
    accessToken: token,
  })
  const outputStream = deps.createOutputStream(output)
  await readStream.pipeTo(
    outputStream instanceof WritableStream
      ? outputStream
      : // @ts-ignore - Writable.toWeb compatibility
        outputStream,
  )
}
