---
'styled-map-package-api': minor
---

Add PMTiles support to the downloader. `download()` and `StyleDownloader` now resolve map style sources that reference a [PMTiles](https://docs.protomaps.com/pmtiles/) archive (`url: "pmtiles://…"` or a `.pmtiles` URL), reading tiles directly from the archive over HTTP range requests. This makes `smp download` work with styles served by PMTiles-based providers such as Protomaps.
