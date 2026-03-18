import { defineConfig } from 'vitest/config'

import { fileURLToPath } from 'node:url'

/** Files that are helpers/utilities, not test suites */
const nonTestFiles = ['test/utils/**/*.js', 'test/*-worker.js']

/** @type {import('vitest/dist/node.js').BrowserInstanceOption[]} */
const browserInstances = [{ browser: 'chromium' }]

if (process.platform === 'darwin') {
  browserInstances.push({ browser: 'webkit' })
}

if (process.platform !== 'win32' && !process.env.CI) {
  // Firefox is excluded from CI due to flaky Playwright session timeouts
  // https://github.com/microsoft/playwright/issues/34586
  browserInstances.push({ browser: 'firefox' })
}

export default defineConfig({
  test: {
    globalSetup: ['test/utils/global-setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.js'],
      exclude: ['lib/types.ts'],
    },
    projects: [
      {
        test: {
          name: 'node',
          pool: 'forks',
          environment: 'node',
          include: ['test/**/*.js'],
          exclude: [...nonTestFiles, 'test/*.bench.js'],
        },
      },
      {
        plugins: [
          {
            name: 'cross-origin-isolation',
            configureServer(server) {
              // Set COOP/COEP headers on ALL responses so that
              // SharedArrayBuffer is available (required by
              // @sqlite.org/sqlite-wasm used by mbtiles-reader).
              // Uses prependListener to beat Vitest's internal middleware.
              server.httpServer?.prependListener('request', (_req, res) => {
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
                res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
              })
            },
          },
        ],
        test: {
          name: 'browser',
          include: [
            'test/write-read.js',
            'test/pipeto-error-handling.js',
            'test/download-write-read.js',
            'test/from-mbtiles.js',
          ],
          browser: {
            enabled: true,
            headless: true,
            provider: 'playwright',
            screenshotFailures: false,
            instances: browserInstances,
            commands: {
              readdir: (await import('./test/utils/commands.js')).readdir,
              randomImage: (await import('./test/utils/commands.js'))
                .randomImage,
            },
          },
        },
        resolve: {
          alias: [
            // Swap Node.js file I/O helpers with browser-compatible versions
            {
              find: './utils/io.js',
              replacement: fileURLToPath(
                new URL('./test/utils/io.browser.js', import.meta.url),
              ),
            },
          ],
        },
        optimizeDeps: {
          // Prevent Vite from pre-bundling Node.js-only modules
          exclude: [
            'node:fs/promises',
            'sharp',
            '@gmaclennan/zip-reader/file-source',
            '@sqlite.org/sqlite-wasm',
          ],
          include: ['@placemarkio/check-geojson'],
        },
      },
    ],
  },
})
