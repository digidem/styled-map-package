export class ENOENT extends Error {
  code = 'ENOENT'
  /** @param {string} path */
  constructor(path) {
    const message = `ENOENT: no such file or directory, open '${path}'`
    super(message)
    this.path = path
  }
}

/**
 * Returns true if the error if because a file is not found. On Windows, some
 * operations like fs.watch() throw an EPERM error rather than ENOENT.
 *
 * @param {unknown} error
 * @returns {error is Error & { code: 'ENOENT' | 'EPERM' }}
 */
export function isFileNotThereError(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'EPERM')
  )
}
