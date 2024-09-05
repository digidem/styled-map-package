# Styled Map Package

A Styled Map Package (`.smp`) file is a Zip archive containing all the resources needed to serve a Maplibre vector styled map offline. This includes the style JSON, vector and raster tiles, glyphs (fonts), the sprite image, and the sprite metadata.

## Usage

Download an online map to a styled map package file, specifying the bounding box (west, south, east, north) and max zoom level.

```sh
smp download https://demotiles.maplibre.org/style.json \
  --bbox '-180,-80,180,80' \
  --zoom 5 \
  --output demotiles.smp
```

Start a server and open in the default browser.

```sh
smp view demotiles.smp --open
```
