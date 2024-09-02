declare module 'buffer-peek-stream' {
  import { Readable } from 'stream'
  interface BufferPeekStream {
    (): void
    promise(
      readStream: Readable,
      bytes: number,
    ): Promise<[Uint8Array, Readable]>
  }
  const bufferPeekStream: BufferPeekStream
  export = bufferPeekStream
}
