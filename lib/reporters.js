import chalk, { chalkStderr } from 'chalk'
import logSymbols from 'log-symbols'
import ora from 'ora'
import prettyBytes from 'pretty-bytes'
import prettyMilliseconds from 'pretty-ms'
import { Writable } from 'readable-stream'

chalk.level = chalkStderr.level

const TASKS = /** @type {const} */ ([
  'style',
  'sprites',
  'tiles',
  'glyphs',
  'output',
])

const TASK_LABEL = /** @type {const} */ ({
  style: 'Downloading Map Style',
  sprites: 'Downloading Sprites',
  tiles: 'Downloading Tiles',
  glyphs: 'Downloading Glyphs',
  output: 'Writing Styled Map Package',
})

const TASK_SUFFIX =
  /** @type {{ [K in (typeof TASKS)[number]]: (progress: import('./download.js').DownloadProgress[K]) => string }} */ ({
    style: () => '',
    sprites: ({ downloaded }) => `${downloaded}`,
    tiles: ({ total, skipped, totalBytes, downloaded }) => {
      const formattedTotal = total.toLocaleString()
      const formattedCompleted = (downloaded + skipped)
        .toLocaleString()
        .padStart(formattedTotal.length)
      return `${formattedCompleted}/${formattedTotal} (${prettyBytes(totalBytes)})`
    },
    glyphs: ({ total, downloaded, totalBytes }) =>
      `${downloaded}/${total} (${prettyBytes(totalBytes)})`,
    output: ({ totalBytes }) => `${prettyBytes(totalBytes)}`,
  })

/**
 * A writable stream to reporting download progress to a TTY terminal. Write
 * progress messages to this stream for a pretty-printed progress task-list in
 * the terminal.
 */
export function ttyReporter() {
  /** @type {import('./download.js').DownloadProgress | undefined} */
  let stats
  let current = 0
  /** @type {import('ora').Ora} */
  let spinner
  return new Writable({
    objectMode: true,
    // @ts-ignore - missing type def
    construct(cb) {
      process.stderr.write('\n')
      spinner = ora(TASK_LABEL[TASKS[current]]).start()
      cb()
    },
    /** @param {ArrayLike<{ chunk: import('./download.js').DownloadProgress, encoding: string }>} chunks */
    writev(chunks, cb) {
      stats = chunks[chunks.length - 1].chunk
      while (current < TASKS.length && stats[TASKS[current]].done) {
        spinner.suffixText = chalk.dim(
          TASK_SUFFIX[TASKS[current]](
            // @ts-ignore - too complicated for TS
            stats[TASKS[current]],
          ),
        )
        spinner.succeed()
        if (++current < TASKS.length) {
          spinner = ora(TASK_LABEL[TASKS[current]]).start()
        }
      }
      if (current < TASKS.length) {
        spinner.suffixText = chalk.dim(
          TASK_SUFFIX[TASKS[current]](
            // @ts-ignore - too complicated for TS
            stats[TASKS[current]],
          ),
        )
      } else {
        process.stderr.write(
          `${chalk.green(logSymbols.success)} Completed in ${prettyMilliseconds(stats.elapsedMs)}\n`,
        )
      }

      cb()
    },
  })
}
