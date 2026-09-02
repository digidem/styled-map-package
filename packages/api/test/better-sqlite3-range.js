import semver from 'semver'
import { assert, test } from 'vitest'

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

/**
 * mbtiles-reader does not export ./package.json, so walk up from its entry
 * point to find the manifest.
 * @param {string} name
 */
function readManifest(name) {
  let dir = path.dirname(require.resolve(name))
  for (;;) {
    const candidate = path.join(dir, 'package.json')
    try {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8'))
      if (manifest.name === name) return manifest
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`could not find ${name}/package.json`)
    dir = parent
  }
}

const declared =
  require('../package.json').optionalDependencies['better-sqlite3']
const viaMbtilesReader =
  readManifest('mbtiles-reader').optionalDependencies['better-sqlite3']

test('better-sqlite3 range overlaps the one mbtiles-reader asks for', () => {
  // We never import better-sqlite3 ourselves — mbtiles-reader does. Our range
  // exists only so we are not a second, conflicting constraint: if the two stop
  // overlapping, npm installs a duplicate copy of the native module.
  assert(
    semver.intersects(declared, viaMbtilesReader),
    `optionalDependencies.better-sqlite3 is "${declared}" but mbtiles-reader asks for "${viaMbtilesReader}"; they must overlap so a single copy satisfies both`,
  )
})

test('better-sqlite3 range accepts both supported majors', () => {
  for (const version of ['12.8.0', '13.0.0']) {
    assert(
      semver.satisfies(version, declared),
      `better-sqlite3 ${version} should satisfy "${declared}"`,
    )
  }
})
