import { scanTileText } from './mvt-text.js'

/** @import { StyleInlinedSources } from '../types.js' */
/** @import { LayerKeys } from './mvt-text.js' */

const RANGE_SIZE = 256
const RANGE_COUNT = 256

// MapLibre shapes Arabic into presentation forms (U+FB50–U+FDFF,
// U+FE70–U+FEFF), which never appear in the source text.
const ARABIC_SHAPING_RANGES = [0xfb00, 0xfc00, 0xfd00, 0xfe00]
// MapLibre's `verticalizePunctuation()` swaps punctuation in vertical text for
// forms in these ranges (e.g. U+2015, U+30FB, U+FE10–, U+FF01–).
const VERTICAL_PUNCTUATION_RANGES = [0x2000, 0x3000, 0xfe00, 0xff00]
// Locale-dependent casing: Turkish/Azeri dotted and dotless i (U+0130,
// U+0131), and the combining dot Lithuanian lowercasing inserts (U+0307).
const LOCALE_CASE_RANGES = [0x100, 0x300]
// Digits, signs and separators `Intl.NumberFormat` produces across all ICU
// locales (e.g. Arabic-Indic digits, U+202F group separator, U+2212 minus).
const NUMBER_FORMAT_RANGES = [
  0x600, 0x700, 0x900, 0xf00, 0x1000, 0x1c00, 0x2000, 0x2200, 0x2e00,
]

// Code points with Unicode Vertical_Orientation U or Tu (plus U+02EA–02EB,
// U+1400, U+30A0 and U+FF00), a superset of MapLibre's `codePointHasUprightVerticalOrientation()`: any
// of them lets a label be laid out vertically. Pairs of [start, end].
// prettier-ignore
const UPRIGHT_RANGES = [
  0xa7, 0xa7, 0xa9, 0xa9, 0xae, 0xae, 0xb1, 0xb1, 0xbc, 0xbe, 0xd7, 0xd7,
  0xf7, 0xf7, 0x2ea, 0x2eb, 0x1100, 0x11ff, 0x1400, 0x167f, 0x18b0, 0x18ff,
  0x2016, 0x2016, 0x2020, 0x2021, 0x2030, 0x2031, 0x203b, 0x203c, 0x2042, 0x2042,
  0x2047, 0x2049, 0x2051, 0x2051, 0x2065, 0x2065, 0x20dd, 0x20e0, 0x20e2, 0x20e4,
  0x2100, 0x2101, 0x2103, 0x2109, 0x210f, 0x210f, 0x2113, 0x2114, 0x2116, 0x2117,
  0x211e, 0x2123, 0x2125, 0x2125, 0x2127, 0x2127, 0x2129, 0x2129, 0x212e, 0x212e,
  0x2135, 0x213f, 0x2145, 0x214a, 0x214c, 0x214d, 0x214f, 0x2189, 0x218c, 0x218f,
  0x221e, 0x221e, 0x2234, 0x2235, 0x2300, 0x2307, 0x230c, 0x231f, 0x2324, 0x2328,
  0x232b, 0x232b, 0x237d, 0x239a, 0x23be, 0x23cd, 0x23cf, 0x23cf, 0x23d1, 0x23db,
  0x23e2, 0x2422, 0x2424, 0x24ff, 0x25a0, 0x2619, 0x2620, 0x2767, 0x2776, 0x2793,
  0x2b12, 0x2b2f, 0x2b50, 0x2b59, 0x2b97, 0x2b97, 0x2bb8, 0x2bd1, 0x2bd3, 0x2beb,
  0x2bf0, 0x2bff, 0x2e50, 0x2e51, 0x2e80, 0x3007, 0x3012, 0x3013, 0x3020, 0x302f,
  0x3031, 0x30fb, 0x30fd, 0xa4cf, 0xa960, 0xa97f, 0xac00, 0xd7ff,
  0xe000, 0xfaff, 0xfe10, 0xfe1f, 0xfe30, 0xfe48, 0xfe50, 0xfe57, 0xfe5f, 0xfe62,
  0xfe67, 0xfe6f, 0xff00, 0xff07, 0xff0a, 0xff0c, 0xff0e, 0xff19, 0xff1f, 0xff3a,
  0xff3c, 0xff3c, 0xff3e, 0xff3e, 0xff40, 0xff5a, 0xffe0, 0xffe2, 0xffe4, 0xffe7,
  0xfff0, 0xfff8, 0xfffc, 0xfffd,
]

