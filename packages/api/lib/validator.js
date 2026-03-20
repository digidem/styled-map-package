import { ZipReader } from '@gmaclennan/zip-reader'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'

import { STYLE_FILE, URI_BASE, VERSION_FILE } from './utils/templates.js'

/** Major version(s) supported by this implementation */
const SUPPORTED_MAJOR_VERSIONS = [1]

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors
 * @property {string[]} warnings
 */

/**
 * Validate a Styled Map Package file against the SMP specification.
 *
 * @param {string | import('@gmaclennan/zip-reader').ZipReader} source Path to the .smp file, or a ZipReader instance
 * @returns {Promise<ValidationResult>}
 */
export async function validate(source) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  // Level 1: ZIP validity
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
      return result(errors, warnings, `File not found: ${source}`)
    }
    return result(errors, warnings, `Not a valid ZIP file: ${message}`)
  }

  try {
    // Build entry map
    /** @type {Map<string, import('@gmaclennan/zip-reader').ZipEntry>} */
    const entries = new Map()
    for await (const entry of zip) {
      entries.set(entry.name, entry)
    }

    // Level 2: VERSION file
    const versionEntry = entries.get(VERSION_FILE)
    if (!versionEntry) {
      warnings.push('Missing VERSION file (assuming version 1.0)')
    } else {
      const version = (
        await new Response(versionEntry.readable()).text()
      ).trim()
      const majorMatch = version.match(/^(\d+)\.\d+$/)
      if (!majorMatch) {
        errors.push(
          `Invalid version format: "${version}" (expected MAJOR.MINOR)`,
        )
      } else {
        const major = parseInt(majorMatch[1], 10)
        if (!SUPPORTED_MAJOR_VERSIONS.includes(major)) {
          errors.push(
            `Unsupported major version: ${major} (supported: ${SUPPORTED_MAJOR_VERSIONS.join(', ')})`,
          )
        }
      }
    }

    // Level 3: style.json presence
    const styleEntry = entries.get(STYLE_FILE)
    if (!styleEntry) {
      errors.push('Missing style.json')
      return { valid: false, errors, warnings }
    }

    // Level 4: style.json validity
    /** @type {any} */
    let style
    try {
      style = await new Response(styleEntry.readable()).json()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`style.json is not valid JSON: ${message}`)
      return { valid: false, errors, warnings }
    }

    const styleErrors = validateStyleMin(
      /** @type {import('@maplibre/maplibre-gl-style-spec').StyleSpecification} */ (
        style
      ),
    )
    for (const e of styleErrors) {
      errors.push(`style.json: ${e.message}`)
    }

    // Level 5: SMP metadata
    const metadata = style.metadata || {}

    if (
      !Array.isArray(metadata['smp:bounds']) ||
      metadata['smp:bounds'].length !== 4
    ) {
      errors.push('Missing or invalid smp:bounds in style.json metadata')
    } else {
      const [w, s, e, n] = metadata['smp:bounds']
      if (
        typeof w !== 'number' ||
        typeof s !== 'number' ||
        typeof e !== 'number' ||
        typeof n !== 'number'
      ) {
        errors.push('smp:bounds values must be numbers')
      }
    }

    if (typeof metadata['smp:maxzoom'] !== 'number') {
      errors.push('Missing or invalid smp:maxzoom in style.json metadata')
    }

    const sourceFolders = metadata['smp:sourceFolders']
    if (sourceFolders && typeof sourceFolders !== 'object') {
      warnings.push('Invalid smp:sourceFolders in style.json metadata')
    }

    // Level 6: Source verification — extract tile path prefix from URL template
    if (style.sources) {
      for (const [sourceId, source] of Object.entries(style.sources)) {
        if (
          /** @type {any} */ (source).tiles &&
          Array.isArray(/** @type {any} */ (source).tiles)
        ) {
          for (const tileUrl of /** @type {any} */ (source).tiles) {
            if (typeof tileUrl === 'string' && tileUrl.startsWith(URI_BASE)) {
              // Extract the path prefix before {z} from the URL template
              const templatePath = tileUrl.slice(URI_BASE.length)
              const prefixEnd = templatePath.indexOf('{z}')
              if (prefixEnd === -1) continue
              const tilePrefix = templatePath.slice(0, prefixEnd)
              let hasTiles = false
              for (const filename of entries.keys()) {
                if (filename.startsWith(tilePrefix)) {
                  hasTiles = true
                  break
                }
              }
              if (!hasTiles) {
                errors.push(
                  `No tile files found for source "${sourceId}" (expected under ${tilePrefix})`,
                )
              }
            }
          }
        }
      }
    }

    // Level 7: Glyph verification — extract path prefix from glyphs URI
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
        errors.push('style.json references glyphs but no glyph files found')
      }
    }

    // Level 8: Sprite verification — extract base path from sprite URI
    if (typeof style.sprite === 'string' && style.sprite.startsWith(URI_BASE)) {
      const basePath = style.sprite.slice(URI_BASE.length)
      validateSpriteFiles(entries, basePath, errors, warnings)
    } else if (Array.isArray(style.sprite)) {
      for (const { url } of style.sprite) {
        if (typeof url === 'string' && url.startsWith(URI_BASE)) {
          const basePath = url.slice(URI_BASE.length)
          validateSpriteFiles(entries, basePath, errors, warnings)
        }
      }
    }
  } finally {
    if (fileSource) await fileSource.close()
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * @param {Map<string, any>} entries
 * @param {string} basePath sprite base path (without extension)
 * @param {string[]} errors
 * @param {string[]} warnings
 */
function validateSpriteFiles(entries, basePath, errors, warnings) {
  const jsonPath = basePath + '.json'
  const pngPath = basePath + '.png'
  const json2xPath = basePath + '@2x.json'
  const png2xPath = basePath + '@2x.png'

  if (!entries.has(jsonPath)) {
    errors.push(`Missing sprite file: ${jsonPath}`)
  }
  if (!entries.has(pngPath)) {
    errors.push(`Missing sprite file: ${pngPath}`)
  }
  if (!entries.has(json2xPath) || !entries.has(png2xPath)) {
    warnings.push(
      `Missing @2x sprite for "${basePath}" (recommended but not required)`,
    )
  }
}

/**
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {string} error
 * @returns {ValidationResult}
 */
function result(errors, warnings, error) {
  errors.push(error)
  return { valid: false, errors, warnings }
}
