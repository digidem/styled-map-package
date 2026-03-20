#!/usr/bin/env node
import { Command } from 'commander'

const program = new Command()

program
  .name('smp')
  .command('download', 'Download a map style to a styled map package file')
  .command('view', 'Preview a styled map package in a web browser')
  .command('mbtiles', 'Convert a MBTiles file to a styled map package file')
  .command('validate', 'Validate a styled map package file')

program.parse(process.argv)
