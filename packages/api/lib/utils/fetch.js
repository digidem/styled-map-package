import ky from 'ky'
import pLimit from 'p-limit'

import { ProgressStream } from './streams.js'

/**
 * @typedef {object} DownloadResponse
 * @property {ReadableStream<Uint8Array>} body Web ReadableStream of the response body
 * @property {string | null} mimeType Content mime-type (from http content-type header)
 * @property {number | null} contentLength Content length in bytes (from http content-length header)
 */

/**
 * A wrapper for fetch that limits the number of concurrent downloads.
 */
export class FetchQueue {
  /** @type {import('p-limit').LimitFunction} */
  #limit
  /** @param {number} concurrency */
  constructor(concurrency) {
    this.#limit = pLimit(concurrency)
  }

  get activeCount() {
    return this.#limit.activeCount
  }

  /**
   * Fetch a URL, limiting the number of concurrent downloads. Resolves with a
   * `DownloadResponse`, which is a parsed from the Fetch `Response` objects,
   * with `body` as a web ReadableStream, and the MIME type and content length
   * of the response.
   *
   * NB: The response body stream must be consumed to the end, otherwise the
   * queue will never be emptied.
   *
   * @param {string} url
   * @param {{ onprogress?: import('./streams.js').ProgressCallback }} opts
   * @returns {Promise<DownloadResponse>}
   */
  fetch(url, { onprogress } = {}) {
    // This is wrapped like this so that pLimit limits concurrent `fetchStream`
    // calls, which only resolve when the body is completely downloaded, but
    // this method will return a response as soon as it is available. NB: If the
    // body of a response is never "consumed" (e.g. by reading it to the end),
    // the fetchStream function will never resolve, and the limit will never be
    // released.
    return new Promise((resolveResponse, rejectResponse) => {
      this.#limit(fetchStream, {
        url,
        onresponse: resolveResponse,
        onerror: rejectResponse,
        onprogress,
      })
    })
  }
}

/**
 * This will resolve when the download is complete, regardless of success or
 * failure, but a readable stream is available before download via the
 * onReadStream param. This strange function signature is used for limiting the
 * number of simultaneous downloads, but still being able to expose the Response
 * as soon as it is available. This is implmented this way to avoid creating
 * unnecessary closures, which is important here because we can have thousands
 * of tile requests.
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {(response: DownloadResponse) => void} opts.onresponse
 * @param {(err: Error) => void} opts.onerror
 * @param {import('./streams.js').ProgressCallback} [opts.onprogress]
 * @returns {Promise<void>}
 */
async function fetchStream({ url, onresponse, onerror, onprogress }) {
  try {
    const response = await ky(url, { retry: 3 })
    if (!response.body) {
      throw new Error('No body in response')
    }
    const contentType = response.headers.get('content-type')
    const mimeType =
      typeof contentType === 'string' ? contentType.split(';')[0] : null
    const contentLengthHeader = response.headers.get('content-length')
    const contentLength =
      contentLengthHeader === null ? null : parseInt(contentLengthHeader, 10)

    const passthrough = new TransformStream()
    // pipeTo resolves when the body is fully consumed (respects backpressure),
    // which releases the pLimit slot for the next download
    const pipePromise = response.body.pipeTo(passthrough.writable)

    let body = passthrough.readable
    if (onprogress) {
      const progress = new ProgressStream({ onprogress })
      body = body.pipeThrough(progress)
    }

    onresponse({ body, mimeType, contentLength })
    await pipePromise
  } catch (err) {
    onerror(err instanceof Error ? err : new Error('Unknown error'))
  }
}
