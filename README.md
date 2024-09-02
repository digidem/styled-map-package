# Styled Map Package

A Styled Map Package (`.smp`) file is a Zip archive containing all the resources needed to serve a Maplibre vector styled map offline. This includes the style JSON, vector and raster tiles, glyphs (fonts), the sprite image, and the sprite metadata.

## Usage

```sh
smp download  --bbox '-180,-80,180,80' -z 5 https://demotiles.maplibre.org/style.json -o demotiles.smp
```

```sh
smp serve demotiles.smp -o
```
