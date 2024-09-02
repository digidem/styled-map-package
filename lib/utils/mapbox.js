'use strict'
// from https://github.com/mapbox/mapbox-gl-js/blob/495a695/src/util/mapbox.js

const API_URL = 'https://api.mapbox.com'
const HELP = 'See https://www.mapbox.com/api-documentation/#access-tokens'

/**
 * @typedef {object} URLObject
 * @property {string} protocol
 * @property {string} authority
 * @property {string} path
 * @property {string[]} params
 */

/**
 * @param {URLObject} urlObject
 * @param {string} [accessToken]
 */
function makeAPIURL(urlObject, accessToken) {
  const apiUrlObject = parseUrl(API_URL)
  urlObject.protocol = apiUrlObject.protocol
  urlObject.authority = apiUrlObject.authority

  if (!accessToken) {
    throw new Error(
      `An API access token is required to use a Mapbox style. ${HELP}`,
    )
  }
  if (accessToken[0] === 's') {
    throw new Error(
      `Use a public access token (pk.*) not a secret access token (sk.*). ${HELP}`,
    )
  }

  urlObject.params.push(`access_token=${accessToken}`)
  return formatUrl(urlObject)
}

/** @param {string} url */
export function isMapboxURL(url) {
  return url.indexOf('mapbox:') === 0
}

/**
 * @param {string} url
 * @param {string} [accessToken]
 */
export function normalizeStyleURL(url, accessToken) {
  if (!isMapboxURL(url)) return url
  if (!accessToken) throw new Error('Mapbox styles require an access token')
  const urlObject = parseUrl(url)
  urlObject.path = `/styles/v1${urlObject.path}`
  return makeAPIURL(urlObject, accessToken)
}

/**
 * @param {string} url
 * @param {string} [accessToken]
 */
export function normalizeGlyphsURL(url, accessToken) {
  if (!isMapboxURL(url)) return url
  if (!accessToken) throw new Error('Mapbox styles require an access token')
  const urlObject = parseUrl(url)
  urlObject.path = `/fonts/v1${urlObject.path}`
  return makeAPIURL(urlObject, accessToken)
}

/**
 * @param {string} url
 * @param {string} [accessToken]
 */
export function normalizeSourceURL(url, accessToken) {
  if (!isMapboxURL(url)) return url
  if (!accessToken) throw new Error('Mapbox styles require an access token')
  const urlObject = parseUrl(url)
  urlObject.path = `/v4/${urlObject.authority}.json`
  // TileJSON requests need a secure flag appended to their URLs so
  // that the server knows to send SSL-ified resource references.
  urlObject.params.push('secure')
  return makeAPIURL(urlObject, accessToken)
}

/**
 * @param {string} url
 * @param {'' | '@2x'} format
 * @param {'.png' | '.json'} extension
 * @param {string} [accessToken]
 */
export function normalizeSpriteURL(url, format, extension, accessToken) {
  const urlObject = parseUrl(url)
  if (!isMapboxURL(url)) {
    urlObject.path += `${format}${extension}`
    return formatUrl(urlObject)
  }
  urlObject.path = `/styles/v1${urlObject.path}/sprite${format}${extension}`
  return makeAPIURL(urlObject, accessToken)
}

const imageExtensionRe = /(\.(png|jpg)\d*)(?=$)/

/**
 * @param {any} tileURL
 * @param {string} sourceURL
 * @param {256 | 512} [tileSize]
 * @param {{ devicePixelRatio?: number; supportsWebp?: boolean; }} [opts]
 */
export function normalizeTileURL(
  tileURL,
  sourceURL,
  tileSize,
  { devicePixelRatio = 1, supportsWebp = false } = {},
) {
  if (!sourceURL || !isMapboxURL(sourceURL)) return tileURL

  const urlObject = parseUrl(tileURL)

  // The v4 mapbox tile API supports 512x512 image tiles only when @2x
  // is appended to the tile URL. If `tileSize: 512` is specified for
  // a Mapbox raster source force the @2x suffix even if a non hidpi device.
  const suffix = devicePixelRatio >= 2 || tileSize === 512 ? '@2x' : ''
  const extension = supportsWebp ? '.webp' : '$1'
  urlObject.path = urlObject.path.replace(
    imageExtensionRe,
    `${suffix}${extension}`,
  )

  return formatUrl(urlObject)
}

const urlRe = /^(\w+):\/\/([^/?]*)(\/[^?]+)?\??(.+)?/

/**
 * @param {string} url
 * @returns {URLObject}
 */
function parseUrl(url) {
  const parts = url.match(urlRe)
  if (!parts) {
    throw new Error('Unable to parse URL object')
  }
  return {
    protocol: parts[1],
    authority: parts[2],
    path: parts[3] || '/',
    params: parts[4] ? parts[4].split('&') : [],
  }
}

/**
 * @param {URLObject} obj
 */
function formatUrl(obj) {
  const params = obj.params.length ? `?${obj.params.join('&')}` : ''
  return `${obj.protocol}://${obj.authority}${obj.path}${params}`
}
