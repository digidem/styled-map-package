import { MBTiles } from 'mbtiles-reader'
import { temporaryFile } from 'tempy'
import { onTestFinished, test } from 'vitest'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buffer } from 'node:stream/consumers'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { fromMBTiles } from '../lib/from-mbtiles.js'
import { Reader } from '../lib/reader.js'

test('convert from MBTiles', async () => {
  const fixture = fileURLToPath(
    new URL('./fixtures/plain_1.mbtiles', import.meta.url),
  )
  const output1 = temporaryFile()
  const output2 = temporaryFile()

  onTestFinished(() => {
    fs.unlinkSync(output1)
    fs.unlinkSync(output2)
  })

  await Promise.all([
    fromMBTiles(fixture, output1),
    pipeline(fromMBTiles(fixture), fs.createWriteStream(output2)),
  ])

  for (const output of [output1, output2]) {
    const smp = new Reader(output)
    const mbtiles = new MBTiles(fixture)
    const style = await smp.getStyle('')
    const sourceMetadata = Object.values(style.sources)[0]
    assert.equal(sourceMetadata.type, 'raster')
    let tileCount = 0
    for (const { x, y, z, data } of mbtiles) {
      tileCount++
      const path = replaceVariables(sourceMetadata.tiles[0], { x, y, z })
      const smpTile = await smp.getResource(path)
      assert.deepEqual(await buffer(smpTile.stream), data)
      assert.equal(smpTile.contentType, 'image/png')
    }
    assert(tileCount > 10, 'expected more than 10 tiles')
  }
})

/**
 * Replaces variables in a string with values provided in an object. Variables
 * in the string are denoted by curly braces, e.g., {variableName}.
 *
 * @param {string} template - The string containing variables wrapped in curly braces.
 * @param {Record<string, string | number>} variables - An object where the keys correspond to variable names and values correspond to the replacement values.
 * @returns {string} The string with the variables replaced by their corresponding values.
 */
function replaceVariables(template, variables) {
  return template.replace(/{(.*?)}/g, (match, varName) => {
    return varName in variables ? String(variables[varName]) : match
  })
}
