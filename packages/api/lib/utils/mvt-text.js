// Minimal protobuf walker for Mapbox Vector Tiles (spec v2) that only reads
// layer names, keys, string values and feature tags, skipping geometry.
// https://github.com/mapbox/vector-tile-spec/blob/master/2.1/vector_tile.proto

const WIRE_VARINT = 0
const WIRE_I64 = 1
const WIRE_LEN = 2
const WIRE_I32 = 5

const TILE_LAYERS = 3
const LAYER_NAME = 1
const LAYER_FEATURES = 2
const LAYER_KEYS = 3
const LAYER_VALUES = 4
const FEATURE_TAGS = 2
const VALUE_STRING = 1

const textDecoder = new TextDecoder()

/**
 * Property keys to read per source-layer name. `null` reads every string value
 * in the layer. Layers missing from the map are skipped.
 *
 * @typedef {Map<string, Set<string> | null>} LayerKeys
 */

/**
 * Call `onText` for string property values in an uncompressed vector tile.
 * Each distinct value is reported at most once per layer. Throws on malformed
 * data.
 *
 * @param {Uint8Array} buf
 * @param {LayerKeys} layerKeys
 * @param {(text: string) => void} onText
 */
export function scanTileText(buf, layerKeys, onText) {
  const reader = new Reader(buf, 0, buf.length)
  while (reader.pos < reader.end) {
    const tag = reader.varint()
    if (tag === ((TILE_LAYERS << 3) | WIRE_LEN)) {
      const layer = reader.subReader()
      scanLayer(layer, layerKeys, onText)
    } else {
      reader.skip(tag)
    }
  }
}

/**
 * @param {Reader} reader
 * @param {LayerKeys} layerKeys
 * @param {(text: string) => void} onText
 */
function scanLayer(reader, layerKeys, onText) {
  const start = reader.pos
  // The spec does not fix field order, so find the name before reading values
  /** @type {string | undefined} */
  let name
  while (reader.pos < reader.end) {
    const tag = reader.varint()
    if (tag === ((LAYER_NAME << 3) | WIRE_LEN)) {
      name = reader.string()
      break
    }
    reader.skip(tag)
  }
  if (name === undefined || !layerKeys.has(name)) return
  const wantedKeys = layerKeys.get(name)
  reader.pos = start

  /** @type {boolean[]} */
  const keyWanted = []
  // Byte offsets of string values, decoded only if a wanted key uses them
  /** @type {number[]} */
  const valueSpans = []
  /** @type {Reader[]} */
  const packedTags = []
  /** @type {number[]} */
  const unpackedTags = []
  while (reader.pos < reader.end) {
    const tag = reader.varint()
    if (tag === ((LAYER_VALUES << 3) | WIRE_LEN)) {
      const span = findStringValue(reader.subReader())
      if (!wantedKeys) {
        if (span) onText(reader.decode(span[0], span[1]))
      } else if (span) {
        valueSpans.push(span[0], span[1])
      } else {
        valueSpans.push(-1, -1)
      }
    } else if (wantedKeys && tag === ((LAYER_KEYS << 3) | WIRE_LEN)) {
      keyWanted.push(wantedKeys.has(reader.string()))
    } else if (wantedKeys && tag === ((LAYER_FEATURES << 3) | WIRE_LEN)) {
      const feature = reader.subReader()
      const featureStart = unpackedTags.length
      while (feature.pos < feature.end) {
        const featureTag = feature.varint()
        if (featureTag === ((FEATURE_TAGS << 3) | WIRE_LEN)) {
          packedTags.push(feature.subReader())
        } else if (featureTag === ((FEATURE_TAGS << 3) | WIRE_VARINT)) {
          unpackedTags.push(feature.varint())
        } else {
          feature.skip(featureTag)
        }
      }
      // Keep pairs aligned if a feature has an odd number of loose tags
      if ((unpackedTags.length - featureStart) % 2) unpackedTags.pop()
    } else {
      reader.skip(tag)
    }
  }
  if (!wantedKeys || !keyWanted.includes(true)) return

  const seen = new Uint8Array(valueSpans.length / 2)
  /**
   * @param {number} keyIndex
   * @param {number} valueIndex
   */
  const visit = (keyIndex, valueIndex) => {
    if (!keyWanted[keyIndex] || seen[valueIndex]) return
    seen[valueIndex] = 1
    const start = valueSpans[valueIndex * 2]
    if (start >= 0) onText(reader.decode(start, valueSpans[valueIndex * 2 + 1]))
  }
  for (const tags of packedTags) {
    while (tags.pos < tags.end) visit(tags.varint(), tags.varint())
  }
  for (let i = 0; i < unpackedTags.length; i += 2) {
    visit(unpackedTags[i], unpackedTags[i + 1])
  }
}

/**
 * @param {Reader} reader
 * @returns {[number, number] | undefined} start and end offsets of the string
 */
function findStringValue(reader) {
  /** @type {[number, number] | undefined} */
  let span
  while (reader.pos < reader.end) {
    const tag = reader.varint()
    if (tag === ((VALUE_STRING << 3) | WIRE_LEN)) {
      const { pos, end } = reader.subReader()
      span = [pos, end]
    } else {
      reader.skip(tag)
    }
  }
  return span
}

class Reader {
  /**
   * @param {Uint8Array} buf
   * @param {number} pos
   * @param {number} end
   */
  constructor(buf, pos, end) {
    this.buf = buf
    this.pos = pos
    this.end = end
  }

  varint() {
    let value = 0
    let multiplier = 1
    let byte
    do {
      if (this.pos >= this.end) throw new Error('Unexpected end of tile data')
      byte = this.buf[this.pos++]
      value += (byte & 0x7f) * multiplier
      multiplier *= 128
    } while (byte & 0x80)
    return value
  }

  /** Advance past a length-delimited field and return a reader over it */
  subReader() {
    const length = this.varint()
    const start = this.pos
    this.#advance(length)
    return new Reader(this.buf, start, this.pos)
  }

  string() {
    const { pos, end } = this.subReader()
    return this.decode(pos, end)
  }

  /**
   * @param {number} start
   * @param {number} end
   */
  decode(start, end) {
    return textDecoder.decode(this.buf.subarray(start, end))
  }

  /** @param {number} tag */
  skip(tag) {
    switch (tag & 0x7) {
      case WIRE_VARINT:
        this.varint()
        break
      case WIRE_I64:
        this.#advance(8)
        break
      case WIRE_LEN:
        this.#advance(this.varint())
        break
      case WIRE_I32:
        this.#advance(4)
        break
      default:
        throw new Error(`Unsupported protobuf wire type ${tag & 0x7}`)
    }
  }

  /** @param {number} length */
  #advance(length) {
    if (this.pos + length > this.end) {
      throw new Error('Unexpected end of tile data')
    }
    this.pos += length
  }
}
