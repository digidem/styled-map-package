#!/usr/bin/env node
import { Command, InvalidArgumentError } from '@commander-js/extra-typings'
import { input, number } from '@inquirer/prompts'
import fs from 'fs'
import { pipeline } from 'stream/promises'

import { download } from '../dist/download.js'
import { ttyReporter } from '../dist/reporters.js'
import { isMapboxURL, API_URL as MAPBOX_API_URL } from '../dist/utils/mapbox.js'

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
  .argument('[styleUrl]', 'URL to style to download', parseUrl)
  .action(async (styleUrl, { bbox, zoom, output, token }) => {
    const promptOutput =
      !output &&
      process.stdout.isTTY &&
      (!styleUrl || !bbox || zoom === undefined)

    if (!styleUrl) {
      styleUrl = await input({
        message: 'Style URL to download',
        required: true,
        validate: (value) => {
          try {
            new URL(value)
            return true
          } catch {
            return 'Please enter a valid URL.'
          }
        },
      })
    }

    if (!bbox) {
      const west = await number({
        message: 'Bounding box west',
        required: true,
        step: 'any',
        min: -180,
        max: 180,
      })
      const south = await number({
        message: 'Bounding box south',
        required: true,
        step: 'any',
        min: -90,
        max: 90,
      })
      const east = await number({
        message: 'Bounding box east',
        required: true,
        step: 'any',
        min: -180,
        max: 180,
      })
      const north = await number({
        message: 'Bounding box north',
        required: true,
        step: 'any',
        min: -90,
        max: 90,
      })
      if (
        west === undefined ||
        south === undefined ||
        east === undefined ||
        north === undefined
      ) {
        throw new InvalidArgumentError('Bounding box values are required.')
      }
      bbox = [west, south, east, north]
    }

    if (zoom === undefined) {
      zoom = await number({
        message: 'Max zoom level to download',
        required: true,
        min: 0,
        max: 22,
      })
      if (zoom === undefined) {
        throw new InvalidArgumentError('Zoom level is required.')
      }
    }

    if (
      (isMapboxURL(styleUrl) || styleUrl.startsWith(MAPBOX_API_URL)) &&
      !token
    ) {
      token = await input({
        message: 'Mapbox access token',
        required: true,
      })
    }

    if (promptOutput) {
      output = await input({
        message: 'Output filename (.smp extension will be added)',
        required: true,
        transformer: (value) =>
          value.endsWith('.smp') ? value : `${value}.smp`,
      })
    }

    if (output && !output.endsWith('.smp')) {
      output += '.smp'
    }

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
  return /** @type {[number, number, number, number]} */ (bounds)
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
