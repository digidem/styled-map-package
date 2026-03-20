# smp-noto-glyphs

Pre-built Noto Sans SDF glyph PBFs for use as a fallback font in MapLibre-compatible map servers.

Bundles [GoNotoKurrent](https://github.com/satbyy/go-noto-universal), a merged build of 80+ Noto Sans script-specific fonts covering 37,000+ codepoints including Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, and many more. CJK and Hangul ranges are not bundled since MapLibre renders these client-side via `localIdeographFontFamily`.

## Installation

```sh
npm install smp-noto-glyphs
```

## Usage

### With `styled-map-package-api`

```js
import { notoGlyphFallback } from 'smp-noto-glyphs'
import { emptyTileFallback } from 'styled-map-package-api/fallbacks'
import { createServer } from 'styled-map-package-api/server'

const server = createServer({
  fallbackTile: emptyTileFallback,
  fallbackGlyph: notoGlyphFallback,
})
```

### Standalone

`notoGlyphFallback` is a simple function that takes a fontstack name and a glyph range string, and returns a WHATWG `Response`:

```js
import { notoGlyphFallback } from 'smp-noto-glyphs'

// Returns a Response with the PBF data for codepoints 0-255 (Basic Latin)
const response = notoGlyphFallback('Noto Sans Regular', '0-255')
```

For ranges with pre-built glyphs, returns the PBF data. For ranges without (uncommon scripts, CJK, Hangul), returns an empty gzipped PBF that causes MapLibre to render blank space instead of erroring.

## Regenerating glyphs

The PBF files are generated from GoNotoKurrent-Regular.ttf using [`build_pbf_glyphs`](https://github.com/stadiamaps/sdf_font_tools):

```sh
cargo install build_pbf_glyphs
node scripts/generate-glyphs.js
```

## License

MIT. The bundled glyph data is derived from [Noto Sans](https://fonts.google.com/noto) fonts, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).
