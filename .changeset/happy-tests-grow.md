---
'styled-map-package-api': patch
---

Fix uncaught error in `download()` when the style URL is unreachable — errors now propagate through the returned stream instead of becoming unhandled rejections. Accept `Readonly<BBox>` in public API type signatures.
