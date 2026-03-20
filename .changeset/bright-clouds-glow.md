---
'styled-map-package-api': minor
'styled-map-package': minor
---

Add fallback tile and glyph handlers for serving missing resources from SMP files. `emptyTileFallback` returns format-aware empty tiles (gzipped MVT, transparent PNG/WebP). `emptyGlyphFallback` returns empty PBFs so MapLibre renders blank space instead of 404 errors. Add `--fallback` flag to `smp view` command.
