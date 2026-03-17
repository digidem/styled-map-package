import { describe, expect, test, vi } from 'vitest'

import { runMbtiles } from '../../lib/commands/mbtiles.js'

describe('runMbtiles', () => {
  test('calls fromMBTiles with the mbtiles path', async () => {
    const fromMBTiles = vi.fn().mockReturnValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.close()
        },
      }),
    )
    const chunks = []
    const createOutputStream = vi.fn().mockReturnValue(
      new WritableStream({
        write(chunk) {
          chunks.push(chunk)
        },
      }),
    )

    await runMbtiles(
      { mbtilesPath: 'input.mbtiles', output: 'output.smp' },
      { fromMBTiles, createOutputStream },
    )

    expect(fromMBTiles).toHaveBeenCalledWith('input.mbtiles')
    expect(createOutputStream).toHaveBeenCalledWith('output.smp')
    expect(chunks).toHaveLength(1)
  })

  test('passes undefined output when not specified', async () => {
    const fromMBTiles = vi.fn().mockReturnValue(
      new ReadableStream({ start(c) { c.close() } }),
    )
    const createOutputStream = vi
      .fn()
      .mockReturnValue(new WritableStream())

    await runMbtiles(
      { mbtilesPath: 'input.mbtiles', output: undefined },
      { fromMBTiles, createOutputStream },
    )

    expect(createOutputStream).toHaveBeenCalledWith(undefined)
  })

  test('pipes data from source to output', async () => {
    const data = new Uint8Array([10, 20, 30, 40, 50])
    const fromMBTiles = vi.fn().mockReturnValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      }),
    )
    const chunks = []
    const createOutputStream = vi.fn().mockReturnValue(
      new WritableStream({
        write(chunk) {
          chunks.push(chunk)
        },
      }),
    )

    await runMbtiles(
      { mbtilesPath: 'tiles.mbtiles', output: 'map.smp' },
      { fromMBTiles, createOutputStream },
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual(data)
  })
})
