import { test } from 'vitest'

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { Reader } from '../lib/reader.js'
import { createServer } from '../lib/server.js'
import { validateStyle } from '../lib/utils/style.js'
import { replaceVariables } from '../lib/utils/templates.js'

test('server basic', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  const server = createServer()
  const response = await server.fetch(
    new Request('http://example.com/style.json'),
    reader,
  )
  assert.equal(response.status, 200)
  const responseRaw = await response.arrayBuffer()
  assert.equal(
    responseRaw.byteLength,
    Number(response.headers.get('content-length')),
    'Content-Length header is correct',
  )
  const style = JSON.parse(new TextDecoder().decode(responseRaw))
  assert(validateStyle(style), 'style is valid')

  {
    assert(typeof style.glyphs === 'string')
    const glyphUrl = replaceVariables(style.glyphs, {
      fontstack: 'Open Sans Semibold',
      range: '0-255',
    })
    const response = await server.fetch(new Request(glyphUrl), reader)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-protobuf')
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert(response.headers.get('content-length'))

    assert.equal(
      (await response.arrayBuffer()).byteLength,
      Number(response.headers.get('content-length')),
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
    const response = await server.fetch(new Request(tileUrl), reader)
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('content-type'),
      'application/vnd.mapbox-vector-tile',
    )
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert(response.headers.get('content-length'))

    assert.equal(
      (await response.arrayBuffer()).byteLength,
      Number(response.headers.get('content-length')),
      'Content-Length header is correct',
    )
  }
})

test('server 404', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  const server = createServer()
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/nonexistent'),
      reader,
    )
    await assert.rejects(() => responsePromise, {
      status: 404,
      message: 'Not Found',
    })
  }
  {
    const responsePromise = server.fetch(
      new Request('http://example.com/tiles/99/99/99.pbf'),
      reader,
    )
    await assert.rejects(() => responsePromise, {
      status: 404,
      message: 'Not Found',
    })
  }
})

test('server with base path', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  const server = createServer({ base: '/maps/my-map/' })
  const response = await server.fetch(
    new Request('http://example.com/maps/my-map/style.json'),
    reader,
  )
  assert.equal(response.status, 200)
  const style = await response.json()
  assert(validateStyle(style), 'style is valid')
})

test('server with parameter in base path', async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  const server = createServer({ base: '/maps/:mapId/' })
  const response = await server.fetch(
    new Request('http://example.com/maps/45b4fcabc49c/style.json'),
    reader,
  )
  assert.equal(response.status, 200)
  const style = await response.json()
  assert(validateStyle(style), 'style is valid')

  {
    assert(typeof style.glyphs === 'string')
    const glyphUrl = replaceVariables(style.glyphs, {
      fontstack: 'Open Sans Semibold',
      range: '0-255',
    })
    assert(glyphUrl.startsWith('http://example.com/maps/45b4fcabc49c/'))
    const response = await server.fetch(new Request(glyphUrl), reader)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-protobuf')
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert(response.headers.get('content-length'))

    assert.equal(
      (await response.arrayBuffer()).byteLength,
      Number(response.headers.get('content-length')),
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
    assert(tileUrl.startsWith('http://example.com/maps/45b4fcabc49c/'))
    const response = await server.fetch(new Request(tileUrl), reader)
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('content-type'),
      'application/vnd.mapbox-vector-tile',
    )
    assert.equal(response.headers.get('content-encoding'), 'gzip')
    assert(response.headers.get('content-length'))

    assert.equal(
      (await response.arrayBuffer()).byteLength,
      Number(response.headers.get('content-length')),
      'Content-Length header is correct',
    )
  }
})
