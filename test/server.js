import { execa } from 'execa'
import createFastify from 'fastify'

import assert from 'node:assert/strict'
import { test } from 'node:test'

import createServer from '../lib/server.js'
import { validateStyle } from '../lib/utils/style.js'
import { replaceVariables } from '../lib/utils/templates.js'

test('server basic', async () => {
  const filepath = new URL('./fixtures/demotiles-z2.smp', import.meta.url)
    .pathname
  const fastify = createFastify()
  fastify.register(createServer, { filepath })
  await fastify.listen()
  const response = await fastify.inject({ url: '/style.json' })
  assert.equal(response.statusCode, 200)
  assert.equal(
    response.rawPayload.length,
    Number(response.headers['content-length']),
    'Content-Length header is correct',
  )
  const style = response.json()
  assert(validateStyle(style), 'style is valid')

  {
    assert(typeof style.glyphs === 'string')
    const glyphUrl = replaceVariables(style.glyphs, {
      fontstack: 'Open Sans Semibold',
      range: '0-255',
    })
    const response = await fastify.inject({ url: glyphUrl })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'application/x-protobuf')
    assert.equal(response.headers['content-encoding'], 'gzip')
    assert(response.headers['content-length'])

    assert.equal(
      response.rawPayload.length,
      Number(response.headers['content-length']),
      'Content-Length header is correct',
    )
  }

  {
    const tileSource = Object.values(style.sources).find(
      (source) => source.type === 'vector',
    )
    assert(tileSource?.tiles)
    const tileUrl = replaceVariables(tileSource.tiles[0], {
      z: 0,
      x: 0,
      y: 0,
    })
    const response = await fastify.inject({ url: tileUrl })
    assert.equal(response.statusCode, 200)
    assert.equal(
      response.headers['content-type'],
      'application/vnd.mapbox-vector-tile',
    )
    assert.equal(response.headers['content-encoding'], 'gzip')
    assert(response.headers['content-length'])

    assert.equal(
      response.rawPayload.length,
      Number(response.headers['content-length']),
      'Content-Length header is correct',
    )
  }
  await fastify.close()
})

test('server.close() closes reader', { skip: isWin() }, async () => {
  const filepath = new URL('./fixtures/demotiles-z2.smp', import.meta.url)
    .pathname
  const fastify = createFastify()
  fastify.register(createServer, { filepath })
  await fastify.listen()
  assert.equal(await fdCount(filepath), 1)
  await fastify.close()
  assert.equal(await fdCount(filepath), 0)
})

test('server lazy', { skip: isWin() }, async () => {
  const filepath = new URL('./fixtures/demotiles-z2.smp', import.meta.url)
    .pathname
  const fastify = createFastify()
  fastify.register(createServer, { filepath, lazy: true })
  await fastify.listen()
  assert.equal(await fdCount(filepath), 0)
  await fastify.inject({ url: '/style.json' })
  assert.equal(await fdCount(filepath), 1)
  await fastify.close()
  assert.equal(await fdCount(filepath), 0)
})

test('server invalid filepath', async () => {
  const filepath = 'invalid_file_path'
  const fastify = createFastify()
  fastify.register(createServer, { filepath })
  await fastify.listen()
  const response = await fastify.inject({ url: '/style.json' })
  assert.equal(response.statusCode, 500)
  await fastify.close()
})

test('server invalid file', async () => {
  const filepath = '/dev/null'
  const fastify = createFastify()
  fastify.register(createServer, { filepath })
  await fastify.listen()
  const response = await fastify.inject({ url: '/style.json' })
  assert.equal(response.statusCode, 500)
  await fastify.close()
})

/** @returns {boolean} */
function isWin() {
  return process.platform === 'win32'
}

/** @param {string} filepath */
async function fdCount(filepath) {
  try {
    const { stdout } = await execa('lsof', ['-w', filepath])
    return stdout.trim().split('\n').length - 1
  } catch (error) {
    // @ts-ignore
    if (error.exitCode === 1) {
      return 0
    }
    throw error
  }
}
