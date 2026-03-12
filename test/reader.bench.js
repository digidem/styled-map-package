import { bench, describe } from 'vitest'

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { Reader } from '../lib/reader.js'

const FIXTURE = resolve('test/fixtures/openfreemap-z6.smp')

/**
 * Drain a web ReadableStream to completion.
 * @param {ReadableStream<Uint8Array>} readable
 */
async function drain(readable) {
  const reader = readable.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}

describe.skipIf(!existsSync(FIXTURE))('Reader performance', () => {
  bench(
    'getStyle() immediate',
    async () => {
      const reader = new Reader(FIXTURE)
      await reader.getStyle()
      await reader.close()
    },
    { warmupIterations: 1, iterations: 10 },
  )

  bench(
    'getStyle() after opened()',
    async () => {
      const reader = new Reader(FIXTURE)
      await reader.opened()
      await reader.getStyle()
      await reader.close()
    },
    { warmupIterations: 1, iterations: 10 },
  )

  bench(
    'getVersion() immediate',
    async () => {
      const reader = new Reader(FIXTURE)
      await reader.getVersion()
      await reader.close()
    },
    { warmupIterations: 1, iterations: 10 },
  )

  bench(
    'getVersion() after opened()',
    async () => {
      const reader = new Reader(FIXTURE)
      await reader.opened()
      await reader.getVersion()
      await reader.close()
    },
    { warmupIterations: 1, iterations: 10 },
  )

  bench(
    'getResource() low-zoom tile immediate',
    async () => {
      const reader = new Reader(FIXTURE)
      const resource = await reader.getResource('s/1/0/0/0.mvt.gz')
      await drain(resource.stream)
      await reader.close()
    },
    { warmupIterations: 1, iterations: 10 },
  )

  bench(
    'getResource() low-zoom tile after opened()',
    async () => {
      const reader = new Reader(FIXTURE)
      await reader.opened()
      const resource = await reader.getResource('s/1/0/0/0.mvt.gz')
      await drain(resource.stream)
      await reader.close()
    },
    { warmupIterations: 1, iterations: 10 },
  )
})
