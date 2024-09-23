import type {
  StyleSpecification,
  ValidationError,
} from '@maplibre/maplibre-gl-style-spec'
import type { Readable } from 'stream'

export type VectorTileSource = {
  type: 'vector'
  url?: string
  tiles?: Array<string>
  bounds?: [number, number, number, number]
  scheme?: 'xyz' | 'tms'
  minzoom?: number
  maxzoom?: number
}
export type RasterTileSource = {
  type: 'raster'
  url?: string
  tiles?: Array<string>
  bounds?: [number, number, number, number]
  minzoom?: number
  maxzoom?: number
  tileSize?: number
  scheme?: 'xyz' | 'tms'
}

export type TileSource = VectorTileSource | RasterTileSource

export interface ValidateStyle {
  (style: unknown): style is StyleSpecification
  errors: Array<ValidationError>
}

export interface DownloadStream extends Readable {
  iterator(
    ...args: Parameters<Readable['iterator']>
  ): AsyncIterableIterator<Buffer>
  [Symbol.asyncIterator](): AsyncIterableIterator<Buffer>
}
