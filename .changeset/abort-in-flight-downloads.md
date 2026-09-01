---
'styled-map-package-api': patch
---

Cancelling a download now aborts its in-flight and pending HTTP requests. The
`signal` passed to `download()` previously only stopped the pipe, leaving
already-issued tile, glyph and sprite requests running with unread bodies —
those hold a concurrency slot and an open connection until the body is
consumed, which never happens. `downloadTiles`, `StyleDownloader#getTiles`,
`#getGlyphs` and `#getSprites` accept an optional `signal`, and all of them
release undelivered bodies when the consumer stops reading.
