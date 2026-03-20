#!/usr/bin/env node
import { input, number } from '@inquirer/prompts'
import { Command } from 'commander'
import fs from 'fs'
import { download } from 'styled-map-package-api/download'
import {
  isMapboxURL,
  API_URL as MAPBOX_API_URL,
} from 'styled-map-package-api/utils/mapbox'

import { Writable } from 'node:stream'

import {
  parseBbox,
  parseUrl,
  parseZoom,
  runDownload,
} from '../lib/commands/download.js'
import { ttyReporter } from '../lib/reporters.js'

const program = new Command()

program
  .description('Download a map style for offline usage')
  .option('-o, --output <file>', 'output file (if omitted, writes to stdout)')
  .option(
    '-b, --bbox <west,south,east,north>',
    'bounding box of area to download e.g. 11,47,12,47.5',
    parseBbox,
  )
  .option('-z, --zoom <number>', 'max zoom level to download', parseZoom)
  .option(
    '-t, --token <token>',
    'Mapbox access token (necessary for Mapbox styles)',
  )
  .option(
    '--skip-local-glyphs',
    'Skip CJK/Hangul/Kana glyph ranges rendered locally by MapLibre GL',
  )
  .option(
    '-d, --dedupe',
    'deduplicate tiles with identical content to reduce file size',
  )
  .argument('[styleUrl]', 'URL to style to download', parseUrl)
  .action(
    async (
      styleUrl,
      { bbox, zoom, output, token, skipLocalGlyphs, dedupe },
    ) => {
      await runDownload(
        { styleUrl, bbox, zoom, output, token, skipLocalGlyphs, dedupe },
        {
          download,
          prompt: { input, number },
          createOutputStream: (output) =>
            output
              ? Writable.toWeb(fs.createWriteStream(output))
              : Writable.toWeb(process.stdout),
          reporter: ttyReporter,
          isMapboxURL,
          mapboxApiUrl: MAPBOX_API_URL,
          isTTY: !!process.stdout.isTTY,
        },
      )
    },
  )

program.parseAsync(process.argv)
