#!/usr/bin/node
import { Command } from 'commander'

const program = new Command()

program
  .name('smp')
  .command('download', 'Download a map style to a styled map package file')
  .command('view', 'Preview a styled map package in a web browser')

program.parse(process.argv)
