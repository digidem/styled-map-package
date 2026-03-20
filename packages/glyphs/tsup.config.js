import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['lib/noto.js'],
  target: 'node18',
  clean: true,
  bundle: false,
  splitting: false,
  dts: true,
  format: ['cjs', 'esm'],
})
