---
'styled-map-package-api': minor
'styled-map-package': minor
---

Add `validate()` function and `smp validate` CLI command for checking `.smp` files against the specification.

The validator returns structured issues with `kind` (error/warning), `severity` (fatal/rendering/spec), a stable `type` identifier, and a `path` for location context. Results include `valid` (spec-compliant) and `usable` (no fatal issues) booleans.

Checks include: ZIP validity, VERSION file, style.json conformance, SMP metadata validation, tile completeness and format consistency, glyph template and per-font range coverage, sprite file verification, external resource detection, and entry name safety.

Spec updates:

- §4.2.2: resource URLs MUST use SMP URIs (upgraded from SHOULD)
- §4.3.2: `smp:maxzoom` value MUST be between 0 and 30
- §8.2: writers MUST fetch and store external GeoJSON data (upgraded from SHOULD)
