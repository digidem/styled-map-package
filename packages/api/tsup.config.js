import { fixExtensionsPlugin } from 'esbuild-fix-imports-plugin'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['lib/**/*.js'],
  target: 'node18',
  clean: true,
  bundle: false,
  splitting: false,
  dts: true,
  format: ['cjs', 'esm'],
  esbuildPlugins: [fixExtensionsPlugin()],
})
