---
'styled-map-package-api': patch
---

Add dedupe option to SMP Writer, which writes duplicate tiles once to the Zip, resulting in significantly smaller files when used with maps with many duplicate tiles.
