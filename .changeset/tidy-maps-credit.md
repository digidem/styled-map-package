---
'styled-map-package-api': patch
'styled-map-package': patch
---

Document map source `attribution` in the format spec (Section 5.7) and display a compact attribution control in `smp view`. Source `attribution` — including credits inlined from TileJSON and MBTiles metadata — is preserved through write/read, and the map viewer now renders it.
