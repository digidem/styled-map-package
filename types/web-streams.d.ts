/**
 * Augment the global ReadableStream interface to include Node.js 18+ methods,
 * making it compatible with `import('node:stream/web').ReadableStream`.
 */
interface ReadableStream<R = any> {
  values(options?: { preventCancel?: boolean }): AsyncIterableIterator<R>
  [Symbol.asyncIterator](): AsyncIterableIterator<R>
}

interface ReadableStreamConstructor {
  /**
   * Creates a ReadableStream from an async iterable or sync iterable.
   * Available in Node.js 18+.
   */
  from<T>(iterable: AsyncIterable<T> | Iterable<T>): ReadableStream<T>
}

declare var ReadableStream: ReadableStreamConstructor