const ARABIC_FLAG = 1
const UPRIGHT_FLAG = 2
/** @type {Uint8Array | undefined} */
let charFlags

function getCharFlags() {
  if (charFlags) return charFlags
  charFlags = new Uint8Array(0x10000)
  for (let i = 0; i < UPRIGHT_RANGES.length; i += 2) {
    charFlags.fill(UPRIGHT_FLAG, UPRIGHT_RANGES[i], UPRIGHT_RANGES[i + 1] + 1)
  }
  const arabic = /\p{Script=Arabic}/u
  for (let code = 0x600; code < 0x10000; code++) {
    if (arabic.test(String.fromCharCode(code))) charFlags[code] |= ARABIC_FLAG
  }
  return charFlags
}

/**
 * Collects the glyph ranges needed to render the labels of a style, from the
 * text in its vector tiles and inline GeoJSON. Only property values the style
 * can use in `text-field` are considered.
 */
export class GlyphRangeCollector {
  /** @type {Map<string, LayerKeys>} */
  #layerKeysBySource = new Map()
  #usedRanges = new Uint8Array(RANGE_COUNT)
  #charFlags = getCharFlags()
  #needsAllRanges = false
  #addCaseVariants = false

  /** @param {StyleInlinedSources} style */
  constructor(style) {
    this.#usedRanges[0] = 1
    /** @type {Map<string, Set<string> | null>} */
    const geojsonKeys = new Map()
    /** @type {Set<string>} */
    const geojsonIdSources = new Set()
    const labelLayers = style.layers.flatMap((layer) =>
      layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined
        ? [{ layer, analysis: analyzeTextField(layer.layout['text-field']) }]
        : [],
    )
    /** @type {TextFieldAnalysis[]} */
    const analyses = labelLayers.map(({ analysis }) => analysis)
    const labelSourceIds = new Set(labelLayers.map(({ layer }) => layer.source))
    for (const sourceId of labelSourceIds) {
      const source = style.sources[sourceId]
      // Cluster labels can show aggregates built by these expressions
      if (source?.type === 'geojson' && source.cluster) {
        const expressions = Object.values(source.clusterProperties ?? {})
        analyses.push(analyzeTextField(['concat', ...expressions.flat()]))
      }
    }
    // Case variants apply to all text, so decide before adding any
    const changesCase = labelLayers.some(({ layer, analysis }) => {
      const transform = layer.layout?.['text-transform']
      return (
        analysis.changesCase ||
        (transform !== undefined && transform !== 'none')
      )
    })
    if (changesCase || analyses.some((a) => a.changesCase)) {
      this.#addCaseVariants = true
      this.#markRanges(LOCALE_CASE_RANGES)
    }
    let usesGlobalState = false
    for (const analysis of analyses) {
      if (analysis.needsAllRanges) this.#needsAllRanges = true
      if (analysis.formatsNumbers) this.#markRanges(NUMBER_FORMAT_RANGES)
      if (analysis.usesGlobalState) usesGlobalState = true
      for (const literal of analysis.literals) this.addText(literal)
    }
    for (const { layer, analysis } of labelLayers) {
      const source = style.sources[layer.source]
      /** @type {Set<string> | null} */
      let keys = analysis.keys
      if (source?.type === 'vector') {
        const sourceLayer = layer['source-layer']
        if (sourceLayer === undefined) continue
        const promoteId =
          source.promoteId && typeof source.promoteId === 'object'
            ? source.promoteId[sourceLayer]
            : source.promoteId
        if (analysis.usesId && keys && typeof promoteId === 'string') {
          keys = new Set([...keys, promoteId])
        }
        let layerKeys = this.#layerKeysBySource.get(layer.source)
        if (!layerKeys) {
          layerKeys = new Map()
          this.#layerKeysBySource.set(layer.source, layerKeys)
        }
        mergeKeys(layerKeys, sourceLayer, keys)
      } else if (source?.type === 'geojson') {
        if (source.cluster) {
          // Cluster labels can read aggregates built from any property
          keys = null
        }
        if (typeof source.data !== 'object') {
          // Data that was not inlined can't be scanned
          this.#needsAllRanges = true
        }
        const { promoteId } = source
        if (analysis.usesId) {
          geojsonIdSources.add(layer.source)
          if (keys && typeof promoteId === 'string') {
            keys = new Set([...keys, promoteId])
          }
        }
        mergeKeys(geojsonKeys, layer.source, keys)
      }
    }
    if (usesGlobalState && 'state' in style) {
      collectStrings(style.state, (s) => this.addText(s))
    }
    for (const [sourceId, keys] of geojsonKeys) {
      const source = style.sources[sourceId]
      if (source.type !== 'geojson' || typeof source.data !== 'object') continue
      this.#addGeoJSONText(source.data, keys, geojsonIdSources.has(sourceId))
    }
  }

