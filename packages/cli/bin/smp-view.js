#!/usr/bin/env node
import { createServerAdapter } from '@whatwg-node/server'
import { Command } from 'commander'
import http from 'http'
import openApp from 'open'
import { notoGlyphFallback } from 'smp-noto-glyphs'
import { emptyTileFallback } from 'styled-map-package-api/fallbacks'
import { Reader } from 'styled-map-package-api/reader'
import { createServer } from 'styled-map-package-api/server'

import fsPromises from 'node:fs/promises'
import path from 'node:path'

import { runView } from '../lib/commands/view.js'

const program = new Command()

program
  .description('Preview a styled map package in a web browser')
  .option('-o, --open', 'open in the default web browser')
  .option('-p, --port <number>', 'port to serve on', (v) => parseInt(v), 3000)
  .option(
    '-f, --fallback',
    'serve empty tiles and glyphs for missing resources instead of 404',
  )
  .argument('<file>', 'file to serve')
  .action(async (filepath, { open, port, fallback }) => {
    await runView(
      {
        port,
        filepath: path.relative(process.cwd(), filepath),
        open,
        fallback,
      },
      {
        Reader,
        createServer,
        emptyTileFallback,
        emptyGlyphFallback: notoGlyphFallback,
        openApp,
        log: (msg) => console.log(msg),
        readViewerHtml: (filepath) => fsPromises.readFile(filepath),
        listen: (port, handler) =>
          new Promise((resolve, reject) => {
            const server = http.createServer(createServerAdapter(handler))
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
          }),
      },
    )
  })

program.parseAsync(process.argv)
