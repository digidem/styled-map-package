// Adapted from https://github.com/mapbox/tilebelt

const r2d = 180 / Math.PI

export const MAX_BOUNDS = /** @type {BBox} */ ([-180, -85.05, 180, 85.05])

/**
 * @typedef {readonly [number, number, number, number]} BBox
 */

/**
 * Return the bounding box for the given tile.
 *
 * @param {{ x: number, y: number, z: number }} tile
 * @returns {BBox} Bounding Box [w, s, e, n]
 */
export function tileToBBox({ x, y, z }) {
  const e = tile2lon({ x: x + 1, z })
  const w = tile2lon({ x, z })
  const s = tile2lat({ y: y + 1, z })
  const n = tile2lat({ y, z })
  return [w, s, e, n]
}

/**
 * @param {{ x: number, y: number, z: number }} tile
 */
export function getQuadkey({ x, y, z }) {
  let quadkey = ''
  let mask
  for (let i = z; i > 0; i--) {
    mask = 1 << (i - 1)
    quadkey += (x & mask ? 1 : 0) + (y & mask ? 2 : 0)
  }
  return quadkey
}

/**
 * From an array of tile URL templates, get the URL for the given tile.
 *
 * @param {string[]} urls
 * @param {{ x: number, y: number, z: number, scheme?: 'xyz' | 'tms' }} opts
 */
export function getTileUrl(urls, { x, y, z, scheme = 'xyz' }) {
  const bboxEspg3857 = tileToBBox({ x, y: Math.pow(2, z) - y - 1, z })
  const quadkey = getQuadkey({ x, y, z })

  return urls[(x + y) % urls.length]
    .replace('{prefix}', (x % 16).toString(16) + (y % 16).toString(16))
    .replace(/{z}/g, String(z))
    .replace(/{x}/g, String(x))
    .replace(/{y}/g, String(scheme === 'tms' ? Math.pow(2, z) - y - 1 : y))
    .replace('{quadkey}', quadkey)
    .replace('{bbox-epsg-3857}', bboxEspg3857.join(','))
}

/**
 * Returns a bbox that is the smallest bounding box that contains all the input bboxes.
 *
 * @param {[BBox, ...BBox[]]} bboxes
 * @returns {BBox} Bounding Box [w, s, e, n]
 */
export function unionBBox(bboxes) {
  let [w, s, e, n] = bboxes[0]
  for (let i = 1; i < bboxes.length; i++) {
    const [w1, s1, e1, n1] = bboxes[i]
    w = Math.min(w, w1)
    s = Math.min(s, s1)
    e = Math.max(e, e1)
    n = Math.max(n, n1)
  }
  return [w, s, e, n]
}

/** @param {{ x: number, z: number }} opts */
function tile2lon({ x, z }) {
  return (x / Math.pow(2, z)) * 360 - 180
}

/** @param {{ y: number, z: number }} opts */
function tile2lat({ y, z }) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z)
  return r2d * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}
