#!/usr/bin/env node
import { createServerAdapter } from '@whatwg-node/server'
import { Command } from 'commander'
import fsPromises from 'fs/promises'
import http from 'http'
import { AutoRouter } from 'itty-router'
import openApp from 'open'

import path from 'node:path'

import { Reader } from '../dist/reader.js'
import { createServer } from '../dist/server.js'

const program = new Command()

program
  .description('Preview a styled map package in a web browser')
  .option('-o, --open', 'open in the default web browser')
  .option('-p, --port <number>', 'port to serve on', parseInt, 3000)
  .argument('<file>', 'file to serve')
  .action(async (filepath, { open, port }) => {
    const address = await serve({ port, filepath })
    console.log(`server listening on ${address}`)
    if (open) {
      await openApp(address)
    }
  })

program.parseAsync(process.argv)

/**
 * Serve a styled map package on the given port (defaults to 3000).
 *
 * @param {object} opts
 * @param {number} [opts.port]
 * @param {string} opts.filepath
 * @returns
 */
async function serve({ port = 3000, filepath }) {
  const reader = new Reader(path.relative(process.cwd(), filepath))
  const smpServer = createServer({ base: '/map' })

  const router = AutoRouter()
  router.get('/', async () => {
    const index = await fsPromises.readFile(
      new URL('../map-viewer/index.html', import.meta.url),
    )
    return new Response(new Uint8Array(index), {
      headers: {
        'Content-Type': 'text/html',
        'Content-Length': String(index.byteLength),
        'Cache-Control': 'public, max-age=0',
      },
    })
  })
  router.all('/map/*', (request) => {
    return smpServer.fetch(request, reader)
  })
  const server = http.createServer(createServerAdapter(router.fetch))
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string') {
        resolve(`http://${address}`)
      } else if (address === null) {
        reject(new Error('Failed to get server address'))
      } else {
        resolve(`http://${address.address}:${address.port}`)
      }
    })
    server.on('error', reject)
  })
}
