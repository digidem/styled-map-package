#!/usr/bin/env node
import { Command } from 'commander'
import { pipeline } from 'stream/promises'

import { fromMBTiles } from '../dist/from-mbtiles.js'

const program = new Command()

program
  .description('Convert a MBTiles file to a styled map package file')
  .option('-o, --output <file>', 'output smp file')
  .argument('<mbtiles>', 'MBTiles file to convert')
  .action(async (mbtilesPath, { output }) => {
    if (output) {
      await fromMBTiles(mbtilesPath, output)
    } else {
      await pipeline(fromMBTiles(mbtilesPath), process.stdout)
    }
  })

program.parseAsync(process.argv)
