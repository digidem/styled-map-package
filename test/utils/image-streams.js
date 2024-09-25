// @ts-ignore
import JPEGEncoder from '@stealthybox/jpg-stream/encoder.js'
// @ts-ignore
import BlockStream from 'block-stream2'
// @ts-ignore
import PNGEncoder from 'png-stream/encoder.js'
import randomBytesReadableStream from 'random-bytes-readable-stream'

/**
 * Create a random-noise image stream with the given dimensions, either PNG or
 * JPEG.
 *
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {'png' | 'jpg'} [options.format]
 * @returns
 */
export function randomImageStream({ width, height, format = 'png' }) {
  const encoder =
    format === 'jpg'
      ? new JPEGEncoder(width, height, { colorSpace: 'rgb', quality: 30 })
      : new PNGEncoder(width, height, { colorSpace: 'rgb' })
  return (
    randomBytesReadableStream({ size: width * height * 3 })
      // JPEG Encoder requires one line at a time
      .pipe(new BlockStream({ size: width * 3 }))
      .pipe(encoder)
  )
}
