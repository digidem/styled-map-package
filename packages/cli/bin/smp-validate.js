#!/usr/bin/env node
import chalk from 'chalk'
import { Command } from 'commander'
import logSymbols from 'log-symbols'
import { validate } from 'styled-map-package-api/validator'

const program = new Command()

program
  .description('Validate a styled map package file')
  .argument('<file>', 'path to .smp file to validate')
  .action(async (filepath) => {
    const result = await validate(filepath)

    if (result.valid) {
      console.log(logSymbols.success, chalk.green('Valid SMP file'))
    } else {
      console.log(logSymbols.error, chalk.red('Invalid SMP file'))
    }

    if (result.errors.length) {
      console.log('\nErrors:')
      for (const err of result.errors) {
        console.log(`  ${logSymbols.error} ${err}`)
      }
    }

    if (result.warnings.length) {
      console.log('\nWarnings:')
      for (const warn of result.warnings) {
        console.log(`  ${logSymbols.warning} ${warn}`)
      }
    }

    process.exit(result.valid ? 0 : 1)
  })

program.parseAsync(process.argv)
