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
    } else if (result.usable) {
      console.log(
        logSymbols.warning,
        chalk.yellow('SMP file has issues but is usable'),
      )
    } else {
      console.log(logSymbols.error, chalk.red('Invalid SMP file (unusable)'))
    }

    /** @param {typeof result.issues[number]} issue */
    const formatIssue = (issue) => {
      const path = issue.path ? chalk.dim(`[${issue.path}] `) : ''
      const sev =
        issue.severity !== 'spec' ? chalk.dim(` (${issue.severity})`) : ''
      return `${path}${issue.message}${sev}`
    }

    const issueErrors = result.issues.filter((i) => i.kind === 'error')
    const issueWarnings = result.issues.filter((i) => i.kind === 'warning')

    if (issueErrors.length) {
      console.log('\nErrors:')
      for (const issue of issueErrors) {
        console.log(`  ${logSymbols.error} ${formatIssue(issue)}`)
      }
    }

    if (issueWarnings.length) {
      console.log('\nWarnings:')
      for (const issue of issueWarnings) {
        console.log(`  ${logSymbols.warning} ${formatIssue(issue)}`)
      }
    }

    process.exit(result.valid ? 0 : 1)
  })

program.parseAsync(process.argv)
