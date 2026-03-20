import { ZipReader } from '@gmaclennan/zip-reader'
import SphericalMercator from '@mapbox/sphericalmercator'
import { expressions, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'

import { STYLE_FILE, URI_BASE, VERSION_FILE } from './utils/templates.js'

/** Major version(s) supported by this implementation */
const SUPPORTED_MAJOR_VERSIONS = [1]

const DEFAULT_MAX_ENTRIES = 500_000

const sm = new SphericalMercator({ size: 256 })

const textEncoder = new TextEncoder()

/**
 * @typedef {object} ValidationIssue
 * @property {'error' | 'warning'} kind - error = spec MUST violation; warning = SHOULD/RECOMMENDED
 * @property {'fatal' | 'rendering' | 'spec'} severity - Practical impact:
 *   fatal = reader will fail to open; rendering = map renders with visible
 *   issues; spec = non-compliance that doesn't affect practical use
 * @property {string} type - Stable identifier for programmatic matching
 * @property {string} message - Human-readable description
 * @property {string} [path] - Location context (e.g. 'sources.test.tiles', 'VERSION')
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid - true when there are no errors (warnings are acceptable)
 * @property {boolean} usable - true when there are no fatal issues (the file can be opened)
 * @property {ValidationIssue[]} issues - all issues found
 */

/**
 * @typedef {object} ValidateOptions
 * @property {number} [maxEntries=500_000] Maximum number of ZIP entries to
 *   process before aborting. Default matches the Reader default (~a global z9
 *   tileset).
 */

/**
 * Maps issue types to their practical severity. Types not listed default to 'spec'.
 * @type {Record<string, 'fatal' | 'rendering'>}
 */
const ISSUE_SEVERITY = {
  // Fatal — reader will throw or fail to open the file
  file_not_found: 'fatal',
  invalid_zip: 'fatal',
  unsafe_entry: 'fatal',
  too_many_entries: 'fatal',
  unsupported_version: 'fatal',
  missing_style: 'fatal',
  invalid_style_json: 'fatal',
  // Rendering — file opens but map content will be visibly broken
  invalid_style: 'rendering',
  missing_tiles: 'rendering',
  mixed_tile_formats: 'rendering',
  invalid_tile_template: 'rendering',
  invalid_tile_scheme: 'rendering',
  missing_source_property: 'rendering',
  missing_sprite: 'rendering',
  missing_glyphs: 'rendering',
  missing_font_glyphs: 'rendering',
  incomplete_font_glyphs: 'rendering',
  invalid_glyph_template: 'rendering',
  missing_geojson_data: 'rendering',
  external_resource: 'rendering',
}

/**
 * @param {ValidationIssue[]} issues
 * @param {'error' | 'warning'} kind
 */
const createIssue =
  (issues, kind) =>
  /**
   * @param {string} type
   * @param {string} message
   * @param {string} [path]
   */
  (type, message, path) =>
    issues.push({
      kind,
      severity: ISSUE_SEVERITY[type] || 'spec',
      type,
      message,
      ...(path != null && { path }),
    })

/** @param {ValidationIssue[]} issues */
const result = (issues) => ({
  valid: !issues.some((i) => i.kind === 'error'),
  usable: !issues.some((i) => i.severity === 'fatal'),
  issues,
})

/**
 * Validate a Styled Map Package file against the SMP specification.
 *
 * Returns a list of issues, each with a `kind` ('error' or 'warning'), a
 * `severity` ('fatal', 'rendering', or 'spec'), and a stable `type` string
 * for programmatic filtering. Use `result.valid` to check spec compliance
 * and `result.usable` to check whether the file can be opened by the reader.
 *
 * @param {string | import('@gmaclennan/zip-reader').ZipReader} source Path to the .smp file, or a ZipReader instance
 * @param {ValidateOptions} [options]
 * @returns {Promise<ValidationResult>}
 */
export async function validate(source, options = {}) {
  const { maxEntries = DEFAULT_MAX_ENTRIES } = options

  /** @type {ValidationIssue[]} */
  const issues = []
  const error = createIssue(issues, 'error')
  const warn = createIssue(issues, 'warning')

  // §3: ZIP validity
  /** @type {import('@gmaclennan/zip-reader').ZipReader} */
  let zip
  /** @type {import('@gmaclennan/zip-reader/file-source').FileSource | null} */
  let fileSource = null
  try {
    if (typeof source === 'string') {
      const { FileSource } = await import('@gmaclennan/zip-reader/file-source')
      fileSource = await FileSource.open(source)
      zip = await ZipReader.from(fileSource)
    } else {
      zip = source
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/** @type {any} */ (err)?.code === 'ENOENT') {
      error('file_not_found', `File not found: ${source}`)
      return result(issues)
    }
    error('invalid_zip', `Not a valid ZIP file: ${message}`)
    return result(issues)
  }

  try {
    const entries = await buildEntryMap(zip, maxEntries, error, warn)
    if (!entries) return result(issues)

    if (!(await validateVersion(entries, error, warn))) {
      return result(issues)
    }

    const style = await parseStyle(entries, error)
    if (!style) return result(issues)

    validateMetadata(style, error, warn)
    validateSources(style, entries, error, warn)
    validateGlyphs(style, entries, error, warn)
    validateSprites(style, entries, error, warn)
  } finally {
    if (fileSource) await fileSource.close()
  }

  return result(issues)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @typedef {ReturnType<typeof createIssue>} IssueFn */

/**
 * Iterate ZIP entries into a Map, checking entry name safety (§3.4, §11).
 * Returns `null` if a fatal error prevents further validation.
 *
 * @param {import('@gmaclennan/zip-reader').ZipReader} zip
 * @param {number} maxEntries
 * @param {IssueFn} error
 * @param {IssueFn} warn
 * @returns {Promise<Map<string, import('@gmaclennan/zip-reader').ZipEntry> | null>}
 */
async function buildEntryMap(zip, maxEntries, error, warn) {
  /** @type {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} */
  const entries = new Map()
  let count = 0
  try {
    for await (const entry of zip) {
      if (++count > maxEntries) {
        error(
          'too_many_entries',
          `Archive exceeds maximum entry count of ${maxEntries}`,
        )
        return null
      }
      const name = entry.name

      // §3.4: Path safety
      if (
        name.includes('..') ||
        name.startsWith('/') ||
        /^[A-Za-z]:/.test(name)
      ) {
        error('unsafe_entry', `Unsafe ZIP entry name: ${name}`, name)
      }

      // §3.4: Entry name length
      if (textEncoder.encode(name).byteLength > 255) {
        warn(
          'entry_name_too_long',
          `ZIP entry name exceeds 255 bytes: ${name}`,
          name,
        )
      }

      entries.set(name, entry)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/Relative path|Absolute path|Unsafe/i.test(message)) {
      error('unsafe_entry', `ZIP contains unsafe entry: ${message}`)
      return null
    }
    throw err
  }
  return entries
}

/**
 * §3.1: Validate the VERSION file.
 * Returns `false` if validation should stop (unsupported major version).
 *
 * @param {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} entries
 * @param {IssueFn} error
 * @param {IssueFn} warn
 * @returns {Promise<boolean>}
 */
async function validateVersion(entries, error, warn) {
  const versionEntry = entries.get(VERSION_FILE)
  if (!versionEntry) {
    warn(
      'missing_version',
      'Missing VERSION file (assuming version 1.0)',
      'VERSION',
    )
    return true
  }

  const version = (await new Response(versionEntry.readable()).text()).trim()
  const majorMatch = version.match(/^(\d+)\.\d+$/)
  if (!majorMatch) {
    warn(
      'invalid_version_format',
      `Invalid version format: "${version}" (expected MAJOR.MINOR)`,
      'VERSION',
    )
    return true
  }

  const major = parseInt(majorMatch[1], 10)
  if (!SUPPORTED_MAJOR_VERSIONS.includes(major)) {
    error(
      'unsupported_version',
      `Unsupported major version: ${major} (supported: ${SUPPORTED_MAJOR_VERSIONS.join(', ')})`,
      'VERSION',
    )
    return false
  }
  return true
}

/**
 * §4.1: Parse and validate style.json.
 * Returns the parsed style object, or `null` on fatal error.
 *
 * @param {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} entries
 * @param {IssueFn} error
 * @returns {Promise<any | null>}
 */
async function parseStyle(entries, error) {
  const styleEntry = entries.get(STYLE_FILE)
  if (!styleEntry) {
    error('missing_style', 'Missing style.json', 'style.json')
    return null
  }

  /** @type {any} */
  let style
  try {
    style = await new Response(styleEntry.readable()).json()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(
      'invalid_style_json',
      `style.json is not valid JSON: ${message}`,
      'style.json',
    )
    return null
  }

  const styleErrors = validateStyleMin(
    /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */ (
      style
    ),
  )
  for (const e of styleErrors) {
    error('invalid_style', `style.json: ${e.message}`, 'style.json')
  }

  return style
}

/**
 * §4.3: Validate SMP metadata fields.
 *
 * @param {any} style
 * @param {IssueFn} error
 * @param {IssueFn} warn
 */
function validateMetadata(style, error, warn) {
  const metadata = style.metadata || {}

  // §4.3.1: smp:bounds
  const bounds = metadata['smp:bounds']
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    warn(
      'missing_smp_bounds',
      'Missing or invalid smp:bounds in metadata',
      'metadata.smp:bounds',
    )
  } else if (
    !bounds.every((/** @type {unknown} */ v) => typeof v === 'number')
  ) {
    warn(
      'invalid_smp_bounds',
      'smp:bounds values must all be numbers',
      'metadata.smp:bounds',
    )
  } else {
    const [w, s, e, n] = bounds
    if (w < -180 || w > 180 || e < -180 || e > 180) {
      error(
        'invalid_smp_bounds',
        `smp:bounds longitude out of range [-180, 180]: [${w}, ${e}]`,
        'metadata.smp:bounds',
      )
    }
    if (s < -90 || s > 90 || n < -90 || n > 90) {
      error(
        'invalid_smp_bounds',
        `smp:bounds latitude out of range [-90, 90]: [${s}, ${n}]`,
        'metadata.smp:bounds',
      )
    }
  }

  // §4.3.2: smp:maxzoom
  const maxzoom = metadata['smp:maxzoom']
  if (maxzoom == null) {
    warn(
      'missing_smp_maxzoom',
      'Missing smp:maxzoom in metadata',
      'metadata.smp:maxzoom',
    )
  } else if (typeof maxzoom !== 'number' || !Number.isInteger(maxzoom)) {
    warn(
      'invalid_smp_maxzoom',
      'smp:maxzoom must be an integer',
      'metadata.smp:maxzoom',
    )
  } else if (maxzoom < 0 || maxzoom > 30) {
    error(
      'invalid_smp_maxzoom',
      `smp:maxzoom must be between 0 and 30, got ${maxzoom}`,
      'metadata.smp:maxzoom',
    )
  }

  // §4.3.3: smp:sourceFolders
  const sourceFolders = metadata['smp:sourceFolders']
  if (sourceFolders && typeof sourceFolders !== 'object') {
    warn(
      'invalid_smp_source_folders',
      'Invalid smp:sourceFolders in metadata',
      'metadata.smp:sourceFolders',
    )
  }
}

/**
 * §5, §8: Validate tile and GeoJSON sources.
 *
 * @param {any} style
 * @param {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} entries
 * @param {IssueFn} error
 * @param {IssueFn} warn
 */
function validateSources(style, entries, error, warn) {
  if (!style.sources) return

  for (const [sourceId, source] of Object.entries(style.sources)) {
    const src = /** @type {any} */ (source)
    const srcPath = `sources.${sourceId}`

    // §8/§9: GeoJSON source — check data file existence
    if (src.type === 'geojson') {
      if (typeof src.data === 'string' && src.data.startsWith(URI_BASE)) {
        const dataPath = src.data.slice(URI_BASE.length)
        if (!entries.has(dataPath)) {
          error(
            'missing_geojson_data',
            `GeoJSON source "${sourceId}" references missing file: ${dataPath}`,
            `${srcPath}.data`,
          )
        }
      }
      continue
    }

    // §5.1: Unsupported source types
    if (src.type !== 'vector' && src.type !== 'raster') {
      warn(
        'unsupported_source_type',
        `Source "${sourceId}" has unsupported type "${src.type}"`,
        srcPath,
      )
      continue
    }

    // §5.6: Source url property must not exist
    if ('url' in src) {
      error(
        'source_has_url',
        `Source "${sourceId}" has url property (must be inlined)`,
        srcPath,
      )
    }

    // §5.6: Required source properties
    for (const prop of ['bounds', 'minzoom', 'maxzoom', 'tiles']) {
      if (!(prop in src)) {
        error(
          'missing_source_property',
          `Source "${sourceId}" missing required property: ${prop}`,
          `${srcPath}.${prop}`,
        )
      }
    }

    // §5.4: Tile coordinate scheme must be xyz or omitted
    if ('scheme' in src && src.scheme !== 'xyz') {
      error(
        'invalid_tile_scheme',
        `Source "${sourceId}" has scheme "${src.scheme}" (must be "xyz" or omitted)`,
        `${srcPath}.scheme`,
      )
    }

    // §5.5: Tile URL template validation
    if (Array.isArray(src.tiles)) {
      if (src.tiles.length !== 1) {
        error(
          'invalid_tile_template',
          `Source "${sourceId}" tiles must contain exactly one URL template, found ${src.tiles.length}`,
          `${srcPath}.tiles`,
        )
      }
      const tileUrl = src.tiles[0]
      if (typeof tileUrl === 'string') {
        if (!tileUrl.startsWith(URI_BASE)) {
          error(
            'invalid_tile_template',
            `Source "${sourceId}" tile URL must use SMP URI scheme (smp://maps.v1/...)`,
            `${srcPath}.tiles`,
          )
        } else if (
          !tileUrl.includes('{z}') ||
          !tileUrl.includes('{x}') ||
          !tileUrl.includes('{y}')
        ) {
          error(
            'invalid_tile_template',
            `Source "${sourceId}" tile URL template missing {z}, {x}, or {y} placeholders`,
            `${srcPath}.tiles`,
          )
        }
      }
    }

    if (!hasValidTileConfig(src)) continue

    const template = src.tiles[0].slice(URI_BASE.length)
    const prefix = template.slice(0, template.indexOf('{z}'))

    // §5.3: Tile format consistency — only check entries matching tile paths
    /** @type {Set<string>} */
    const extensions = new Set()
    const tilePathPattern = /\d+\/\d+\/\d+\.[a-z]+(?:\.gz)?$/
    for (const name of entries.keys()) {
      if (!name.startsWith(prefix)) continue
      if (!tilePathPattern.test(name)) continue
      const extMatch = name.match(/(\.[a-z]+(?:\.gz)?)$/)
      if (extMatch) extensions.add(extMatch[1])
    }
    if (extensions.size > 1) {
      error(
        'mixed_tile_formats',
        `Source "${sourceId}" has mixed tile formats: ${[...extensions].join(', ')}`,
        srcPath,
      )
    }

    // §5.7: Tile completeness check
    let missingCount = 0
    /** @type {string[]} */
    const missingExamples = []
    for (const { x, y, z } of tileIterator({
      bounds: src.bounds,
      minzoom: src.minzoom,
      maxzoom: src.maxzoom,
    })) {
      const tilePath = template
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y))
      if (!entries.has(tilePath)) {
        missingCount++
        if (missingExamples.length < 3) {
          missingExamples.push(tilePath)
        }
      }
    }
    if (missingCount > 0) {
      const examples = missingExamples.join(', ')
      const suffix = missingCount > 3 ? ` and ${missingCount - 3} more` : ''
      error(
        'missing_tiles',
        `Source "${sourceId}" is missing ${missingCount} tile(s): ${examples}${suffix}`,
        srcPath,
      )
    }
  }
}

