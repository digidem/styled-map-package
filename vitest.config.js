import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    include: ['test/**/*.js'],
    exclude: ['test/utils/!(*.test).js', 'test/download-write-read.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.js'],
      exclude: ['lib/types.ts'],
    },
  },
})
