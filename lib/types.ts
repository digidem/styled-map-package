import type {
  SourceSpecification,
  StyleSpecification,
  ValidationError,
  GeoJSONSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec'
import type { GeoJSON } from 'geojson'
import type { Readable } from 'stream'
import type { Except, SetRequired, Simplify } from 'type-fest'

import { SUPPORTED_SOURCE_TYPES } from './writer.js'

export type InputSource = Extract<
  SourceSpecification,
  { type: (typeof SUPPORTED_SOURCE_TYPES)[number] }
>
export type SMPSource = TransformInputSource<InputSource>

export type TransformInputSource<T extends InputSource> =
  T extends GeoJSONSourceSpecification
    ? Omit<T, 'data'> & {
        // A geojson source in an SMP cannot reference a URL, data must be inlined.
        data: SetRequiredIfPresent<GeoJSON, 'bbox'>
      }
    : T extends RasterTileSource | VectorTileSource
      ? SetRequired<
          OmitUnion<T, 'url'>,
          'tiles' | 'bounds' | 'minzoom' | 'maxzoom'
        >
      : never

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

export type RequiredUnion<T> = T extends any ? Required<T> : never
export type OmitUnion<T, K extends keyof any> = T extends unknown
  ? Omit<T, K>
  : never

type SetRequiredIfPresent<
  BaseType,
  Keys extends keyof any,
> = BaseType extends unknown
  ? Keys extends keyof BaseType
    ? Simplify<
        // Pick just the keys that are optional from the base type.
        Except<BaseType, Keys> &
          // Pick the keys that should be required from the base type and make them required.
          Required<Pick<BaseType, Keys>>
      >
    : never
  : never
