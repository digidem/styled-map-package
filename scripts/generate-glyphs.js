#!/usr/bin/env node

/**
 * Generate pre-built PBF glyph ranges from GoNotoKurrent (merged Noto Sans
 * covering 80+ scripts) for use as fallback glyphs in the SMP server.
 *
 * Prerequisites:
 *   cargo install build_pbf_glyphs
 *
 * Usage:
 *   node scripts/generate-glyphs.js [path/to/font.ttf]
 *
 * This script:
 * 1. Downloads GoNotoKurrent-Regular.ttf from go-noto-universal (if no TTF provided)
 * 2. Runs build_pbf_glyphs to generate all 256 PBF glyph ranges
 * 3. Copies ranges that contain actual glyphs to packages/glyphs/fixtures/glyphs/
 * 4. Ranges with no glyphs are not shipped — the fallback handler serves empty PBFs
 *
 * GoNotoKurrent is a merged build of 80+ Noto Sans script-specific fonts,
 * covering 37,000+ codepoints (Latin, Cyrillic, Greek, Arabic, Hebrew,
 * Devanagari, Thai, CJK IICore, and many more). OFL 1.1 licensed.
 * https://github.com/satbyy/go-noto-universal
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { LOCAL_GLYPH_RANGES } from '../packages/api/lib/utils/style.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(ROOT, 'packages', 'glyphs', 'fixtures', 'glyphs')

const GO_NOTO_URL =
  'https://github.com/satbyy/go-noto-universal/releases/download/v7.0/GoNotoKurrent-Regular.ttf'

// Minimum file size (bytes) to consider a PBF range as containing real glyphs.
// Empty ranges from build_pbf_glyphs are ~29 bytes (just the protobuf wrapper).
const MIN_GLYPH_SIZE = 50

// Additional ranges to exclude from the fallback glyph package because they
// contain legacy/uncommon codepoints rarely used in map labels. These are NOT
// rendered locally by MapLibre — they are simply omitted as a size optimization
// for the fallback package. The fallback handler serves empty PBFs for these.
const UNCOMMON_RANGES = [
  [0xfc00, 0xfe00], // Arabic Presentation Forms A (legacy precomposed ligatures)
]

/**
 * Check whether a PBF glyph range should be excluded from the fallback
 * glyph package — either because MapLibre renders it client-side, or because
 * it contains uncommon codepoints not worth shipping.
 * @param {number} rangeStart
 */
function isExcludedRange(rangeStart) {
  return (
    LOCAL_GLYPH_RANGES.some(
      ([start, end]) => rangeStart >= start && rangeStart < end,
    ) ||
    UNCOMMON_RANGES.some(
      ([start, end]) => rangeStart >= start && rangeStart < end,
    )
  )
}

/**
 * Download a file from a URL to a local path, following redirects.
 * @param {string} url
 * @param {string} dest
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (/** @type {string} */ u) => {
      https
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return follow(/** @type {string} */ (res.headers.location))
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          }
          const file = fs.createWriteStream(dest)
          res.pipe(file)
          file.on('finish', () => file.close(resolve))
        })
        .on('error', reject)
    }
    follow(url)
  })
}

async function main() {
  // 1. Check prerequisites
  try {
    execSync('build_pbf_glyphs --help', { stdio: 'ignore' })
  } catch {
    console.error(
      'Error: build_pbf_glyphs not found.\n' +
        'Install it with: cargo install build_pbf_glyphs\n' +
        'Requires Rust and FreeType to be installed.',
    )
    process.exit(1)
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-glyphs-'))
  const fontDir = path.join(tmpDir, 'fonts')
  const pbfDir = path.join(tmpDir, 'pbf')
  fs.mkdirSync(fontDir, { recursive: true })

  try {
    // 2. Get the font file
    const ttfPath = path.join(fontDir, 'GoNotoKurrent-Regular.ttf')

    if (process.argv[2]) {
      console.log(`Using local font: ${process.argv[2]}`)
      fs.copyFileSync(process.argv[2], ttfPath)
    } else {
      console.log('Downloading GoNotoKurrent-Regular.ttf (~15 MB)...')
      await download(GO_NOTO_URL, ttfPath)
      const size = fs.statSync(ttfPath).size
      console.log(`Downloaded ${(size / 1024 / 1024).toFixed(1)} MB`)
    }

    // 3. Generate all PBF ranges
    console.log('Generating PBF glyph ranges (this may take a minute)...')
    execSync(`build_pbf_glyphs "${fontDir}" "${pbfDir}"`, {
      stdio: 'inherit',
    })

    // The output structure is: pbfDir/<fontname>/<range>.pbf
    const fontDirs = fs.readdirSync(pbfDir)
    if (fontDirs.length === 0) {
      throw new Error('No font directories generated')
    }
    const generatedDir = path.join(pbfDir, fontDirs[0])

    // 4. Copy non-empty ranges to output
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })

    // Clean existing PBF files
    for (const f of fs.readdirSync(OUTPUT_DIR)) {
      if (f.endsWith('.pbf')) {
        fs.unlinkSync(path.join(OUTPUT_DIR, f))
      }
    }

    const allFiles = fs
      .readdirSync(generatedDir)
      .filter((f) => f.endsWith('.pbf'))
      .sort((a, b) => {
        const aStart = parseInt(a.split('-')[0])
        const bStart = parseInt(b.split('-')[0])
        return aStart - bStart
      })

    let totalSize = 0
    let copiedCount = 0
    let skippedCount = 0

    for (const filename of allFiles) {
      const src = path.join(generatedDir, filename)
      const data = fs.readFileSync(src)
      const rangeStart = parseInt(filename.split('-')[0])

      const excluded = isExcludedRange(rangeStart)

      if (excluded || data.length <= MIN_GLYPH_SIZE) {
        skippedCount++
      } else {
        fs.copyFileSync(src, path.join(OUTPUT_DIR, filename))
        totalSize += data.length
        copiedCount++
        console.log(`  ${filename} (${(data.length / 1024).toFixed(1)} KB)`)
      }
    }

    console.log(
      `\nDone! Copied ${copiedCount} PBF files, skipped ${skippedCount} empty ranges.`,
    )
    console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`)
    console.log(`Output: ${OUTPUT_DIR}`)
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
