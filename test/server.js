import { execa } from 'execa'
import createFastify from 'fastify'
import { temporaryFile, temporaryWrite } from 'tempy'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fsPromises from 'node:fs/promises'
import { test } from 'node:test'
import { setImmediate as setImmediatePromise } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import ReaderWatch from '../lib/reader-watch.js'
import Reader from '../lib/reader.js'
import createServer from '../lib/server.js'
import { noop } from '../lib/utils/misc.js'
import { validateStyle } from '../lib/utils/style.js'
import { replaceVariables } from '../lib/utils/templates.js'

test('server basic (filepath)', async (t) => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const fastify = createFastify()
  fastify.register(createServer, { filepath })
  await fastify.listen()
  t.after(() => fastify.close())
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
})

test('server basic (reader)', async (t) => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  t.after(async () => {
    await fastify.close()
    await reader.close()
  })
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
})

test(
  'server.close() closes reader if passed filepath',
  { skip: isWin() },
  async () => {
    const filepath = fileURLToPath(
      new URL('./fixtures/demotiles-z2.smp', import.meta.url),
    )
    const fastify = createFastify()
    fastify.register(createServer, { filepath })
    await fastify.listen()
    // The server opens two file descriptors: one for the SMP Reader and one for the fs.watch()
    assert((await fdCount(filepath)) > 0)
    await fastify.close()
    assert.equal(await fdCount(filepath), 0)
  },
)

test("server.close() doesn't close reader passed as argument", async () => {
  const filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new Reader(filepath)
  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  await fastify.close()
  assert(await reader.getStyle(), 'reader is still open')
})

test('server invalid filepath with ReaderWatch', async () => {
  const filepath = 'invalid_file_path'
  const reader = new ReaderWatch(filepath)
  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 404)
  }
  {
    const response = await fastify.inject({ url: '/something/else' })
    assert.equal(response.statusCode, 404)
  }
  await fastify.close()
  await reader.close().catch(noop)
  if (!isWin()) {
    assert.equal(await fdCount(filepath), 0)
  }
})

test('server invalid file with ReaderWatch', async (t) => {
  const filepath = await temporaryWrite(randomBytes(1024))
  const reader = new ReaderWatch(filepath)
  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  t.after(async () => {
    await fastify.close()
    await reader.close().catch(noop)
  })
  const response = await fastify.inject({ url: '/style.json' })
  assert.equal(response.statusCode, 500)
})

test('server file present after server starts with ReaderWatch', async (t) => {
  const filepath = temporaryFile()
  const smpFixtureFilepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new ReaderWatch(filepath)

  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  t.after(async () => {
    await fastify.close()
    await reader.close().catch(noop)
  })

  await t.test('file is not present initially', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 404)
    assert.match(response.json().error, /Not Found/)
  })

  await t.test('file is added after server starts', async () => {
    await fsPromises.copyFile(smpFixtureFilepath, filepath)

    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert(validateStyle(response.json()))
  })
})

test('invalid file replaced after server starts with ReaderWatch', async (t) => {
  const filepath = await temporaryWrite(randomBytes(1024))
  const smpFixtureFilepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const reader = new ReaderWatch(filepath)

  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  t.after(async () => {
    await fastify.close()
    await reader.close().catch(noop)
  })

  await t.test('file is not present initially', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 500)
    assert.match(response.json().error, /Internal Server Error/)
  })

  // Needed for tests to pass on Windows
  await setImmediatePromise()

  await t.test('file is added after server starts', async () => {
    await fsPromises.copyFile(smpFixtureFilepath, filepath)

    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert(validateStyle(response.json()))
  })
})

test('file removed (rm) after server starts with ReaderWatch', async (t) => {
  const filepath = await temporaryFile()
  const smpFixtureFilepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  await fsPromises.copyFile(smpFixtureFilepath, filepath)
  const reader = new ReaderWatch(filepath)

  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  t.after(async () => {
    await fastify.close()
    await reader.close().catch(noop)
  })

  await t.test('works initially', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert(validateStyle(response.json()))
  })

  await fsPromises.rm(filepath)
  // Need to wait for I/O operations in the event loop for fs.watch to detect the file deletion
  await setImmediatePromise()

  await t.test('404 error after file deletion', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 404)
  })
})

test('file removed (unlink) after server starts with ReaderWatch', async (t) => {
  const filepath = await temporaryFile()
  const smpFixtureFilepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  await fsPromises.copyFile(smpFixtureFilepath, filepath)
  const reader = new ReaderWatch(filepath)

  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  t.after(async () => {
    await fastify.close()
    await reader.close().catch(noop)
  })

  await t.test('works initially', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert(validateStyle(response.json()))
  })

  await fsPromises.unlink(filepath)
  // Need to wait for I/O operations in the event loop for fs.watch to detect the file deletion
  await setImmediatePromise()

  await t.test('404 error after file deletion', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 404)
  })
})

test('file changed after server starts with ReaderWatch', async (t) => {
  const filepath = await temporaryFile()
  const smpFixture1Filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const smpFixture2Filepath = fileURLToPath(
    new URL('./fixtures/osm-bright-z6.smp', import.meta.url),
  )
  await fsPromises.copyFile(smpFixture1Filepath, filepath)
  const reader = new ReaderWatch(filepath)

  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()
  t.after(async () => {
    await fastify.close()
    await reader.close().catch(noop)
  })

  await t.test('1st fixture is served initially', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().name, 'MapLibre')
  })

  await fsPromises.copyFile(smpFixture2Filepath, filepath)
  // Need to wait for I/O operations in the event loop for fs.watch to detect the file deletion
  await setImmediatePromise()

  await t.test('2nd fixture served after file replacement', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().name, 'OSM Bright')
  })
})

test('file changed twice after server starts with ReaderWatch', async (t) => {
  const filepath = await temporaryFile()
  const smpFixture1Filepath = fileURLToPath(
    new URL('./fixtures/demotiles-z2.smp', import.meta.url),
  )
  const smpFixture2Filepath = fileURLToPath(
    new URL('./fixtures/osm-bright-z6.smp', import.meta.url),
  )
  await fsPromises.copyFile(smpFixture1Filepath, filepath)
  const reader = new ReaderWatch(filepath)

  const fastify = createFastify()
  fastify.register(createServer, { reader })
  await fastify.listen()

  await t.test('1st fixture is served initially', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().name, 'MapLibre')
  })

  await fsPromises.copyFile(smpFixture2Filepath, filepath)
  // Need to wait for I/O operations in the event loop for fs.watch to detect the file deletion
  await setImmediatePromise()

  await t.test('2nd fixture served after file replacement', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().name, 'OSM Bright')
  })

  await fsPromises.copyFile(smpFixture1Filepath, filepath)
  // Need to wait for I/O operations in the event loop for fs.watch to detect the file deletion
  await setImmediatePromise()

  await t.test('1st fixture is served again', async () => {
    const response = await fastify.inject({ url: '/style.json' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().name, 'MapLibre')
  })

  if (!isWin()) {
    // To check we don't leave file descriptors open for replaced files - one fd for the reader, one for the fs.watch()
    assert((await fdCount(filepath)) <= 2, 'max two file descriptors open')
  }

  await fastify.close()
  await reader.close().catch(noop)
  if (!isWin()) {
    assert.equal(await fdCount(filepath), 0, 'no file descriptors left open')
  }
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
