import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const BIN_DIR = path.resolve(import.meta.dirname, '../bin')

describe('help output', () => {
  test('smp --help', async () => {
    const { stdout } = await execFileAsync('node', [
      path.join(BIN_DIR, 'smp.js'),
      '--help',
    ])
    expect(stdout).toMatchSnapshot()
  })

  test('smp download --help', async () => {
    const { stdout } = await execFileAsync('node', [
      path.join(BIN_DIR, 'smp-download.js'),
      '--help',
    ])
    expect(stdout).toMatchSnapshot()
  })

  test('smp view --help', async () => {
    const { stdout } = await execFileAsync('node', [
      path.join(BIN_DIR, 'smp-view.js'),
      '--help',
    ])
    expect(stdout).toMatchSnapshot()
  })

  test('smp mbtiles --help', async () => {
    const { stdout } = await execFileAsync('node', [
      path.join(BIN_DIR, 'smp-mbtiles.js'),
      '--help',
    ])
    expect(stdout).toMatchSnapshot()
  })
})

describe('error output', () => {
  test('smp download rejects invalid bbox', async () => {
    await expect(
      execFileAsync('node', [
        path.join(BIN_DIR, 'smp-download.js'),
        '--bbox',
        '11,47,12',
        'https://example.com/style.json',
      ]),
    ).rejects.toMatchObject({
      code: 1,
    })
  })

  test('smp download rejects invalid zoom', async () => {
    await expect(
      execFileAsync('node', [
        path.join(BIN_DIR, 'smp-download.js'),
        '--zoom',
        '25',
        'https://example.com/style.json',
      ]),
    ).rejects.toMatchObject({
      code: 1,
    })
  })

  test('smp view requires file argument', async () => {
    await expect(
      execFileAsync('node', [path.join(BIN_DIR, 'smp-view.js')]),
    ).rejects.toMatchObject({
      code: 1,
    })
  })

  test('smp mbtiles requires mbtiles argument', async () => {
    await expect(
      execFileAsync('node', [path.join(BIN_DIR, 'smp-mbtiles.js')]),
    ).rejects.toMatchObject({
      code: 1,
    })
  })
})
