# Styled Map Package (SMP) Format Specification v1.0

## Status

Draft

## Abstract

A Styled Map Package (SMP) is a ZIP archive containing all the resources needed to render a [MapLibre GL](https://maplibre.org/) styled map offline. This includes the style document, vector and/or raster tiles, glyphs (fonts), and sprite images.

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

| File         | Required | Description                           |
| ------------ | -------- | ------------------------------------- |
| `style.json` | REQUIRED | MapLibre Style Specification document |

The archive SHOULD also contain:

| File      | Description               |
| --------- | ------------------------- |
| `VERSION` | Format version identifier |

The archive MAY additionally contain tile data files, glyph (font) protobuf files, and sprite layout and image files. The paths of these files are determined by the URIs in `style.json` (see [Section 4.2](#42-smp-uri-scheme)).

### 3.1 VERSION File

The `VERSION` file, if present, MUST be a UTF-8 encoded text file containing the format version string followed by a newline character (`\n`).

The version string MUST use the format `MAJOR.MINOR` (e.g. `1.0`, `1.1`, `2.0`).

For this specification version, the content SHOULD be:

```
1.0
```

(The string `1.0` followed by a single newline character, U+000A.)

If the `VERSION` file is absent, implementations MUST assume the format version is `1.0`.

Minor version increments (e.g. `1.0` to `1.1`) indicate backwards-compatible changes. Implementations MUST accept any file with a recognized major version. Implementations SHOULD reject files with an unrecognized major version (e.g. a reader that only supports major version `1` SHOULD reject a file with version `2.0`).

### 3.2 Entry Order

ZIP central directory entries SHOULD be ordered as follows for optimal read performance:

1. `VERSION`
2. `style.json`
3. Glyph files for Unicode range 0-255 for each font
4. Tile files, ordered by zoom level ascending, interleaving sources at each zoom level

This ordering allows a map renderer to begin displaying the map before the entire archive has been read.

### 3.3 Compression

The following compression guidelines apply to ZIP entries:

- `VERSION` and `style.json` SHOULD use ZIP deflate compression (method 8).
- Glyph files (`.pbf.gz`) SHOULD be stored using ZIP store mode (no additional compression), because they are already gzip-compressed.
- Vector tile files (`.mvt.gz`) SHOULD be stored using ZIP store mode, because they are already gzip-compressed.
- Raster tile files (`.png`, `.jpg`, `.webp`) SHOULD be stored using ZIP store mode, because these formats already include their own compression.

## 4. style.json

### 4.1 Validity

The `style.json` file MUST be a valid [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) version 8 document, encoded as UTF-8 JSON.

### 4.2 SMP URI Scheme

Resource URLs within `style.json` that reference files inside the archive MUST use the SMP URI scheme:

```
smp://maps.v1/{path}
```

where `{path}` corresponds to the file path within the ZIP archive.

The URI prefix `smp://maps.v1/` MUST be used for all internal resource references. A future breaking format change MUST use a different version in the URI (e.g., `smp://maps.v2/`).

The `style.json` SHOULD NOT contain references to external URLs. All resource URLs (`glyphs`, `sprite`, `sources[*].tiles[*]`) SHOULD use SMP URIs pointing to resources inside the archive.

The following `style.json` properties MUST use SMP URIs when referencing archive resources:

- `glyphs` — glyph URL template
- `sprite` — sprite URL (string form) or `url` property (array form)
- `sources[*].tiles[*]` — tile URL templates

Sources, layers, or other style properties that reference external resources not included in the archive SHOULD be removed from the output `style.json`.

### 4.3 SMP Metadata

The `style.json` `metadata` object MUST contain the following SMP-specific properties:

#### 4.3.1 `smp:bounds`

- Type: Array of four numbers `[west, south, east, north]`
- Coordinate reference system: WGS 84 (EPSG:4326)
- MUST be present.
- MUST represent the bounding box of all data in the package.
- Longitude values MUST be in the range [-180, 180].
- Latitude values MUST be in the range [-90, 90].
- Latitude values SHOULD be within the [Web Mercator](https://en.wikipedia.org/wiki/Web_Mercator_projection) bounds (approximately [-85.051129, 85.051129]), unless the data extends beyond these bounds (e.g. global GeoJSON data).

#### 4.3.2 `smp:maxzoom`

- Type: Non-negative integer
- MUST be present.
- MUST equal the maximum zoom level of any tile source in the package.
- For GeoJSON-only packages, the value SHOULD be 16 (the default GeoJSON rendering max zoom).

#### 4.3.3 `smp:sourceFolders` (OPTIONAL)

- Type: Object (string to string mapping)
- Maps source IDs (as they appear in `style.sources`) to their folder names within the archive.
- This property is OPTIONAL. Implementations MAY use it as a convenience for mapping source IDs to archive paths.

### 4.4 Additional Style Properties

The standard MapLibre style properties `center` and `zoom`, if set, SHOULD be consistent with the data in the package — i.e. `center` SHOULD be within `smp:bounds` and `zoom` SHOULD be within the zoom range of the tile data (between `minzoom` and `smp:maxzoom`).

## 5. Tile Sources

### 5.1 Supported Source Types

The following MapLibre source types are supported for tile data:

- `vector` — [Mapbox Vector Tiles](https://github.com/mapbox/vector-tile-spec)
- `raster` — Raster image tiles

Additionally, `geojson` sources with inline data (see [Section 4.2](#42-smp-uri-scheme)) are supported. GeoJSON data is stored directly in `style.json` and does not use separate tile files.

Other source types (e.g., `raster-dem`, `image`, `video`) are not supported by this specification.

### 5.2 Tile File Paths

Tile files may follow any path pattern within the archive, as long as the paths match the URL template specified in the source's `tiles` property in `style.json` (see [Section 5.5](#55-tile-url-template)).

It is RECOMMENDED that tile folder names and source identifiers are kept as short as possible, because the file path is stored in the ZIP entry record for every tile, and shorter paths reduce the overall archive size.

Tile file paths MUST include a file extension that indicates the tile format. The following extensions are recognized:

| Extension | Format                               | Content-Type                         |
| --------- | ------------------------------------ | ------------------------------------ |
| `.mvt.gz` | Mapbox Vector Tile (gzip-compressed) | `application/vnd.mapbox-vector-tile` |
| `.mvt`    | Mapbox Vector Tile                   | `application/vnd.mapbox-vector-tile` |
| `.png`    | PNG raster tile                      | `image/png`                          |
| `.jpg`    | JPEG raster tile                     | `image/jpeg`                         |
| `.webp`   | WebP raster tile                     | `image/webp`                         |

### 5.3 Tile Format Consistency

All tiles within a single source MUST use the same format. A source MUST NOT contain tiles of mixed formats (e.g., both `.png` and `.jpg`).

### 5.4 Tile Coordinate Scheme

Tile coordinates MUST use the [XYZ / Slippy Map](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) tile naming scheme, where the origin (`x=0, y=0`) is at the top-left (north-west) corner of the map. This is the default scheme used by MapLibre's `tiles` property.

### 5.5 Tile URL Template

The `tiles` property of each tile source in `style.json` MUST contain a single URL template using the SMP URI scheme:

```
smp://maps.v1/{tile_path_template}
```

The template MUST include the `{z}`, `{x}`, and `{y}` placeholders as defined by the [TileJSON specification](https://github.com/mapbox/tilejson-spec). The rest of the path — including the folder structure, source identifier, and file extension — is determined by the implementation and MUST match the actual file paths in the archive.

Example:

```json
"tiles": ["smp://maps.v1/s/0/{z}/{x}/{y}.mvt.gz"]
```

### 5.6 Source Metadata

Each tile source in `style.json` MUST include:

- `bounds` — Bounding box `[west, south, east, north]`
- `minzoom` — Minimum zoom level (non-negative integer)
- `maxzoom` — Maximum zoom level (positive integer)
- `tiles` — Array containing exactly one SMP URI template

## 6. Fonts (Glyphs)

### 6.1 Glyph File Paths

Glyph files may follow any path pattern within the archive, as long as the paths match the URL template specified in the `glyphs` property in `style.json` (see [Section 6.3](#63-glyph-uri-template)). It is RECOMMENDED to use `fonts` as the top-level folder name for glyph files (e.g. `fonts/{fontstack}/{range}.pbf.gz`).

Each glyph file corresponds to a Unicode range in the format `{start}-{end}` where:

- `start` is a multiple of 256 (0, 256, 512, ...)
- `end` is `start + 255`
- The full range is 0-255 through 65280-65535

### 6.2 Glyph Encoding

Glyph files MUST be gzip-compressed [Protocol Buffer](https://protobuf.dev/) files using the [Mapbox GL glyph protobuf schema](https://github.com/mapbox/node-fontnik/blob/master/proto/glyphs.proto).

### 6.3 Glyph URI Template

The `style.json` `glyphs` property MUST use an SMP URI template that includes `{fontstack}` and `{range}` placeholders, as required by the [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/glyphs/). The rest of the path is determined by the implementation and MUST match the actual file paths in the archive.

Example:

```
smp://maps.v1/fonts/{fontstack}/{range}.pbf.gz
```

### 6.4 Font Stack Replacement

When multiple fonts are specified in a `text-font` property (a "font stack"), implementations SHOULD replace the font stack with a single font, selecting the first available font from the stack. If no font in the stack is available, the first font provided SHOULD be used as a fallback.

### 6.5 Unicode Ranges

If a style references glyphs, the archive SHOULD include all Unicode ranges that are referenced by the text content in the tile data for each font. Including all 256 Unicode ranges (0-255 through 65280-65535) for each font is RECOMMENDED to ensure complete glyph coverage.

## 7. Sprites

### 7.1 Sprite File Paths

Sprite files may follow any path pattern within the archive, as long as the base URI (without extension or pixel ratio suffix) matches the `sprite` property in `style.json`. The [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/sprite/) defines how the mapping library resolves sprite URIs by appending a pixel ratio suffix and a file extension.

For each sprite referenced in `style.json`, the following files MUST be present:

```
{base_path}.json    - Sprite layout metadata (1x)
{base_path}.png     - Sprite image (1x)
```

The following files are OPTIONAL but RECOMMENDED:

```
{base_path}@2x.json  - Sprite layout metadata (2x)
{base_path}@2x.png   - Sprite image (2x)
```

Higher pixel ratios (3x, 4x, etc.) MAY also be included using the `@{N}x` suffix convention.

It is RECOMMENDED to use `sprites` as the top-level folder name (e.g. `sprites/{id}/sprite`).

### 7.2 Default Sprite

When `style.json` has a `sprite` property that is a string (not an array), a single sprite set is referenced.

When `style.json` has a `sprite` property that is an array, each element MUST have an `id` and `url` property as defined by the [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/sprite/). Each referenced sprite MUST have corresponding files in the archive.

### 7.3 Sprite URI

The `style.json` `sprite` property MUST use an SMP URI pointing to the sprite base path — without a file extension. MapLibre GL appends the pixel ratio suffix and extension (e.g., `@2x.png`, `.json`) at runtime.

Example:

```
smp://maps.v1/sprites/default/sprite
```

### 7.4 Sprite Completeness

Each sprite referenced in `style.json` MUST have its corresponding `.json` and `.png` files (and any pixel ratio variants referenced) present in the archive.

## 8. GeoJSON Sources

GeoJSON sources with inline data (where the `data` property is a GeoJSON object) MUST be preserved in `style.json`. The GeoJSON data object SHOULD include a `bbox` property (a [GeoJSON bounding box](https://datatracker.ietf.org/doc/html/rfc7946#section-5)).

## 9. Resource Integrity

All resources referenced by SMP URIs in `style.json` MUST be present in the archive. If a URI in `style.json` points to a resource (tile, glyph, sprite) using the `smp://maps.v1/` scheme, the corresponding file MUST exist at the matching path in the ZIP archive.

## 10. Normative References

- [ZIP File Format Specification (APPNOTE.TXT)](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
- [MapLibre Style Specification v8](https://maplibre.org/maplibre-style-spec/)
- [MapLibre Sprite Specification](https://maplibre.org/maplibre-style-spec/sprite/)
- [TileJSON 3.0.0](https://github.com/mapbox/tilejson-spec/tree/master/3.0.0)
- [XYZ / Slippy Map Tile Names (OpenStreetMap)](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames)
- [RFC 2119 — Key words for use in RFCs to Indicate Requirement Levels](https://www.ietf.org/rfc/rfc2119.txt)
- [Mapbox Vector Tile Specification](https://github.com/mapbox/vector-tile-spec)
- [GeoJSON (RFC 7946)](https://datatracker.ietf.org/doc/html/rfc7946)