  /**
   * Whether tiles from this source can change the result of `getRanges()`.
   *
   * @param {string} sourceId
   */
  wantsTile(sourceId) {
    return !this.#needsAllRanges && this.#layerKeysBySource.has(sourceId)
  }

  /** Report that some label data could not be read */
  setNeedsAllRanges() {
    this.#needsAllRanges = true
  }

  /**
   * Scan an uncompressed vector tile for label text. Data that can't be parsed
   * makes the collector report that all ranges are needed.
   *
   * @param {Uint8Array} data
   * @param {string} sourceId
   */
  addTile(data, sourceId) {
    const layerKeys = this.#layerKeysBySource.get(sourceId)
    if (this.#needsAllRanges || !layerKeys) return
    try {
      scanTileText(data, layerKeys, (text) => this.addText(text))
    } catch {
      this.#needsAllRanges = true
    }
  }

  /** @param {string} text */
  addText(text) {
    if (this.#addCharRanges(text) && this.#addCaseVariants) {
      this.#addCharRanges(text.toUpperCase())
      this.#addCharRanges(text.toLowerCase())
    }
  }

  /**
   * Start codepoints of the glyph ranges that are needed, in ascending order,
   * or `null` if every range should be downloaded.
   *
   * @returns {number[] | null}
   */
  getRanges() {
    if (this.#needsAllRanges) return null
    /** @type {number[]} */
    const ranges = []
    for (let i = 0; i < RANGE_COUNT; i++) {
      if (this.#usedRanges[i]) ranges.push(i * RANGE_SIZE)
    }
    return ranges
  }

  /**
   * @param {string} text
   * @returns {boolean} true if the text contains non-ASCII characters
   */
  #addCharRanges(text) {
    let nonAscii = false
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code < 0x80) continue
      nonAscii = true
      // Surrogates encode codepoints above U+FFFF, which glyph PBFs don't cover
      if (code >= 0xd800 && code <= 0xdfff) continue
      this.#usedRanges[code >> 8] = 1
      const flags = this.#charFlags[code]
      if (flags & ARABIC_FLAG) this.#markRanges(ARABIC_SHAPING_RANGES)
      if (flags & UPRIGHT_FLAG) this.#markRanges(VERTICAL_PUNCTUATION_RANGES)
    }
    return nonAscii
  }

  /** @param {number[]} rangeStarts */
  #markRanges(rangeStarts) {
    for (const start of rangeStarts) this.#usedRanges[start >> 8] = 1
  }

  /**
   * @param {unknown} data
   * @param {Set<string> | null} keys
   * @param {boolean} readIds
   */
  #addGeoJSONText(data, keys, readIds) {
    if (!data || typeof data !== 'object') return
    if ('features' in data && Array.isArray(data.features)) {
      for (const feature of data.features) {
        this.#addGeoJSONText(feature, keys, readIds)
      }
      return
    }
    if (readIds && 'id' in data && typeof data.id === 'string') {
      this.addText(data.id)
    }
    if (!('properties' in data)) return
    const { properties } = data
    if (!properties || typeof properties !== 'object') return
    for (const [key, value] of Object.entries(properties)) {
      if (keys && !keys.has(key)) continue
      if (typeof value === 'string') this.addText(value)
      else if (value && typeof value === 'object') {
        this.addText(JSON.stringify(value))
      }
    }
  }
}

