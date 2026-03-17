# Styled Map Package

A Styled Map Package (`.smp`) file is a Zip archive containing all the resources needed to serve a Maplibre vector styled map offline. This includes the style JSON, vector and raster tiles, glyphs (fonts), the sprite image, and the sprite metadata.

## Packages

This monorepo contains two packages:

| Package                                   | Description                                                   |
| ----------------------------------------- | ------------------------------------------------------------- |
| [`styled-map-package`](packages/cli/)     | CLI for creating, viewing, and converting `.smp` files        |
| [`styled-map-package-api`](packages/api/) | JavaScript API for reading, writing, and serving `.smp` files |

## Quick start

Install the CLI globally:

```sh
npm install --global styled-map-package
```

Download an online map to a `.smp` file:

```sh
smp download https://demotiles.maplibre.org/style.json \
  --bbox '-180,-80,180,80' \
  --zoom 5 \
  --output demotiles.smp
```

Preview in a browser:

```sh
smp view demotiles.smp --open
```

Or use the API programmatically:

```sh
npm install styled-map-package-api
```

```js
import { Reader } from 'styled-map-package-api/reader'
import { createServer } from 'styled-map-package-api/server'

const reader = new Reader('demotiles.smp')
const server = createServer()
// server.fetch(request, reader) returns a WHATWG Response
```

## File format specification

See [spec/1.0/](spec/1.0/).

## License

MIT
