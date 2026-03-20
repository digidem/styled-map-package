---
'styled-map-package': minor
'styled-map-package-api': minor
---

Exclude locally-rendered glyph ranges from validation and downloads. MapLibre GL renders CJK, Hangul, Kana, Yi, and Halfwidth/Fullwidth glyphs client-side via `localIdeographFontFamily`, so SMP files do not need to include these 163 of 256 glyph ranges. Adds `skipLocalGlyphs` option to `download()` and `--skip-local-glyphs` CLI flag. Validator glyph completeness check now only counts the 93 required ranges.