/**
 * @param {Map<string, Set<string> | null>} map
 * @param {string} id
 * @param {Set<string> | null} keys
 */
function mergeKeys(map, id, keys) {
  const existing = map.get(id)
  if (existing === null) return
  if (keys === null) {
    map.set(id, null)
  } else if (existing) {
    for (const key of keys) existing.add(key)
  } else {
    map.set(id, new Set(keys))
  }
}

/**
 * @param {unknown} value
 * @param {(text: string) => void} onString
 */
function collectStrings(value, onString) {
  if (typeof value === 'string') onString(value)
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, onString)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, onString)
  }
}

/**
 * @typedef {object} TextFieldAnalysis
 * @property {Set<string> | null} keys Feature property keys the text can read, or `null` if they can't be determined statically
 * @property {string[]} literals Strings in the expression that can be rendered
 * @property {boolean} needsAllRanges The rendered text can't be predicted
 * @property {boolean} changesCase Uses `upcase` or `downcase`
 * @property {boolean} formatsNumbers Uses `number-format` with the device locale
 * @property {boolean} usesId Uses the feature `id`
 * @property {boolean} usesGlobalState Uses `global-state`
 */

/**
 * Find the feature property keys and literal strings a `text-field` value can
 * render.
 *
 * @param {unknown} textField
 * @returns {TextFieldAnalysis}
 */
export function analyzeTextField(textField) {
  /** @type {TextFieldAnalysis} */
  const result = {
    keys: new Set(),
    literals: [],
    needsAllRanges: false,
    changesCase: false,
    formatsNumbers: false,
    usesId: false,
    usesGlobalState: false,
  }
  /** @param {string} text */
  const addLiteral = (text) => result.literals.push(text)

  /** @param {unknown} value */
  function walk(value) {
    if (typeof value === 'string') {
      addLiteral(value)
    } else if (Array.isArray(value)) {
      const [op, ...args] = value
      switch (op) {
        case 'literal':
          return collectStrings(args, addLiteral)
        case 'get':
          if (args.length === 1 && typeof args[0] === 'string') {
            result.keys?.add(args[0])
          } else {
            result.keys = null
          }
          break
        case 'properties':
          result.keys = null
          break
        case 'id':
          result.usesId = true
          break
        case 'global-state':
          result.usesGlobalState = true
          break
        case 'upcase':
        case 'downcase':
          result.changesCase = true
          break
        case 'number-format':
          analyzeNumberFormat(args[1], result)
          break
      }
      args.forEach(walk)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk)
    }
  }

  if (typeof textField === 'string') {
    for (const [, key] of textField.matchAll(/{([^{}]+)}/g)) {
      result.keys?.add(key)
    }
    addLiteral(textField)
  } else if (Array.isArray(textField)) {
    walk(textField)
  } else {
    // Legacy property functions are migrated to expressions before we get here
    result.needsAllRanges = true
  }
  return result
}

/**
 * @param {unknown} options
 * @param {TextFieldAnalysis} result
 */
function analyzeNumberFormat(options, result) {
  const { locale, currency } =
    options && typeof options === 'object'
      ? /** @type {{ locale?: unknown, currency?: unknown }} */ (options)
      : {}
  if (currency !== undefined) {
    // Currency symbols come from many scripts
    result.needsAllRanges = true
  } else if (locale === undefined) {
    result.formatsNumbers = true
  } else if (typeof locale === 'string') {
    try {
      const format = new Intl.NumberFormat(locale)
      result.literals.push(
        format.format(-1234567.891),
        format.format(-Infinity),
      )
    } catch {
      // MapLibre fails to render an invalid locale
    }
  } else {
    result.formatsNumbers = true
  }
}
