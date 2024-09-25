import { once } from 'node:events'

import { replaceVariables } from '../../lib/utils/templates.js'
import { DigestStream } from './digest-stream.js'

/** @import { Reader } from '../../lib/index.js' */
/**
 * A helper class for reading resources from a styled map package.
 */
export class ReaderHelper {
  #reader
  /** @type {Awaited<ReturnType<Reader['getStyle']>> | undefined} */
  #style
  /** @param {Reader} reader */
  constructor(reader) {
    this.#reader = reader
  }

  /** @param {string} path */
  async #digest(path) {
    const resource = await this.#reader.getResource(path)
    const digestStream = new DigestStream('md5')
    resource.stream.pipe(digestStream).resume()
    await once(digestStream, 'finish')
    return digestStream.digest('hex')
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

  /** @param {{ id?: string, pixelRatio?: `@${number}x` | ``, ext: 'json' | 'png'}} opts */
  async getSpriteHash({ id, pixelRatio = '', ext }) {
    const style = this.#style || (this.#style = await this.#reader.getStyle(''))
    if (!style.sprite) {
      throw new Error('No sprites defined in style')
    }
    let spritePath
    if (typeof style.sprite === 'string') {
      spritePath = style.sprite + pixelRatio + '.' + ext
    } else {
      const sprite = style.sprite.find((s) => s.id === (id || 'default'))
      if (!sprite) {
        throw new Error(`Sprite not found: ${id}`)
      }
      spritePath = sprite.url + pixelRatio + '.' + ext
    }
    return this.#digest(spritePath)
  }
}
