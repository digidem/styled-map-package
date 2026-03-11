#!/usr/bin/env node
import { Command } from 'commander'

import fs from 'node:fs'
import { Writable } from 'node:stream'

import { fromMBTiles } from '../dist/from-mbtiles.js'

const program = new Command()

program
  .description('Convert a MBTiles file to a styled map package file')
  .option('-o, --output <file>', 'output smp file')
  .argument('<mbtiles>', 'MBTiles file to convert')
  .action(async (mbtilesPath, { output }) => {
    const dest = output ? fs.createWriteStream(output) : process.stdout
    await fromMBTiles(mbtilesPath).pipeTo(Writable.toWeb(dest))
  })

program.parseAsync(process.argv)
