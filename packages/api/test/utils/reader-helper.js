import { replaceVariables } from '../../lib/utils/templates.js'

/** @import { Reader } from '../../lib/index.js' */

/**
 * A helper class for reading resources from a styled map package.
 * Uses the Web Crypto API for hashing (works in both Node.js 18+ and browsers).
 */
export class ReaderHelper {
  #reader
  /** @type {Awaited<ReturnType<Reader['getStyle']>> | undefined} */
  #style
  #crypto = globalThis.crypto
  /** @param {Reader} reader */
  constructor(reader) {
    this.#reader = reader
  }

  /** @param {string} path */
  async #digest(path) {
    const resource = await this.#reader.getResource(path)
    const chunks = /** @type {Uint8Array[]} */ ([])
    const reader = resource.stream.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value))
    }
    const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0)
    const buf = new Uint8Array(totalLen)
    let off = 0
    for (const chunk of chunks) {
      buf.set(chunk, off)
      off += chunk.byteLength
    }
    if (!this.#crypto) {
      // @ts-ignore
      this.#crypto = (await import('crypto')).webcrypto
    }
    const hashBuf = await this.#crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * @param {{ z: number, x: number, y: number, sourceId: string }} opts
   */
  async getTileHash({ z, x, y, sourceId }) {
    const style = this.#style || (this.#style = await this.#reader.getStyle(''))
    const source = style.sources[sourceId]
    if (!source || !('tiles' in source) || !source.tiles) {
      throw new Error(`Source not found: ${sourceId}`)
    }
    const tilePath = replaceVariables(source.tiles[0], { z, x, y })
    return this.#digest(tilePath)
  }

  /**
   * @param {import('../../lib/writer.js').GlyphInfo} glyphInfo
   */
  async getGlyphHash({ font, range }) {
    const style = this.#style || (this.#style = await this.#reader.getStyle(''))
    if (typeof style.glyphs !== 'string') {
      throw new Error('No glyphs defined in style')
    }
    const glyphPath = replaceVariables(style.glyphs, { fontstack: font, range })
    return this.#digest(glyphPath)
  }

  /** @param {{ id?: string, pixelRatio?: 1 | 2 | 3, ext: 'json' | 'png'}} opts */
  async getSpriteHash({ id, pixelRatio = 1, ext }) {
    const style = this.#style || (this.#style = await this.#reader.getStyle(''))
    if (!style.sprite) {
      throw new Error('No sprites defined in style')
    }
    const pixelRatioString = pixelRatio === 1 ? '' : `@${pixelRatio}x`
    let spritePath
    if (typeof style.sprite === 'string') {
      spritePath = style.sprite + pixelRatioString + '.' + ext
    } else {
      const sprite = style.sprite.find((s) => s.id === (id || 'default'))
      if (!sprite) {
        throw new Error(`Sprite not found: ${id}`)
      }
      spritePath = sprite.url + pixelRatioString + '.' + ext
    }
    return this.#digest(spritePath)
  }
}
