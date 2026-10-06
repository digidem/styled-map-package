---
'styled-map-package-api': patch
'styled-map-package': patch
---

`Writer` methods now throw "Writer is already finished" once `finish()` has been called. Previously `setMetadata()` and a duplicate tile with `dedupe` were silently lost, and other calls failed with unrelated errors such as "VERSION already added".
