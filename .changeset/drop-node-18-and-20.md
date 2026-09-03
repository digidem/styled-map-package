---
'styled-map-package-api': major
'styled-map-package': major
'smp-noto-glyphs': major
---

Drop support for Node 18 and Node 20, both of which are past end of life. All
packages now declare `"engines": { "node": ">=22" }` and are tested against Node
22 and 24 only.
