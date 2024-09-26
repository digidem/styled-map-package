import { expressions, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'

/** @import {StyleSpecification, ExpressionSpecification, ValidationError} from '@maplibre/maplibre-gl-style-spec' */

/**
 * For a given style, replace all font stacks (`text-field` properties) with the
 * provided fonts. If no matching font is found, the first font in the stack is
 * used.
 *
 * *Modifies the input style object*
 *
 * @param {StyleSpecification} style
 * @param {string[]} fonts
 */
export function replaceFontStacks(style, fonts) {
  const mappedLayers = mapFontStacks(style.layers, (fontStack) => {
    let match
    for (const font of fontStack) {
      if (fonts.includes(font)) {
        match = font
        break
      }
    }
    return [match || fonts[0]]
  })
  style.layers = mappedLayers
  return style
}

/**
 * From given style layers, create a new style by calling the provided callback
 * function on every font stack defined in the style.
 *
 * @param {StyleSpecification['layers']} layers
 * @param {(fontStack: string[]) => string[]} callbackFn
 * @returns {StyleSpecification['layers']}
 */
export function mapFontStacks(layers, callbackFn) {
  return layers.map((layer) => {
    if (layer.type !== 'symbol' || !layer.layout || !layer.layout['text-font'])
      return layer
    const textFont = layer.layout['text-font']
    let mappedValue
    if (isExpression(textFont)) {
      mappedValue = mapArrayExpressionValue(textFont, callbackFn)
    } else if (Array.isArray(textFont)) {
      mappedValue = callbackFn(textFont)
    } else {
      // Deprecated property function, unsupported, but within this module
      // functions will have been migrated to expressions anyway.
      console.warn(
        'Deprecated function definitions are not supported, font stack has not been transformed.',
      )
      console.dir(textFont, { depth: null })
      return layer
    }
    return {
      ...layer,
      layout: {
        ...layer.layout,
        'text-font': mappedValue,
      },
    }
  })
}

/**
 * See https://github.com/maplibre/maplibre-style-spec/blob/c2f01dbaa6c5fb8409126258b9464b450018e939/src/expression/index.ts#L128
 *
 * @param {unknown} value
 * @returns {value is ExpressionSpecification}
 */
function isExpression(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'string' &&
    value[0] in expressions
  )
}

/**
 * For an expression whose value is an array, map the array to a new array using
 * the given callbackFn.
 *
 * @param {ExpressionSpecification} expression
 * @param {(value: string[]) => string[]} callbackFn
 * @returns {ExpressionSpecification}
 */
function mapArrayExpressionValue(expression, callbackFn) {
  // This only works for properties whose value is an array, because it relies
  // on the style specification that array values must be declared with the
  // `literal` expression.
  if (expression[0] === 'literal' && Array.isArray(expression[1])) {
    return ['literal', callbackFn(expression[1])]
  } else {
    // @ts-ignore
    return [
      expression[0],
      ...expression.slice(1).map(
        // @ts-ignore
        (x) => {
          if (isExpression(x)) {
            return mapArrayExpressionValue(x, callbackFn)
          } else {
            return x
          }
        },
      ),
    ]
  }
}

/**
 * @typedef {object} TileJSONPartial
 * @property {string[]} tiles
 * @property {string} [description]
 * @property {string} [attribution]
 * @property {object[]} [vector_layers]
 * @property {import('./geo.js').BBox} [bounds]
 * @property {number} [maxzoom]
 * @property {number} [minzoom]
 */

/**
 *
 * @param {unknown} tilejson
 * @returns {asserts tilejson is TileJSONPartial}
 */
export function assertTileJSON(tilejson) {
  if (typeof tilejson !== 'object' || tilejson === null) {
    throw new Error('Invalid TileJSON')
  }
  if (
    !('tiles' in tilejson) ||
    !Array.isArray(tilejson.tiles) ||
    tilejson.tiles.length === 0 ||
    tilejson.tiles.some((tile) => typeof tile !== 'string')
  ) {
    throw new Error('Invalid TileJSON: missing or invalid tiles property')
  }
}

export const validateStyle =
  /** @type {{ (style: unknown): style is StyleSpecification, errors: ValidationError[] }} */ (
    (style) => {
      validateStyle.errors = validateStyleMin(
        /** @type {StyleSpecification} */ (style),
      )
      if (validateStyle.errors.length) return false
      return true
    }
  )

/**
 * Check whether a source is already inlined (e.g. does not reference a TileJSON or GeoJSON url)
 *
 * @param {import('@maplibre/maplibre-gl-style-spec').SourceSpecification} source
 * @returns {source is import('../types.js').InlinedSource}
 */
export function isInlinedSource(source) {
  if (source.type === 'geojson') {
    return typeof source.data === 'object'
  } else if (
    source.type === 'vector' ||
    source.type === 'raster' ||
    source.type === 'raster-dem'
  ) {
    return 'tiles' in source
  } else {
    // Video and image sources are not strictly "inlined", but we treat them as such.
    return true
  }
}
