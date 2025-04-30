# Patches

## `esbuild-fix-imports-plugin`

### [Fix `fixExtensionsPlugin()`](./esbuild-fix-imports-plugin+1.0.19+001+fix-fix-extensions-plugin.patch)

Basically what's reported in https://github.com/aymericzip/esbuild-fix-imports-plugin/issues/1. When the relative import is `.js` but the "out" extension is not `.js`, this plugin appends the desired extensions instead of replaces it.
