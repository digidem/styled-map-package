import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const BIN_DIR = path.resolve(import.meta.dirname, '../bin')
const FIXTURE_SMP = path.resolve(
  import.meta.dirname,
  '../../api/test/fixtures/demotiles-z2.smp',
)

describe('smp view (smoke)', () => {
  test(
    'starts server and prints listening address',
    { timeout: 15000 },
    async () => {
      const child = execFileAsync('node', [
        path.join(BIN_DIR, 'smp-view.js'),
        FIXTURE_SMP,
        '--port',
        '3456',
      ])
      // Suppress the expected rejection when we kill the process
      child.catch(() => {})

      let output = ''

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.child.kill()
          reject(new Error('Timed out waiting for server to start'))
        }, 10000)

        child.child.stdout.on('data', (chunk) => {
          output += chunk.toString()
          if (output.includes('listening on')) {
            clearTimeout(timeout)
            child.child.kill()
            resolve(undefined)
          }
        })

        child.child.stderr.on('data', (chunk) => {
          output += chunk.toString()
        })

        child.child.on('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })

      expect(output).toMatch(/server listening on http:\/\/127\.0\.0\.1:\d+/)
    },
  )
})
