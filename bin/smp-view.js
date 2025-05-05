#!/usr/bin/env node
import fastifyStatic from '@fastify/static'
import { Command } from 'commander'
import fastify from 'fastify'
import openApp from 'open'

import path from 'node:path'

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
 * Serve a styled map package on the given port (defaults to 3000). Use the
 * fastify plugin in `./server.js` for more flexibility.
 *
 * @param {object} opts
 * @param {number} [opts.port]
 * @param {string} opts.filepath
 * @returns
 */
function serve({ port = 3000, filepath }) {
  const server = fastify()

  server.register(fastifyStatic, {
    root: new URL('../map-viewer', import.meta.url),
    serve: false,
  })
  server.get('/', async (request, reply) => {
    return reply.sendFile('index.html')
  })

  server.register(createServer, {
    filepath: path.relative(process.cwd(), filepath),
    prefix: '/map',
  })
  return server.listen({ port })
}