/** Total number of Unicode BMP glyph ranges (0-255 through 65280-65535) */
const TOTAL_GLYPH_RANGES = 256

/**
 * §4.2.2, §6: Validate glyph references and files.
 *
 * @param {any} style
 * @param {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} entries
 * @param {IssueFn} error
 * @param {IssueFn} warn
 */
function validateGlyphs(style, entries, error, warn) {
  if (typeof style.glyphs !== 'string') return

  if (!style.glyphs.startsWith(URI_BASE)) {
    error(
      'external_resource',
      `Glyphs URL must use SMP URI scheme, found external URL: ${style.glyphs}`,
      'glyphs',
    )
    return
  }

  const glyphTemplate = style.glyphs.slice(URI_BASE.length)

  // §6.3: Must include {fontstack} and {range} placeholders
  const hasPlaceholders =
    glyphTemplate.includes('{fontstack}') && glyphTemplate.includes('{range}')
  if (!hasPlaceholders) {
    error(
      'invalid_glyph_template',
      'Glyph URL template must include {fontstack} and {range} placeholders',
      'glyphs',
    )
  }

  // Check that at least some glyph files exist
  const prefixEnd = glyphTemplate.indexOf('{fontstack}')
  const glyphPrefix = prefixEnd > 0 ? glyphTemplate.slice(0, prefixEnd) : ''
  let hasGlyphs = false
  for (const filename of entries.keys()) {
    if (
      glyphPrefix
        ? filename.startsWith(glyphPrefix)
        : filename.endsWith('.pbf.gz')
    ) {
      hasGlyphs = true
      break
    }
  }
  if (!hasGlyphs) {
    error(
      'missing_glyphs',
      'style.json references glyphs but no glyph files found',
      'glyphs',
    )
    return
  }

  // §6.6: Per-fontstack glyph range completeness
  if (!hasPlaceholders) return
  const fontStacks = collectFontStacks(style.layers || [])
  for (const fontStack of fontStacks) {
    let presentCount = 0
    for (let i = 0; i < TOTAL_GLYPH_RANGES; i++) {
      const start = i * 256
      const range = `${start}-${start + 255}`
      const path = glyphTemplate
        .replace('{fontstack}', fontStack)
        .replace('{range}', range)
      if (entries.has(path)) presentCount++
    }
    if (presentCount === 0) {
      error(
        'missing_font_glyphs',
        `No glyph files found for font "${fontStack}"`,
        'glyphs',
      )
    } else if (presentCount < TOTAL_GLYPH_RANGES) {
      warn(
        'incomplete_font_glyphs',
        `Font "${fontStack}" has ${presentCount} of ${TOTAL_GLYPH_RANGES} glyph ranges (all ${TOTAL_GLYPH_RANGES} recommended for offline use)`,
        'glyphs',
      )
    }
  }
}

