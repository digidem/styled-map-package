---
'styled-map-package-api': patch
---

Accept either better-sqlite3 v12 or v13 as the optional dependency, so this
package is not a second conflicting constraint on a native module the rest of
your dependency tree may already have pinned.
