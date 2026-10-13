---
'styled-map-package-api': minor
'styled-map-package': minor
---

`Reader` and `validate()` accept a `RandomAccessSource` from `@gmaclennan/zip-reader`, such as `new BlobSource(file)` in the browser, and open it so that packages written with `dedupe: true` can be read. Passing a `ZipReader` still works, but it must be opened with `{ allowAliasedEntries: true }` to read deduplicated tiles; without it, `Reader` and `validate()` now throw an error saying so ([#125](https://github.com/digidem/styled-map-package/issues/125)).

Updates `@gmaclennan/zip-reader` to v2, which permits deduplicated tiles only when they are exact aliases of each other, and rejects archives whose entries overlap.
