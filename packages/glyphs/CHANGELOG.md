# smp-noto-glyphs

## 2.0.0

### Major Changes

- [#116](https://github.com/digidem/styled-map-package/pull/116) [`afe8531`](https://github.com/digidem/styled-map-package/commit/afe8531fb721853875f96e9daadf44470de0790c) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Drop support for Node 18 and Node 20, both of which are past end of life. All
  packages now declare `"engines": { "node": ">=22" }` and are tested against Node
  22 and 24 only.

### Patch Changes

- [#119](https://github.com/digidem/styled-map-package/pull/119) [`e44d64b`](https://github.com/digidem/styled-map-package/commit/e44d64b602c64aa72085f88eda27976202b774b4) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Build with TypeScript 7. The emitted declarations are unchanged apart from
  formatting, so there is no change to the public type surface.

- [#117](https://github.com/digidem/styled-map-package/pull/117) [`e4920e8`](https://github.com/digidem/styled-map-package/commit/e4920e82cd664dd08dc5d26c73785595ce6c3f51) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Update dependencies now that Node 18 and 20 are no longer supported. Notably
  Vitest 4, Vite 8, ESLint 10, `@maplibre/maplibre-gl-style-spec` 26, `ky` 2,
  `commander` 15, `@inquirer/prompts` 8 and `@mapbox/sphericalmercator` 2.

## 1.0.0

### Major Changes

- [#92](https://github.com/digidem/styled-map-package/pull/92) [`799c2fd`](https://github.com/digidem/styled-map-package/commit/799c2fd1169d8efc84db310557d7b5d6a8f5ddc9) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Initial release. Pre-built Noto Sans SDF glyph PBFs (80+ scripts) for use as fallback glyphs in MapLibre-compatible map servers. Built from GoNotoKurrent covering Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, and many more. CJK/Hangul ranges excluded (rendered client-side by MapLibre).

### Patch Changes

- [#100](https://github.com/digidem/styled-map-package/pull/100) [`5ec8ecf`](https://github.com/digidem/styled-map-package/commit/5ec8ecfba91cef52ce9d2a60a9e640a0efa42505) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Drop CJS support - ESM only from now on

- [#103](https://github.com/digidem/styled-map-package/pull/103) [`0513081`](https://github.com/digidem/styled-map-package/commit/0513081582e8e1ba3887a565a3f1615dcb664692) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Gzip noto glyph fallbacks at rest

## 1.0.0-pre.1

### Patch Changes

- [#103](https://github.com/digidem/styled-map-package/pull/103) [`0513081`](https://github.com/digidem/styled-map-package/commit/0513081582e8e1ba3887a565a3f1615dcb664692) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Gzip noto glyph fallbacks at rest

## 1.0.0-pre.0

### Major Changes

- [#92](https://github.com/digidem/styled-map-package/pull/92) [`799c2fd`](https://github.com/digidem/styled-map-package/commit/799c2fd1169d8efc84db310557d7b5d6a8f5ddc9) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Initial release. Pre-built Noto Sans SDF glyph PBFs (80+ scripts) for use as fallback glyphs in MapLibre-compatible map servers. Built from GoNotoKurrent covering Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, and many more. CJK/Hangul ranges excluded (rendered client-side by MapLibre).

### Patch Changes

- [#100](https://github.com/digidem/styled-map-package/pull/100) [`5ec8ecf`](https://github.com/digidem/styled-map-package/commit/5ec8ecfba91cef52ce9d2a60a9e640a0efa42505) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Drop CJS support - ESM only from now on
