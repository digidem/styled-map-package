---
'styled-map-package': minor
'styled-map-package-api': minor
---

Add `--dedupe` flag to `smp download` CLI command and `dedupe` option to the `download()` API, exposing the Writer's tile deduplication to reduce file size for maps with many repeated tiles.
