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

    const issueErrors = result.issues.filter((i) => i.kind === 'error')
    const issueWarnings = result.issues.filter((i) => i.kind === 'warning')

    if (issueErrors.length) {
      console.log('\nErrors:')
      for (const issue of issueErrors) {
        console.log(`  ${logSymbols.error} ${issue.message}`)
      }
    }

    if (issueWarnings.length) {
      console.log('\nWarnings:')
      for (const issue of issueWarnings) {
        console.log(`  ${logSymbols.warning} ${issue.message}`)
      }
    }

    process.exit(result.valid ? 0 : 1)
  })

program.parseAsync(process.argv)
