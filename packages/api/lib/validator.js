import { ZipReader } from '@gmaclennan/zip-reader'
import SphericalMercator from '@mapbox/sphericalmercator'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'

import { STYLE_FILE, URI_BASE, VERSION_FILE } from './utils/templates.js'

/** Major version(s) supported by this implementation */
const SUPPORTED_MAJOR_VERSIONS = [1]

const sm = new SphericalMercator({ size: 256 })

/**
 * @typedef {object} ValidationIssue
 * @property {'error' | 'warning'} kind - error = spec MUST violation; warning = SHOULD/RECOMMENDED
 * @property {string} type - Stable identifier for programmatic matching
 * @property {string} message - Human-readable description
 * @property {string} [path] - Location context (e.g. 'sources.test.tiles', 'VERSION')
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid - true when there are no errors (warnings are acceptable)
 * @property {ValidationIssue[]} issues - all issues found
 */

/**
 * Validate a Styled Map Package file against the SMP specification.
 *
 * Returns a list of issues, each with a `kind` ('error' or 'warning') and a
 * stable `type` string for programmatic filtering. Errors indicate spec MUST
 * violations; warnings indicate SHOULD/RECOMMENDED violations.
 *
 * @param {string | import('@gmaclennan/zip-reader').ZipReader} source Path to the .smp file, or a ZipReader instance
 * @returns {Promise<ValidationResult>}
 */
