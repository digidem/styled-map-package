# Styled Map Package (SMP) Format Specification v1.0

## Status

Draft

## Abstract

A Styled Map Package (SMP) is a ZIP archive containing all the resources needed to render a styled map offline using [MapLibre GL](https://maplibre.org/maplibre-style-spec/). This includes the style document, vector and/or raster tiles, glyphs (fonts), and sprite images.

## 1. Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

An implementation is not compliant if it fails to satisfy one or more of the MUST or REQUIRED level requirements for the protocols it implements.

## 2. File Extension and MIME Type

- The file extension MUST be `.smp`.
- The RECOMMENDED MIME type is `application/vnd.styled-map-package`.
- Implementations MAY use `application/zip` as a fallback MIME type.

## 3. Archive Structure

A conforming SMP file MUST be a valid [ZIP archive](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).

The archive MUST contain the following file at the root level:

| File         | Required | Description                                                                        |
| ------------ | -------- | ---------------------------------------------------------------------------------- |
| `style.json` | REQUIRED | [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) document |

The archive SHOULD also contain:

| File      | Description               |
| --------- | ------------------------- |
| `VERSION` | Format version identifier |

The archive MAY additionally contain tile data files, glyph (font) protobuf files, and sprite layout and image files. The paths of these files are determined by the URIs in `style.json` (see [Section 4.2](#42-smp-uri-scheme)).

It is RECOMMENDED that resources are organized under the following top-level folders:

| Folder     | Contents                      |
| ---------- | ----------------------------- |
| `s/`       | Tile and GeoJSON source data  |
| `fonts/`   | Glyph (font) protobuf files   |
| `sprites/` | Sprite layout and image files |

The actual folder structure is determined by the SMP URIs in `style.json` (see [Section 4.2](#42-smp-uri-scheme)). Readers MUST NOT assume fixed folder names — they MUST resolve resource paths from the URIs in the style document.

### 3.1 VERSION File

The `VERSION` file, if present, MUST be a UTF-8 encoded text file containing the format version string.

The version string MUST use the format `MAJOR.MINOR` (e.g. `1.0`, `1.1`, `2.0`).

For this specification version, the content SHOULD be:

```
1.0
```

Implementations SHOULD ignore leading and trailing whitespace and newline characters in the `VERSION` file.

If the `VERSION` file is absent, implementations MUST assume the format version is `1.0`.

Minor version increments (e.g. `1.0` to `1.1`) indicate backwards-compatible changes. A reader MUST parse the version string by splitting on `.` and comparing the major component (the integer before the first `.`). If the major version is not recognized by the reader (e.g. a reader that only supports major version `1` encounters version `2.0`), the reader MUST reject the file with an error indicating the unsupported version. Readers MUST accept any minor version within a recognized major version.

### 3.2 Entry Order

ZIP central directory entries SHOULD be ordered as follows for optimal read performance:

1. `VERSION`
2. `style.json`
3. Glyph files for Unicode range 0-255 for each font
4. Tile files, ordered by zoom level ascending — all tiles from all sources at zoom level N SHOULD appear before any tiles at zoom level N+1

This ordering is a RECOMMENDATION, not a normative requirement. It allows a map renderer to begin displaying the map before the entire central directory has been read (SMP archives with many tiles can contain thousands of entries in the central directory that can take significant time to process).

### 3.3 Compression

The following compression guidelines apply to ZIP entries:

- `VERSION` and `style.json` SHOULD use ZIP deflate compression (method 8).
- Gzip-compressed resources (`.mvt.gz`, `.pbf.gz`) SHOULD be stored using ZIP store mode (no additional compression), because they are already gzip-compressed.
- Raster tile files (`.png`, `.jpg`, `.webp`) SHOULD be stored using ZIP store mode, because these formats already include their own compression.

Readers MUST support both ZIP store (method 0) and ZIP deflate (method 8) compression for all entries.

### 3.4 ZIP Entry Constraints

ZIP entry names MUST satisfy all of the following:

- Use forward slashes (`/`) as path separators, per the [ZIP specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).
- Be encoded as UTF-8, normalized to [NFC](https://unicode.org/reports/tr15/) (Unicode Normalization Form C).
- NOT begin with `/` or a drive letter (e.g. `C:`).
- NOT contain `..` path segments.
- NOT exceed 255 bytes in length.

Writers MUST NOT produce entry names that violate these constraints. Readers MUST reject archives containing entries with `..` path segments or absolute paths.

Writers SHOULD NOT include a trailing slash in entry names for files (trailing slashes conventionally indicate directories in ZIP archives).

### 3.5 ZIP64

Writers MUST produce a [ZIP64](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) archive when any of the following conditions are met:

- Any single file's compressed or uncompressed size exceeds 4,294,967,295 bytes (2³²−1).
- The total number of entries exceeds 65,535 (2¹⁶−1).
- The archive's total size exceeds 4,294,967,295 bytes (2³²−1).

Writers SHOULD use classic ZIP format when ZIP64 is not required. Readers MUST accept both classic ZIP and ZIP64 archives.

### 3.6 Central Directory

The ZIP central directory is the authoritative source of entry metadata. Readers MUST use the central directory to locate entries and MUST NOT rely solely on local file headers.

Writers MAY include multiple central directory records with different entry names that reference the same underlying local file header offset. This allows deduplication of identical data (e.g. tiles at different coordinates that contain the same data can share a single copy of the data in the archive while appearing as separate entries in the central directory). SMP readers MUST support archives that use this deduplication technique.

> **Warning:** This deduplication technique causes a mismatch between the filename stored in the local file header and the filename in the aliased central directory entries. While the ZIP specification does not forbid this, many general-purpose ZIP tools do not handle it correctly. macOS Finder fails to expand such archives, Info-ZIP `unzip` emits warnings, and strict readers such as `yauzl` (Node.js) and Go's `archive/zip` may reject the entries. Writers that need the resulting archive to be compatible with general-purpose ZIP tools SHOULD NOT use this technique.

## 4. style.json

### 4.1 Validity

The `style.json` file MUST be a UTF-8 encoded, strictly valid JSON document (no comments, no trailing commas) conforming to the [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) version 8.

Unknown properties (properties not defined by the MapLibre Style Specification or this specification) MUST be preserved by writers and MAY be ignored by readers. In particular, the `metadata` object and all of its properties MUST be preserved when round-tripping a style through a writer and reader, so that third-party tools can store their own metadata alongside SMP-specific properties.

### 4.2 SMP URI Scheme

Resource URLs within `style.json` that reference files inside the archive MUST use the SMP URI scheme:

```
smp://maps.v1/{path}
```

where `{path}` corresponds to the file path within the ZIP archive.

The URI prefix `smp://maps.v1/` MUST be used for all internal resource references. A future breaking format change MUST use a different version in the URI (e.g., `smp://maps.v2/`).

#### 4.2.1 URI-to-Path Mapping

The following rules define how an SMP URI maps to a ZIP entry name:

1. The prefix `smp://maps.v1/` maps to the root of the ZIP archive. The remainder of the URI after the prefix is the ZIP entry name. For example, `smp://maps.v1/fonts/Open Sans Regular/0-255.pbf.gz` maps to the ZIP entry `fonts/Open Sans Regular/0-255.pbf.gz`.
2. SMP URIs in `style.json` MUST NOT contain percent-encoded characters. Writers MUST store paths as literal UTF-8 strings. For example, `smp://maps.v1/fonts/Open Sans Regular/0-255.pbf.gz` is correct; `smp://maps.v1/fonts/Open%20Sans%20Regular/0-255.pbf.gz` is non-conforming. Mapping libraries such as MapLibre GL will percent-encode these paths when making HTTP requests, but the stored URI and corresponding ZIP entry name MUST use the literal, unencoded path.
3. Paths MUST be treated as case-sensitive.
4. A trailing slash in the URI MUST be treated as part of the path. Writers SHOULD avoid trailing slashes in SMP URIs.
5. SMP URIs MUST NOT resolve to paths containing `..` segments or absolute paths.

> **Note:** When serving SMP resources over HTTP, the mapping library (e.g. MapLibre GL) will percent-encode characters such as spaces in the request URL per [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986#section-2.1). Serving implementations MUST percent-decode the request path before looking up the corresponding ZIP entry. See [Section 10](#10-serving-resources-informative) for details.

#### 4.2.2 Referenced Properties

The `style.json` MUST NOT contain resource URLs that reference external services. All resource URLs MUST use SMP URIs pointing to resources inside the archive. Properties that are absent (e.g. a style with no `glyphs` or `sprite` property) do not violate this requirement.

The following `style.json` properties, when present, MUST use SMP URIs:

- `glyphs` — glyph URL template
- `sprite` — sprite URL (string form) or `url` property (array form)
- `sources[*].tiles[*]` — tile URL templates
- `sources[*].data` — GeoJSON data URL (when data is stored as a file, see [Section 8.2](#82-url-referenced-geojson))

Writers MUST remove sources, layers, or other style properties that reference external resources not included in the archive from the output `style.json`.

### 4.3 SMP Metadata

The `style.json` `metadata` object MAY contain the following SMP-specific properties:

#### 4.3.1 `smp:bounds` (OPTIONAL)

- Type: Array of four numbers `[west, south, east, north]`
- Coordinate reference system: WGS 84 (EPSG:4326)
- SHOULD represent the union bounding box of all sources in the package, reflecting only data actually present in the SMP file.
- Longitude values MUST be in the range [-180, 180].
- Latitude values MUST be in the range [-90, 90].
- Latitude values SHOULD be within the [Web Mercator](https://en.wikipedia.org/wiki/Web_Mercator_projection) bounds (approximately [-85.051129, 85.051129]), unless the data extends beyond these bounds (e.g. global GeoJSON data).

#### 4.3.2 `smp:maxzoom` (OPTIONAL)

- Type: Non-negative integer
- Value MUST be between 0 and 30 (inclusive).
- SHOULD equal the maximum zoom level of any tile source in the package.
- For GeoJSON-only packages, the value SHOULD be 16 (the default GeoJSON rendering max zoom).

#### 4.3.3 `smp:sourceFolders` (OPTIONAL)

- Type: Object (string to string mapping)
- Maps source IDs (as they appear in `style.sources`) to their folder path within the archive (relative to the archive root). The folder path is an opaque string determined by the writer implementation — readers MUST NOT assume a particular folder structure (see [Section 3](#3-archive-structure)).
- Implementations MAY use this as a convenience for mapping source IDs to archive paths without parsing tile URL templates.

Example:

```json
"smp:sourceFolders": {
  "openmaptiles": "s/0",
  "hillshade": "s/1"
}
```

This indicates that tiles for the `openmaptiles` source are stored under `s/0/` and tiles for `hillshade` are stored under `s/1/`. The `s/` prefix and the subfolder names (`0`, `1`) are both implementation-defined — other writers MAY use different paths.

### 4.4 Additional Style Properties

The standard [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) properties `center` and `zoom`, if set, SHOULD be consistent with the data in the package — i.e. `center` SHOULD be within `smp:bounds` and `zoom` SHOULD be within the zoom range of the tile data (between `minzoom` and `smp:maxzoom`).

## 5. Tile Sources

### 5.1 Supported Source Types

The following [MapLibre source types](https://maplibre.org/maplibre-style-spec/sources/) are supported for tile data:

- `vector` — [Mapbox Vector Tiles](https://github.com/mapbox/vector-tile-spec)
- `raster` — Raster image tiles

Additionally, `geojson` sources are supported (see [Section 8](#8-geojson-sources)).

Other source types (e.g., `raster-dem`, `image`, `video`) are not supported by this specification version. Support for `raster-dem` sources (terrain/hillshade) is planned for a future version.

### 5.2 Tile File Paths

Tile file paths MUST match the URL template specified in the source's `tiles` property in `style.json` (see [Section 5.5](#55-tile-url-template)), with the `{z}`, `{x}`, and `{y}` placeholders replaced by actual tile coordinates using the XYZ scheme (see [Section 5.4](#54-tile-coordinate-scheme)).

The folder structure for tiles is determined by the implementation. It is RECOMMENDED that tile path prefixes are kept as short as possible, because the file path is stored in the ZIP central directory record for every tile, and shorter paths reduce the overall archive size. It is RECOMMENDED that the source subfolder name matches the source ID in `style.json`.

Tile file paths MUST end with a file extension that reflects their format. The following extensions are recognized:

| Extension | Format                               |
| --------- | ------------------------------------ |
| `.mvt.gz` | Mapbox Vector Tile (gzip-compressed) |
| `.mvt`    | Mapbox Vector Tile (uncompressed)    |
| `.pbf.gz` | Protobuf tile (gzip-compressed)      |
| `.pbf`    | Protobuf tile (uncompressed)         |
| `.png`    | PNG raster tile                      |
| `.jpg`    | JPEG raster tile                     |
| `.webp`   | WebP raster tile                     |

Vector tiles (`.mvt`, `.pbf`) SHOULD be stored gzip-compressed (using the `.mvt.gz` or `.pbf.gz` extension). Mapping libraries such as [MapLibre GL](https://maplibre.org/) and Mapbox GL expect vector tiles to be served with gzip content-encoding; if tiles are not stored pre-compressed, the serving implementation would need to compress them on the fly.

Files with a `.mvt` or `.pbf` extension (without `.gz`) MUST NOT contain gzip-compressed data. Only the `.mvt.gz` and `.pbf.gz` extensions indicate gzip compression.

Tiles with no meaningful content (e.g. ocean tiles) are still valid and MUST be present if they fall within the source's bounds and zoom range (see [Section 5.7](#57-tile-bounds-and-completeness)). An "empty" vector tile still contains valid protobuf headers, and an "empty" raster tile is a valid image file (e.g. a single-color PNG). The central directory deduplication technique described in [Section 3.6](#36-central-directory) can be used to store identical tiles efficiently without duplicating their data.

### 5.3 Tile Format Consistency

All tiles within a single source MUST use the same format. A source MUST NOT contain tiles of mixed formats (e.g., both `.png` and `.jpg`).

### 5.4 Tile Coordinate Scheme

Tile coordinates MUST use the [XYZ / Slippy Map](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) tile naming scheme, where the origin (`x=0, y=0`) is at the top-left (north-west) corner of the map. This is the default scheme used by MapLibre's `tiles` property.

Tile sources in `style.json` MUST have their `scheme` property set to `"xyz"` (or omitted, since `"xyz"` is the MapLibre default). If the original style contains a source with `"scheme": "tms"`, the writer MUST convert tile Y coordinates from TMS to XYZ using the formula `y_xyz = 2^z - y_tms - 1`, store the tiles using the converted XYZ coordinates, and set the `scheme` property to `"xyz"`.

### 5.5 Tile URL Template

The `tiles` property of each tile source in `style.json` MUST contain a single URL template using the SMP URI scheme:

```
smp://maps.v1/{tile_path_template}
```

The template MUST include the `{z}`, `{x}`, and `{y}` placeholders as defined by the [TileJSON specification](https://github.com/mapbox/tilejson-spec). The rest of the path — including the source subfolder name and file extension — is determined by the implementation and MUST match the actual file paths in the archive.

Example:

```json
"tiles": ["smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz"]
```

### 5.6 Source Properties

Each tile source in `style.json` MUST include:

- `bounds` — Bounding box `[west, south, east, north]` in WGS 84
- `minzoom` — Minimum zoom level (non-negative integer)
- `maxzoom` — Maximum zoom level (positive integer)
- `tiles` — Array containing exactly one SMP URI template

Tile sources MUST NOT include a `url` property. If the original style references a [TileJSON](https://github.com/mapbox/tilejson-spec) endpoint via `url`, the relevant TileJSON properties (`bounds`, `minzoom`, `maxzoom`, `tiles`) MUST be inlined directly in the source object and the `url` property MUST be removed.

### 5.7 Tile Bounds and Completeness

The `bounds` property of a tile source MUST reflect the geographic extent of available tile data, as defined by the [TileJSON specification](https://github.com/mapbox/tilejson-spec). It represents the bounding box within which tile data is present and MAY be used by clients to limit requests to this region.

All tiles at zoom levels between `minzoom` and `maxzoom` (inclusive) that intersect the source's `bounds` MUST be present in the archive.

## 6. Fonts (Glyphs)

### 6.1 Glyph File Paths

Glyph file paths MUST match the URL template specified in the `glyphs` property in `style.json` (see [Section 6.3](#63-glyph-uri-template)), with the `{fontstack}` and `{range}` placeholders replaced by actual values.

Each glyph file corresponds to a Unicode range in the format `{start}-{end}` where:

- `start` is a multiple of 256 (0, 256, 512, ...)
- `end` is `start + 255`
- The full range is 0-255 through 65280-65535, covering the Unicode [Basic Multilingual Plane](<https://en.wikipedia.org/wiki/Plane_(Unicode)#Basic_Multilingual_Plane>) (U+0000 to U+FFFF) in 256 files per font stack. Characters outside the BMP (U+10000 and above) are not covered by this glyph range scheme.

### 6.2 Glyph Encoding

Glyph files MUST be [Protocol Buffer](https://protobuf.dev/) files using the [Mapbox GL glyph protobuf schema](https://github.com/mapbox/node-fontnik/blob/master/proto/glyphs.proto), with the file extension `.pbf` or `.pbf.gz`.

Glyph files SHOULD be stored gzip-compressed (`.pbf.gz`). If stored uncompressed (`.pbf`), the serving implementation would need to compress them on the fly for clients that expect gzip-encoded responses.

Files with a `.pbf` extension (without `.gz`) MUST NOT contain gzip-compressed data. Files with a `.pbf.gz` extension MUST contain gzip-compressed data.

### 6.3 Glyph URI Template

The `style.json` `glyphs` property MUST use an SMP URI template that includes `{fontstack}` and `{range}` placeholders, as required by the [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/glyphs/). The rest of the path is determined by the implementation and MUST match the actual file paths in the archive.

Example:

```
smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz
```

### 6.4 Font Stacks

A `text-font` property in the [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/layers/#text-font) specifies an array of font names (a "font stack"). [MapLibre GL](https://maplibre.org/) requests glyphs using the full comma-separated font stack as the `{fontstack}` value in the glyphs URL template.

Writing implementations SHOULD transform font stacks to contain a single font name, selecting the first available font and removing any fonts not included in the SMP file. If a `text-font` property still contains multiple font names after transformation, the SMP file MUST include glyph files at the path formed by joining the font names with commas.

For example, if a style contains:

```json
"text-font": ["Open Sans Regular", "Arial Unicode MS Regular"]
```

then the archive MUST contain glyph files at paths such as:

```
fonts/Open Sans Regular,Arial Unicode MS Regular/0-255.pbf.gz
```

The glyph data in these files MAY be from any of the fonts in the stack. It is RECOMMENDED to use the first font in the stack.

### 6.5 Data-Driven Font Stacks

The `text-font` property in MapLibre GL supports [expressions](https://maplibre.org/maplibre-style-spec/expressions/) that can produce different font stacks depending on feature data (e.g. `["match", ["get", "type"], "park", ["literal", ["Italic Font"]], ["literal", ["Regular Font"]]]`). Writers MUST evaluate all possible output values of `text-font` expressions and include glyph files for every font stack that the expression can produce. If the set of possible values cannot be statically determined, the writer SHOULD include glyphs for all fonts referenced in the expression.

### 6.6 Font Coverage

The SMP file MUST include glyph files for every `{fontstack}` value that MapLibre GL will request based on the `text-font` properties in the style. All Unicode ranges used by text content in the vector tile data MUST be included for each font stack. Including all non-locally-rendered Unicode ranges (see below) is RECOMMENDED to ensure complete glyph coverage.

#### 6.6.1 Locally Rendered Ranges

[MapLibre GL](https://maplibre.org/) renders glyphs for CJK ideographs, Hangul syllables, Kana, Yi, and related scripts client-side via [`localIdeographFontFamily`](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/) (enabled by default as `'sans-serif'`). When this option is active, MapLibre uses [TinySDF](https://github.com/mapbox/tiny-sdf) to rasterize these glyphs from a local system font and never requests PBF glyph ranges from the server.

SMP files MAY omit glyph ranges for Unicode blocks that are rendered locally by MapLibre. The following ranges (identified by PBF range start codepoint) are locally rendered and do not require server-side glyph files:

| Codepoint Range | Unicode Blocks                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| U+3000..U+33FF  | CJK Symbols and Punctuation, Hiragana, Katakana, Bopomofo, CJK Strokes, Enclosed CJK Letters, CJK Compatibility |
| U+3400..U+4DFF  | CJK Unified Ideographs Extension A                                                                              |
| U+4E00..U+9FFF  | CJK Unified Ideographs                                                                                          |
| U+A000..U+A3FF  | Yi Syllables, Yi Radicals                                                                                       |
| U+AC00..U+D7FF  | Hangul Syllables, Hangul Jamo Extended-B                                                                        |
| U+F900..U+FAFF  | CJK Compatibility Ideographs                                                                                    |
| U+FF00..U+FFFF  | Halfwidth and Fullwidth Forms                                                                                   |

This covers 163 of the 256 Unicode BMP glyph ranges, leaving 93 ranges that require server-side PBF glyph files.

> **Note:** If a consumer disables `localIdeographFontFamily` (by setting it to `false`), all 256 ranges would need to be served. Writers that need to support this use case SHOULD include all 256 ranges.

## 7. Sprites

### 7.1 Sprite File Paths

The [MapLibre Sprite Specification](https://maplibre.org/maplibre-style-spec/sprite/) defines how the mapping library resolves sprite URIs by appending a pixel ratio suffix and a file extension to the base URI. Sprite file paths in the archive MUST match the resolved URIs.

For each sprite referenced in `style.json`, the following files MUST be present:

```
{base_path}.json    - Sprite index (1x)
{base_path}.png     - Sprite sheet image (1x)
```

Implementations SHOULD also include high-DPI variants:

```
{base_path}@2x.json  - Sprite index (2x)
{base_path}@2x.png   - Sprite sheet image (2x)
```

Higher pixel ratios (3x, 4x, etc.) MAY also be included using the `@{N}x` suffix convention.

The sprite folder structure is determined by the implementation. It is RECOMMENDED that the subfolder name matches the sprite ID in `style.json`. For styles with a single sprite (string form), the RECOMMENDED subfolder name is `default`.

### 7.2 Sprite Index Format

The sprite `.json` file MUST conform to the [MapLibre Sprite Index](https://maplibre.org/maplibre-style-spec/sprite/#index-file) format: a JSON object mapping icon names to objects with `width`, `height`, `x`, `y`, and `pixelRatio` properties.

### 7.3 String and Array Forms

When `style.json` has a `sprite` property that is a string (not an array), a single sprite set is referenced.

When `style.json` has a `sprite` property that is an array, each element MUST have an `id` and `url` property as defined by the [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/sprite/). Each referenced sprite MUST have corresponding files in the archive.

### 7.4 Sprite URI

The `style.json` `sprite` property MUST use an SMP URI pointing to the sprite base path — without a file extension or pixel ratio suffix. [MapLibre GL](https://maplibre.org/) appends the pixel ratio suffix and extension at runtime.

For example, the SMP URI:

```
smp://maps.v1/sprites/default/sprite
```

maps to the following ZIP entries:

| ZIP Entry                        | Description       |
| -------------------------------- | ----------------- |
| `sprites/default/sprite.json`    | Sprite index (1x) |
| `sprites/default/sprite.png`     | Sprite sheet (1x) |
| `sprites/default/sprite@2x.json` | Sprite index (2x) |
| `sprites/default/sprite@2x.png`  | Sprite sheet (2x) |

### 7.5 Sprite Completeness

Each sprite referenced in `style.json` MUST have its corresponding `.json` and `.png` files present in the archive. Any pixel ratio variants (`@2x`, `@3x`, etc.) that the implementation provides MUST also have both `.json` and `.png` files present.

## 8. GeoJSON Sources

GeoJSON data MUST conform to [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946). NDJSON (Newline Delimited JSON) and other streaming JSON formats are not supported.

### 8.1 Inline GeoJSON

GeoJSON sources with inline data (where the `data` property is a GeoJSON object) MUST be preserved in `style.json`.

### 8.2 URL-Referenced GeoJSON

GeoJSON sources that reference an external URL (where the `data` property is a string URL) MUST have their data fetched and stored as a file in the archive. The source's `data` property MUST be replaced with an SMP URI pointing to the stored file. It is RECOMMENDED that GeoJSON files are stored alongside tile data (e.g. under `s/`) in a subfolder named with the source ID.

GeoJSON data files MUST use either the `.json` or `.geojson` extension and SHOULD NOT be gzip-compressed.

Example:

```json
{
  "type": "geojson",
  "data": "smp://maps.v1/s/my-source/data.geojson"
}
```

### 8.3 GeoJSON Bounding Box

All GeoJSON data objects (whether inline or stored as files) SHOULD include a `bbox` property (a [GeoJSON bounding box](https://datatracker.ietf.org/doc/html/rfc7946#section-5)) representing the bounds of all features in the data. If the original GeoJSON data does not include a `bbox`, implementations SHOULD compute and add one.

## 9. Resource Integrity

All resources referenced by SMP URIs in `style.json` MUST be present in the archive. If a URI in `style.json` points to a resource (tile, glyph, sprite, or GeoJSON data file) using the `smp://maps.v1/` scheme, the corresponding file MUST exist at the matching path in the ZIP archive.

The archive SHOULD NOT contain files that are not referenced by `style.json` (other than `VERSION` and `style.json` itself).

### 9.1 Missing Resources

If `style.json` itself is missing or cannot be parsed, the reader MUST treat this as a fatal error and reject the file.

For other missing resources, readers MAY choose one of the following strategies:

- **Strict mode:** Treat any missing resource as a fatal error and refuse to render.
- **Graceful degradation:** Attempt to render the map with available resources. Missing tiles result in empty space, missing glyphs may fall back to a system font or render as placeholders, and missing sprites may render without icons.

The chosen strategy is an implementation decision. Readers SHOULD report missing resources to the caller regardless of strategy.

## 10. Serving Resources (Informative)

This section is informative and provides guidance for implementations that serve SMP resources over HTTP.

### 10.1 MIME Type Mapping

When serving resources over HTTP, implementations SHOULD set the `Content-Type` header according to the file extension:

| Extension            | Content-Type                         |
| -------------------- | ------------------------------------ |
| `.json` / `.geojson` | `application/json; charset=utf-8`    |
| `.mvt.gz` / `.mvt`   | `application/vnd.mapbox-vector-tile` |
| `.pbf.gz` / `.pbf`   | `application/x-protobuf`             |
| `.png`               | `image/png`                          |
| `.jpg`               | `image/jpeg`                         |
| `.webp`              | `image/webp`                         |

### 10.2 Content-Encoding

Resources stored with gzip compression (`.mvt.gz`, `.pbf.gz`) SHOULD be served with the HTTP header `Content-Encoding: gzip`. This allows clients to transparently decompress the data.

Resources stored without gzip compression (`.mvt`, `.pbf`) do not require a `Content-Encoding` header. However, mapping libraries typically expect vector tiles and glyphs to be gzip-encoded, so serving implementations MAY need to compress these resources on the fly.

### 10.3 Content-Length

Serving implementations SHOULD set the `Content-Length` header on responses. For resources stored without gzip compression, the content length is the uncompressed entry size from the ZIP central directory. For gzip-compressed resources served with `Content-Encoding: gzip`, the content length is the compressed entry size.

HTTP range requests are not expected for SMP resource serving and implementations need not support them.

### 10.4 Percent-Decoding Request Paths

Mapping libraries such as [MapLibre GL](https://maplibre.org/) percent-encode characters in request URLs per [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986#section-2.1). For example, a font named `Open Sans Regular` will be requested as `Open%20Sans%20Regular` in the URL path.

Serving implementations MUST percent-decode the request path using UTF-8 before looking up the corresponding ZIP entry name. Since SMP URIs in `style.json` store paths as literal UTF-8 (see [Section 4.2.1](#421-uri-to-path-mapping)), the decoded request path will match the ZIP entry name directly.

## 11. Security Considerations

### 11.1 Path Traversal

Readers MUST reject ZIP entries with names containing `..` path segments or absolute paths (beginning with `/` or a drive letter). Processing such entries could allow path traversal attacks.

### 11.2 Resource Limits

SMP files may contain a large number of entries (hundreds of thousands of tiles). Readers SHOULD enforce limits on:

- **Maximum number of entries** processed from the central directory. A RECOMMENDED default limit is 500,000 entries, which is sufficient for a global dataset up to zoom level 9 (approximately 350,000 tiles plus fonts and sprites).
- **Maximum memory usage** when decompressing tiles, glyphs, or other resources.
- **Maximum uncompressed size** per entry, to guard against decompression bombs (entries with small compressed size but very large uncompressed size).

Writers MAY also enforce limits on the number or size of entries they produce.

## 12. Glossary

- **SMP file** — A Styled Map Package: a ZIP archive conforming to this specification, containing a map style and its associated resources for offline rendering.
- **Writer** — An implementation that creates SMP files by assembling a style document and its resources into a conforming ZIP archive.
- **Reader** — An implementation that opens SMP files and extracts resources for rendering or serving.
- **Serving implementation** — An implementation that serves SMP resources over HTTP, translating SMP URIs to HTTP URLs and setting appropriate response headers. See [Section 10](#10-serving-resources-informative).
- **SMP URI** — A URI using the scheme `smp://maps.v1/{path}` that references a file within the SMP archive. See [Section 4.2](#42-smp-uri-scheme).
- **Tile template** — A URL template containing `{z}`, `{x}`, and `{y}` placeholders that is expanded to produce tile file paths. See [Section 5.5](#55-tile-url-template).
- **Font stack** — An ordered list of font names specified in a `text-font` property. [MapLibre GL](https://maplibre.org/) joins the names with commas to form the `{fontstack}` value in glyph URL requests. See [Section 6.4](#64-font-stacks).
- **Glyph range** — A set of 256 consecutive Unicode code points, identified by the format `{start}-{end}` (e.g. `0-255`, `256-511`). Each range corresponds to one glyph protobuf file. See [Section 6.1](#61-glyph-file-paths).
- **ZIP local file header** — A per-entry header preceding the entry's data in the ZIP archive. Contains redundant metadata; the central directory is authoritative (see [Section 3.6](#36-central-directory)).
- **ZIP central directory** — The index at the end of a ZIP archive listing all entries and their metadata. Readers MUST use this as the source of truth. See [Section 3.6](#36-central-directory).
- **ZIP64** — An extension to the ZIP format that supports archives and entries larger than 4 GiB and more than 65,535 entries. See [Section 3.5](#35-zip64).

## 13. Specification Versioning

This specification follows [Semantic Versioning](https://semver.org/) principles adapted for a file format:

- **Patch versions** (e.g. `1.0.0` → `1.0.1`) are editorial changes: clarifications, typo fixes, and non-normative additions that do not alter conformance requirements. The `VERSION` file in the archive is unaffected.
- **Minor versions** (e.g. `1.0` → `1.1`) add new OPTIONAL features or relax existing requirements. Files produced under a minor version are backwards-compatible: a reader supporting `1.0` MUST be able to read a `1.1` file (it MAY ignore new features). The `VERSION` file reflects the minor version (e.g. `1.1`).
- **Major versions** (e.g. `1.x` → `2.0`) introduce breaking changes. A reader supporting only major version `1` MUST reject files with major version `2`. Major version changes also require a new SMP URI version (e.g. `smp://maps.v2/`).

Each specification version is published under `spec/{MAJOR}.{MINOR}/`. The specification source is the authoritative reference; a changelog SHOULD be maintained alongside each version.

## 14. Normative References

- [ZIP File Format Specification (APPNOTE.TXT)](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
- [MapLibre Style Specification v8](https://maplibre.org/maplibre-style-spec/)
- [MapLibre Sprite Specification](https://maplibre.org/maplibre-style-spec/sprite/) (sprite index format, URI resolution)
- [MapLibre Glyphs Specification](https://maplibre.org/maplibre-style-spec/glyphs/)
- [TileJSON 3.0.0](https://github.com/mapbox/tilejson-spec/tree/master/3.0.0)
- [XYZ / Slippy Map Tile Names (OpenStreetMap)](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames)
- [RFC 2119 — Key words for use in RFCs to Indicate Requirement Levels](https://www.ietf.org/rfc/rfc2119.txt)
- [RFC 3986 — Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986) (percent-encoding)
- [Unicode Standard Annex #15 — Unicode Normalization Forms](https://unicode.org/reports/tr15/) (NFC normalization)
- [Mapbox Vector Tile Specification](https://github.com/mapbox/vector-tile-spec)
- [GeoJSON (RFC 7946)](https://datatracker.ietf.org/doc/html/rfc7946)
- [Mapbox GL Glyph Protobuf Schema](https://github.com/mapbox/node-fontnik/blob/master/proto/glyphs.proto)
