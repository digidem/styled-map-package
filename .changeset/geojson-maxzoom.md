---
'styled-map-package-api': patch
'styled-map-package': patch
---

GeoJSON sources keep their `maxzoom` instead of being written with `maxzoom: 0`, which made MapLibre tile them only at zoom 0 and render them coarsely. `smp:maxzoom` and the default `zoom` now come from the tile sources, as the spec requires, and fall back to 16 only for GeoJSON-only packages.
