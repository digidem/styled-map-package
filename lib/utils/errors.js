export class ENOENT extends Error {
  code = 'ENOENT'
  /** @param {string} path */
  constructor(path) {
    const message = `ENOENT: no such file or directory, open '${path}'`
    super(message)
    this.path = path
  }
}