export async function validate(source) {
  /** @type {ValidationIssue[]} */
  const issues = []
  const error = (
    /** @type {string} */ type,
    /** @type {string} */ message,
    /** @type {string} [path] */ path,
  ) =>
    issues.push({ kind: 'error', type, message, ...(path != null && { path }) })
  const warn = (
    /** @type {string} */ type,
    /** @type {string} */ message,
    /** @type {string} [path] */ path,
  ) =>
    issues.push({
      kind: 'warning',
      type,
      message,
      ...(path != null && { path }),
    })

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
      return { valid: false, issues }
    }
    error('invalid_zip', `Not a valid ZIP file: ${message}`)
    return { valid: false, issues }
  }

  try {
    // Build entry map and check entry name safety (§3.4, §11)
    /** @type {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} */
    const entries = new Map()
    try {
      for await (const entry of zip) {
        const name = entry.name
        if (
          name.includes('..') ||
          name.startsWith('/') ||
          /^[A-Za-z]:/.test(name)
        ) {
          error('unsafe_entry', `Unsafe ZIP entry name: ${name}`, name)
        }
        entries.set(name, entry)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/Relative path|Absolute path|Unsafe/i.test(message)) {
        error('unsafe_entry', `ZIP contains unsafe entry: ${message}`)
        return { valid: false, issues }
      }
      throw err
    }

    // §3.1: VERSION file
    const versionEntry = entries.get(VERSION_FILE)
    if (!versionEntry) {
      warn(
        'missing_version',
        'Missing VERSION file (assuming version 1.0)',
        'VERSION',
      )
    } else {
      const version = (
        await new Response(versionEntry.readable()).text()
      ).trim()
      const majorMatch = version.match(/^(\d+)\.\d+$/)
      if (!majorMatch) {
        warn(
          'invalid_version_format',
          `Invalid version format: "${version}" (expected MAJOR.MINOR)`,
          'VERSION',
        )
      } else {
        const major = parseInt(majorMatch[1], 10)
        if (!SUPPORTED_MAJOR_VERSIONS.includes(major)) {
          error(
            'unsupported_version',
            `Unsupported major version: ${major} (supported: ${SUPPORTED_MAJOR_VERSIONS.join(', ')})`,
            'VERSION',
          )
        }
      }
    }

    // §4.1: style.json presence
    const styleEntry = entries.get(STYLE_FILE)
    if (!styleEntry) {
      error('missing_style', 'Missing style.json', 'style.json')
      return { valid: false, issues }
    }

    // §4.1: style.json validity
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
      return { valid: false, issues }
    }

    const styleErrors = validateStyleMin(
      /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */ (
        style
      ),
    )
    for (const e of styleErrors) {
      error('invalid_style', `style.json: ${e.message}`, 'style.json')
    }

    // §4.3: SMP metadata (all OPTIONAL → warnings)
    const metadata = style.metadata || {}

    if (
      !Array.isArray(metadata['smp:bounds']) ||
      metadata['smp:bounds'].length !== 4
    ) {
      warn(
        'missing_smp_bounds',
        'Missing or invalid smp:bounds in metadata',
        'metadata.smp:bounds',
      )
    }

    if (typeof metadata['smp:maxzoom'] !== 'number') {
      warn(
        'missing_smp_maxzoom',
        'Missing or invalid smp:maxzoom in metadata',
        'metadata.smp:maxzoom',
      )
    }

    const sourceFolders = metadata['smp:sourceFolders']
    if (sourceFolders && typeof sourceFolders !== 'object') {
      warn(
        'invalid_smp_source_folders',
        'Invalid smp:sourceFolders in metadata',
        'metadata.smp:sourceFolders',
      )
    }

    // §5.6, §5.7: Source validation
    if (style.sources) {
      for (const [sourceId, source] of Object.entries(style.sources)) {
        const src = /** @type {any} */ (source)
        if (src.type === 'geojson') continue

        // §5.6: Source url property must not exist
        if ('url' in src) {
          error(
            'source_has_url',
            `Source "${sourceId}" has url property (must be inlined)`,
            `sources.${sourceId}`,
          )
        }

        // §5.6: Required source properties
        for (const prop of ['bounds', 'minzoom', 'maxzoom', 'tiles']) {
          if (!(prop in src)) {
            error(
              'missing_source_property',
              `Source "${sourceId}" missing required property: ${prop}`,
              `sources.${sourceId}.${prop}`,
            )
          }
        }

        // §5.7: Tile completeness check
        if (
          Array.isArray(src.tiles) &&
          src.tiles.length > 0 &&
          typeof src.tiles[0] === 'string' &&
          src.tiles[0].startsWith(URI_BASE) &&
          Array.isArray(src.bounds) &&
          typeof src.minzoom === 'number' &&
          typeof src.maxzoom === 'number'
        ) {
          const template = src.tiles[0].slice(URI_BASE.length)
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
            const suffix =
              missingCount > 3 ? ` and ${missingCount - 3} more` : ''
            error(
              'missing_tiles',
              `Source "${sourceId}" is missing ${missingCount} tile(s): ${examples}${suffix}`,
              `sources.${sourceId}`,
            )
          }
        }
      }
    }

    // §6, §9: Glyph verification
    if (typeof style.glyphs === 'string' && style.glyphs.startsWith(URI_BASE)) {
      const glyphTemplate = style.glyphs.slice(URI_BASE.length)
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
      }
    }

    // §7, §9: Sprite verification
    if (typeof style.sprite === 'string' && style.sprite.startsWith(URI_BASE)) {
      const basePath = style.sprite.slice(URI_BASE.length)
      validateSpriteFiles(entries, basePath, error, warn)
    } else if (Array.isArray(style.sprite)) {
      for (const { url } of style.sprite) {
        if (typeof url === 'string' && url.startsWith(URI_BASE)) {
          const basePath = url.slice(URI_BASE.length)
          validateSpriteFiles(entries, basePath, error, warn)
        }
      }
    }
  } finally {
    if (fileSource) await fileSource.close()
  }

  return { valid: !issues.some((i) => i.kind === 'error'), issues }
}

/**
 * @param {Map<string, any>} entries
 * @param {string} basePath sprite base path (without extension)
 * @param {(type: string, message: string, path?: string) => void} error
 * @param {(type: string, message: string, path?: string) => void} warn
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
 * Iterate tile coordinates for a bounding box and zoom range.
 * @param {object} opts
 * @param {number[]} opts.bounds [west, south, east, north]
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
