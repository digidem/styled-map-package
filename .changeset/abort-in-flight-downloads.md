---
'styled-map-package-api': patch
---

Cancelling a download now stops it fetching. The `signal` passed to
`download()` previously only stopped the pipe, so an aborted download carried
on fetching every remaining tile and glyph, `onprogress` kept firing with every
pending tile counted as skipped, and `await stream.cancel()` could hang forever
when the output was not being read. `downloadTiles`, `StyleDownloader#getTiles`,
`#getGlyphs` and `#getSprites` accept an optional `signal`.

Also fixes a mid-download network error surfacing as an unhandled rejection
(which terminates the process) rather than erroring the output stream.
