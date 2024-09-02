#!/usr/bin/node
import { Command, InvalidArgumentError } from 'commander'
import fs from 'fs'
import { pipeline } from 'stream/promises'

import download from '../lib/download.js'
import { ttyReporter } from '../lib/reporters.js'

const program = new Command()

program
  .description('Download a map style for offline usage')
  .option('-o, --output [file]', 'output file (if omitted, writes to stdout)')
  .requiredOption(
    '-b, --bbox <west,south,east,north>',
    'bounding box of area to download e.g. 11,47,12,47.5',
    parseBbox,
  )
  .requiredOption(
    '-z, --zoom <number>',
    'max zoom level to download',
    parseZoom,
  )
  .option(
    '-t, --token <token>',
    'Mapbox access token (necessary for Mapbox styles)',
  )
  .argument('<styleUrl>', 'URL to style to download', parseUrl)
  .action(async (styleUrl, { bbox, zoom, output, token }) => {
    const reporter = ttyReporter()
    const readStream = download({
      bbox,
      maxzoom: zoom,
      styleUrl,
      onprogress: (p) => reporter.write(p),
      accessToken: token,
    })
    const outputStream = output ? fs.createWriteStream(output) : process.stdout
    await pipeline(readStream, outputStream)
  })

program.parseAsync(process.argv)

/** @param {string} z */
function parseZoom(z) {
  const zoom = parseInt(z)
  if (isNaN(zoom) || zoom < 0 || zoom > 22) {
    throw new InvalidArgumentError(
      'Zoom must be a whole number (integer) between 0 and 22.',
    )
  }
  return zoom
}

/** @param {string} bbox */
function parseBbox(bbox) {
  const bounds = bbox.split(',').map((s) => parseFloat(s.trim()))
  if (bounds.length !== 4) {
    throw new InvalidArgumentError(
      'Bounding box must have 4 values separated by commas.',
    )
  }
  if (bounds.some(isNaN)) {
    throw new InvalidArgumentError('Bounding box values must be numbers.')
  }
  return bounds
}

/** @param {string} url */
function parseUrl(url) {
  try {
    return new URL(url).toString()
  } catch (e) {
    const message =
      e !== null &&
      typeof e === 'object' &&
      'message' in e &&
      typeof e.message === 'string'
        ? e.message
        : 'Invalid URL'
    throw new InvalidArgumentError(message)
  }
}
