---
'styled-map-package-api': patch
'styled-map-package': patch
---

`validate()` closes the file it opened when the file is not a valid ZIP archive, instead of leaving it open until garbage collection.
