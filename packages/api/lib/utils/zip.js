import { ZipReader } from '@gmaclennan/zip-reader'

/**
 * @param {unknown} value
 * @returns {value is import('@gmaclennan/zip-reader').RandomAccessSource}
 */
function isRandomAccessSource(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'read' in value &&
    typeof value.read === 'function' &&
    'size' in value &&
    typeof value.size === 'number'
  )
}

/**
 * Duck-typed because a caller's copy of zip-reader may be a different module
 * instance, so `instanceof ZipReader` can fail.
 *
 * @param {unknown} value
 * @returns {value is import('@gmaclennan/zip-reader').ZipReader}
 */
function isZipReader(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  )
}

/**
 * Open a random access source as a ZipReader that accepts deduplicated
 * entries, or return a ZipReader the caller has already opened.
 *
 * @param {import('@gmaclennan/zip-reader').RandomAccessSource | import('@gmaclennan/zip-reader').ZipReader} sourceOrZip
 * @returns {Promise<import('@gmaclennan/zip-reader').ZipReader>}
 */
export async function openZip(sourceOrZip) {
  if (isRandomAccessSource(sourceOrZip)) {
    return ZipReader.from(sourceOrZip, { skipUniqueEntryCheck: true })
  }
  if (isZipReader(sourceOrZip)) return sourceOrZip
  throw Object.assign(
    new TypeError(
      'Expected a file path, a RandomAccessSource (e.g. BlobSource), or a ZipReader',
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  )
}

/**
 * Explain the error zip-reader throws for deduplicated tiles when the caller
 * opened the ZipReader without `skipUniqueEntryCheck`. Other errors are
 * returned unchanged.
 *
 * @param {unknown} error
 * @returns {unknown}
 */
export function explainZipError(error) {
  if (
    !(error instanceof Error) ||
    !error.message.includes('Duplicate local file header offset')
  ) {
    return error
  }
  return new Error(
    'This styled map package stores deduplicated tiles, which ZipReader rejects by default. ' +
      'Pass a RandomAccessSource (e.g. `new BlobSource(file)`) instead of a ZipReader, ' +
      'or open the ZipReader with `{ skipUniqueEntryCheck: true }`.',
    { cause: error },
  )
}