/**
 * Collect all unique fontstack strings referenced by style layers' `text-font`
 * properties. Each fontstack is the comma-joined font array, matching how
 * MapLibre requests glyphs via the `{fontstack}` placeholder.
 *
 * Handles both plain arrays (`["Font A", "Font B"]`) and expressions
 * containing `["literal", ["Font A"]]` nodes.
 *
 * @param {any[]} layers
 * @returns {Set<string>}
 */
function collectFontStacks(layers) {
  /** @type {Set<string>} */
  const stacks = new Set()
  for (const layer of layers) {
    if (layer.type !== 'symbol' || !layer.layout?.['text-font']) continue
    collectFontStacksFromValue(layer.layout['text-font'], stacks)
  }
  return stacks
}

/**
 * Recursively extract fontstack strings from a `text-font` value, which may
 * be a plain string array or an expression tree.
 *
 * @param {unknown} value
 * @param {Set<string>} stacks
 */
function collectFontStacksFromValue(value, stacks) {
  if (!Array.isArray(value) || value.length === 0) return

  // ["literal", ["Font A", "Font B"]]
  if (value[0] === 'literal' && Array.isArray(value[1])) {
    stacks.add(value[1].join(','))
    return
  }

  // Expression: first element is a known MapLibre expression operator
  if (typeof value[0] === 'string' && value[0] in expressions) {
    for (let i = 1; i < value.length; i++) {
      if (Array.isArray(value[i])) {
        collectFontStacksFromValue(value[i], stacks)
      }
    }
    return
  }

  // Plain fontstack: ["Font A", "Font B"]
  if (value.every((/** @type {unknown} */ v) => typeof v === 'string')) {
    stacks.add(value.join(','))
  }
}

