import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Custom Vitest browser command: list files in a directory.
 * Runs on the Vitest server (Node.js) side.
 *
 * @param {import('vitest/node').BrowserCommandContext} ctx
 * @param {string} dir - path relative to project root
 * @returns {Promise<string[]>}
 */
export async function readdir(ctx, dir) {
  const root = /** @type {any} */ (ctx).project?.config?.root ?? process.cwd()
  return fs.readdir(path.resolve(root, dir))
}

/**
 * Custom Vitest browser command: generate a random noise image using Sharp.
 * Runs on the Vitest server (Node.js) side, returns the image as a base64
 * string so the browser can decode it into a Uint8Array.
 *
 * @param {import('vitest/node').BrowserCommandContext} _ctx
 * @param {{ width: number, height: number, format: 'png' | 'jpg' }} opts
 * @returns {Promise<string>} base64-encoded image data
 */
export async function randomImage(_ctx, { width, height, format }) {
  const { default: sharp } = await import('sharp')
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
      noise: { type: 'gaussian', mean: 128, sigma: 32 },
    },
  })
    .toFormat(format)
    .toBuffer()
  return buffer.toString('base64')
}
