export const URI_SCHEME = 'smp' // "Styled Map Package"
export const URI_BASE = URI_SCHEME + '://maps.v1/'

// These constants determine the file format structure
export const VERSION_FILE = 'VERSION'
export const FORMAT_VERSION = '1.0'
export const STYLE_FILE = 'style.json'
export const SOURCES_FOLDER = 's'
const SPRITES_FOLDER = 'sprites'
export const FONTS_FOLDER = 'fonts'

// This must include placeholders `{z}`, `{x}`, `{y}`, since these are used to
// define the tile URL, and this is a TileJSON standard.
// The folder here is just `s` to minimize bytes used for filenames, which are
// included in the header of every tile in the zip file.
const TILE_FILE = SOURCES_FOLDER + '/{sourceId}/{z}/{x}/{y}{ext}'
// The pixel ratio and ext placeholders must be at the end of the string with no
// data between them, because this is the format defined in the MapLibre style spec.
const SPRITE_FILE = SPRITES_FOLDER + '/{id}/sprite{pixelRatio}{ext}'
// This must include placeholders `{fontstack}` and `{range}`, since these are
// part of the MapLibre style spec.
const GLYPH_FILE = FONTS_FOLDER + '/{fontstack}/{range}.pbf.gz'
export const GLYPH_URI = URI_BASE + GLYPH_FILE

const pathToResouceType = /** @type {const} */ ({
  [TILE_FILE.split('/')[0] + '/']: 'tile',
  [SPRITE_FILE.split('/')[0] + '/']: 'sprite',
  [GLYPH_FILE.split('/')[0] + '/']: 'glyph',
})

/**
 * @param {string} path
 * @returns
 */
export function getResourceType(path) {
  if (path === 'style.json') return 'style'
  for (const [prefix, type] of Object.entries(pathToResouceType)) {
    if (path.startsWith(prefix)) return type
  }
  throw new Error(`Unknown resource type for path: ${path}`)
}

/**
 * Determine the content type of a file based on its extension.
 *
 * @param {string} path
 */
export function getContentType(path) {
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  if (path.endsWith('.pbf.gz') || path.endsWith('.pbf'))
    return 'application/x-protobuf'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.mvt.gz') || path.endsWith('.mvt'))
    return 'application/vnd.mapbox-vector-tile'
  throw new Error(`Unknown content type for path: ${path}`)
}

/**
 * Get the filename for a tile, given the TileInfo
 *
 * @param {import("type-fest").SetRequired<import("../writer.js").TileInfo, 'format'>} tileInfo
 * @returns
 */
export function getTileFilename({ sourceId, z, x, y, format }) {
  const ext = '.' + format + (format === 'mvt' ? '.gz' : '')
  return replaceVariables(TILE_FILE, { sourceId, z, x, y, ext })
}

/**
 * Get a filename for a sprite file, given the sprite id, pixel ratio and extension
 *
 * @param {{ id: string, pixelRatio: number, ext: '.json' | '.png'}} spriteInfo
 */
export function getSpriteFilename({ id, pixelRatio, ext }) {
  return replaceVariables(SPRITE_FILE, {
    id,
    pixelRatio: getPixelRatioString(pixelRatio),
    ext,
  })
}

/**
 * Get the filename for a glyph file, given the fontstack and range
 *
 * @param {object} options
 * @param {string} options.fontstack
 * @param {import("../writer.js").GlyphRange} options.range
 */
export function getGlyphFilename({ fontstack, range }) {
  return replaceVariables(GLYPH_FILE, { fontstack, range })
}

/**
 * Get the URI template for the sprites in the style
 */
export function getSpriteUri(id = 'default') {
  return (
    URI_BASE + replaceVariables(SPRITE_FILE, { id, pixelRatio: '', ext: '' })
  )
}

/**
 * Get the URI template for tiles in the style
 *
 * @param {object} opts
 * @param {string} opts.sourceId
 * @param {import("../writer.js").TileFormat} opts.format
 * @returns
 */
export function getTileUri({ sourceId, format }) {
  const ext = '.' + format + (format === 'mvt' ? '.gz' : '')
  return (
    URI_BASE + TILE_FILE.replace('{sourceId}', sourceId).replace('{ext}', ext)
  )
}

/**
 * @param {number} pixelRatio
 */
function getPixelRatioString(pixelRatio) {
  return pixelRatio === 1 ? '' : `@${pixelRatio}x`
}

/**
 * Replaces variables in a string with values provided in an object. Variables
 * in the string are denoted by curly braces, e.g., {variableName}.
 *
 * @param {string} template - The string containing variables wrapped in curly braces.
 * @param {Record<string, string | number>} variables - An object where the keys correspond to variable names and values correspond to the replacement values.
 * @returns {string} The string with the variables replaced by their corresponding values.
 */
export function replaceVariables(template, variables) {
  return template.replace(/{(.*?)}/g, (match, varName) => {
    return varName in variables ? String(variables[varName]) : match
  })
}