/**
 * §4.2.2, §7: Validate sprite references and files.
 *
 * @param {any} style
 * @param {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} entries
 * @param {IssueFn} error
 * @param {IssueFn} warn
 */
function validateSprites(style, entries, error, warn) {
  if (typeof style.sprite === 'string') {
    if (!style.sprite.startsWith(URI_BASE)) {
      error(
        'external_resource',
        `Sprite URL must use SMP URI scheme, found external URL: ${style.sprite}`,
        'sprite',
      )
      return
    }
    const basePath = style.sprite.slice(URI_BASE.length)
    validateSpriteFiles(entries, basePath, error, warn)
  } else if (Array.isArray(style.sprite)) {
    for (const { url } of style.sprite) {
      if (typeof url !== 'string') continue
      if (!url.startsWith(URI_BASE)) {
        error(
          'external_resource',
          `Sprite URL must use SMP URI scheme, found external URL: ${url}`,
          'sprite',
        )
        continue
      }
      const basePath = url.slice(URI_BASE.length)
      validateSpriteFiles(entries, basePath, error, warn)
    }
  }
}

/**
 * Check that the required sprite files exist for a given base path.
 *
 * @param {Map<string, any>} entries
 * @param {string} basePath sprite base path (without extension)
 * @param {IssueFn} error
 * @param {IssueFn} warn
 */
