import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Empty gzip stream (gzipped empty buffer, 20 bytes). Served for ranges
 * without pre-built glyphs — MapLibre treats this as "no glyphs" and
 * renders blank space rather than erroring on a 404.
 */
const EMPTY_GZ = /* @__PURE__ */ fromHex(
  '1f8b080000000000001303000000000000000000',
)

// Resolve fixtures relative to package root (works from both lib/ and dist/
// because tsup rewrites import.meta.url for CJS output)
const GLYPHS_DIR = fileURLToPath(new URL('../fixtures/glyphs', import.meta.url))

/** @type {Map<string, Uint8Array | null>} */
const cache = new Map()

/**
 * Read a gzipped PBF glyph range file, returning the cached buffer or null if not found.
 * @param {string} range
 * @returns {Uint8Array | null}
 */
function getGlyphPbf(range) {
  if (cache.has(range))
    return /** @type {Uint8Array | null} */ (cache.get(range))
  const filePath = path.join(GLYPHS_DIR, `${range}.pbf.gz`)
  try {
    const data = fs.readFileSync(filePath)
    cache.set(range, data)
    return data
  } catch {
    cache.set(range, null)
    return null
  }
}

/**
 * Fallback glyph handler that serves pre-built Noto Sans (GoNotoKurrent) PBF
 * glyph ranges for common scripts, and empty PBFs for uncommon/CJK ranges
 * (which MapLibre renders client-side via `localIdeographFontFamily`).
 *
 * All responses are gzip-encoded — both pre-built ranges (stored as .pbf.gz)
 * and empty fallbacks. Fixtures are stored compressed to reduce package size.
 *
 * Covers 80+ scripts including Latin, Cyrillic, Greek, Arabic, Hebrew,
 * Devanagari, Thai, and more. See https://github.com/satbyy/go-noto-universal
 *
 * For use with `createServer({ fallbackGlyph })` from `styled-map-package-api`.
 *
 * @param {string} _fontstack
 * @param {string} range
 * @returns {Response}
 */
export function notoGlyphFallback(_fontstack, range) {
  const gz = getGlyphPbf(range) ?? EMPTY_GZ
  return new Response(gz, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-protobuf',
      'Content-Encoding': 'gzip',
      'Content-Length': String(gz.byteLength),
      'Cache-Control': 'public, max-age=604800',
    },
  })
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}
