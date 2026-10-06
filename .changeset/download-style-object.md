---
'styled-map-package-api': minor
'styled-map-package': minor
---

`download()` takes a new `style` option, which accepts either a style URL or a style object, so a style that isn't hosted anywhere can be downloaded without rebuilding `download()` from `StyleDownloader` and `Writer`. `styleUrl` still works but is deprecated.