function validateSpriteFiles(entries, basePath, error, warn) {
  const jsonPath = basePath + '.json'
  const pngPath = basePath + '.png'
  const json2xPath = basePath + '@2x.json'
  const png2xPath = basePath + '@2x.png'

  if (!entries.has(jsonPath)) {
    error('missing_sprite', `Missing sprite file: ${jsonPath}`, jsonPath)
  }
  if (!entries.has(pngPath)) {
    error('missing_sprite', `Missing sprite file: ${pngPath}`, pngPath)
  }
  if (!entries.has(json2xPath) || !entries.has(png2xPath)) {
    warn(
      'missing_sprite_2x',
      `Missing @2x sprite for "${basePath}" (recommended but not required)`,
      basePath,
    )
  }
}

/**
 * Check whether a source has all the properties needed for tile-level checks
 * (format consistency, completeness).
 *
 * @param {any} src
 * @returns {boolean}
 */
function hasValidTileConfig(src) {
  return (
    Array.isArray(src.tiles) &&
    src.tiles.length > 0 &&
    typeof src.tiles[0] === 'string' &&
    src.tiles[0].startsWith(URI_BASE) &&
    src.tiles[0].includes('{z}') &&
    Array.isArray(src.bounds) &&
    typeof src.minzoom === 'number' &&
    typeof src.maxzoom === 'number'
  )
}

/**
 * Iterate tile coordinates for a bounding box and zoom range.
 * @param {object} opts
 * @param {[number, number, number, number]} opts.bounds [west, south, east, north]
 * @param {number} opts.minzoom
 * @param {number} opts.maxzoom
 */
function* tileIterator({ bounds, minzoom, maxzoom }) {
  for (let z = minzoom; z <= maxzoom; z++) {
    const { minX, minY, maxX, maxY } = sm.xyz([...bounds], z)
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        yield { x, y, z }
      }
    }
  }
}
