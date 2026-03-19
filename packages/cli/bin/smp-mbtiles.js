#!/usr/bin/env node
import { Command } from 'commander'
import { fromMBTiles } from 'styled-map-package-api/from-mbtiles'

import fs from 'node:fs'
import { Writable } from 'node:stream'

import { runMbtiles } from '../lib/commands/mbtiles.js'

const program = new Command()

program
  .description('Convert a MBTiles file to a styled map package file')
  .option('-o, --output <file>', 'output smp file')
  .argument('<mbtiles>', 'MBTiles file to convert')
  .action(async (mbtilesPath, { output }) => {
    await runMbtiles({ mbtilesPath, output }, {
      fromMBTiles,
      createOutputStream: (output) =>
        output
          ? Writable.toWeb(fs.createWriteStream(output))
          : Writable.toWeb(process.stdout),
    })
  })

program.parseAsync(process.argv)
