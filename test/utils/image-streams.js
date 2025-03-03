import sharp from 'sharp'

/**
 * Create a random-noise image stream with the given dimensions, either PNG or
 * JPEG.
 *
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {'png' | 'jpg'} options.format
 * @returns
 */
export function randomImageStream({ width, height, format }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
      noise: {
        type: 'gaussian',
        mean: 128,
        sigma: 32,
      },
    },
  }).toFormat(format)
}
