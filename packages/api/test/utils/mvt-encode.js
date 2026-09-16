const textEncoder = new TextEncoder()

/**
 * @typedef {object} TestLayer
 * @property {string} name
 * @property {Array<Record<string, string | number | boolean>>} features
 * @property {boolean} [nameLast] Write the layer name after keys, values and features
 * @property {boolean} [unpackedTags] Write feature tags as individual varint fields
 */

/**
 * Encode a minimal vector tile for tests. Features are points at 0,0.
 *
 * @param {TestLayer[]} layers
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeTile(layers) {
  return concat(layers.map((layer) => lenField(3, encodeLayer(layer))))
}

/** @param {TestLayer} layer */
function encodeLayer({ name, features, nameLast, unpackedTags }) {
  /** @type {string[]} */
  const keys = []
  /** @type {Array<string | number | boolean>} */
  const values = []
  const featureParts = features.map((properties) => {
    /** @type {number[]} */
    const tags = []
    for (const [key, value] of Object.entries(properties)) {
      if (!keys.includes(key)) keys.push(key)
      if (!values.includes(value)) values.push(value)
      tags.push(keys.indexOf(key), values.indexOf(value))
    }
    return lenField(
      2,
      concat([
        ...(unpackedTags
          ? tags.map((tag) => varintField(2, tag))
          : [lenField(2, concat(tags.map(varint)))]),
        varintField(3, 1),
        lenField(4, concat([varint(9), varint(0), varint(0)])),
      ]),
    )
  })
  const nameField = lenField(1, textEncoder.encode(name))
  const body = [
    varintField(15, 2),
    ...featureParts,
    ...keys.map((key) => lenField(3, textEncoder.encode(key))),
    ...values.map((value) => lenField(4, encodeValue(value))),
    varintField(5, 4096),
  ]
  return concat(nameLast ? [...body, nameField] : [nameField, ...body])
}

/** @param {string | number | boolean} value */
function encodeValue(value) {
  if (typeof value === 'string') return lenField(1, textEncoder.encode(value))
  if (typeof value === 'boolean') return varintField(7, value ? 1 : 0)
  if (Number.isInteger(value) && value >= 0) return varintField(5, value)
  const bytes = new Uint8Array(9)
  bytes[0] = (3 << 3) | 1
  new DataView(bytes.buffer).setFloat64(1, value, true)
  return bytes
}

/**
 * @param {number} field
 * @param {Uint8Array} bytes
 */
function lenField(field, bytes) {
  return concat([varint((field << 3) | 2), varint(bytes.length), bytes])
}

/**
 * @param {number} field
 * @param {number} value
 */
function varintField(field, value) {
  return concat([varint(field << 3), varint(value)])
}

/** @param {number} value */
function varint(value) {
  /** @type {number[]} */
  const bytes = []
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80)
    value = Math.floor(value / 128)
  }
  bytes.push(value)
  return new Uint8Array(bytes)
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array<ArrayBuffer>}
 */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
