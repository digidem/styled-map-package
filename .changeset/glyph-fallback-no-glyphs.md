---
'styled-map-package-api': minor
'styled-map-package': minor
---

serve fallback glyphs for packages whose style has no glyphs

When a style has no labels it is packaged without a `glyphs` property, and the
server previously returned 404 for any glyph request. With `fallbackGlyph` set
(the default), glyph requests are now served at the standard SMP glyph path and
the served `style.json` advertises that path, so a client can add its own symbol
layer to such a map and get fallback glyphs. The stored `style.json` is
unchanged, and `fallbackGlyph: null` restores the previous behaviour.
