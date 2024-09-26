import type {
  SourceSpecification,
  StyleSpecification,
  ValidationError,
  GeoJSONSourceSpecification,
  VectorSourceSpecification,
  RasterSourceSpecification,
  RasterDEMSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec'
import type { GeoJSON } from 'geojson'
import type { Readable } from 'stream'
import type { Except, SetRequired, Simplify } from 'type-fest'

import { SUPPORTED_SOURCE_TYPES } from './writer.js'

export type InputSource = Extract<
  SourceSpecification,
  { type: (typeof SUPPORTED_SOURCE_TYPES)[number] }
>
type TransformInlinedSource<T extends SourceSpecification> =
  T extends GeoJSONSourceSpecification
    ? OmitUnion<T, 'data'> & { data: GeoJSON }
    : T extends
          | VectorSourceSpecification
          | RasterSourceSpecification
          | RasterDEMSourceSpecification
      ? SetRequired<OmitUnion<T, 'url'>, 'tiles'>
      : T
/**
 * This is a slightly stricter version of SourceSpecification that requires
 * sources to be inlined (e.g. no urls to TileJSON or GeoJSON files).
 */
export type InlinedSource = TransformInlinedSource<SourceSpecification>
type SupportedInlinedSource = Extract<
  InlinedSource,
  { type: (typeof SUPPORTED_SOURCE_TYPES)[number] }
>
/**
 * This is a slightly stricter version of StyleSpecification that requires
 * sources to be inlined (e.g. no urls to TileJSON or GeoJSON files).
 */
export type StyleInlinedSources = Omit<StyleSpecification, 'sources'> & {
  sources: {
    [_: string]: InlinedSource
  }
}

export type SMPSource = TransformSMPInputSource<SupportedInlinedSource>
/**
 * This is a slightly stricter version of StyleSpecification that is provided in
 * a Styled Map Package. Tile sources must have tile URLs inlined (they cannot
 * refer to a TileJSON url), and they must have bounds, minzoom, and maxzoom.
 * GeoJSON sources must have inlined GeoJSON (not a URL to a GeoJSON file).
 */
export type SMPStyle = TransformSMPStyle<StyleSpecification>

export type TransformSMPInputSource<T extends SupportedInlinedSource> =
  T extends RasterSourceSpecification | VectorSourceSpecification
    ? SetRequired<T, 'bounds' | 'minzoom' | 'maxzoom'>
    : T

type TransformSMPStyle<T extends StyleSpecification> = Omit<T, 'sources'> & {
  metadata: {
    'smp:bounds': [number, number, number, number]
    'smp:maxzoom': 0
    'smp:sourceFolders': { [_: string]: string }
  }
  sources: {
    [_: string]: SMPSource
  }
}

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
