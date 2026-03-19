import { describe, expect, test, vi } from 'vitest'

import {
  parseBbox,
  parseUrl,
  parseZoom,
  runDownload,
} from '../../lib/commands/download.js'

describe('parseBbox', () => {
  test('parses valid bbox', () => {
    expect(parseBbox('11,47,12,47.5')).toEqual([11, 47, 12, 47.5])
  })

  test('handles spaces around commas', () => {
    expect(parseBbox('11 , 47 , 12 , 47.5')).toEqual([11, 47, 12, 47.5])
  })

  test('parses negative coordinates', () => {
    expect(parseBbox('-180,-80,180,80')).toEqual([-180, -80, 180, 80])
  })

  test('rejects bbox with 3 values', () => {
    expect(() => parseBbox('11,47,12')).toThrow(
      'Bounding box must have 4 values',
    )
  })

  test('rejects bbox with 5 values', () => {
    expect(() => parseBbox('11,47,12,47.5,99')).toThrow(
      'Bounding box must have 4 values',
    )
  })

  test('rejects non-numeric values', () => {
    expect(() => parseBbox('a,b,c,d')).toThrow(
      'Bounding box values must be numbers',
    )
  })
})

describe('parseZoom', () => {
  test('parses valid zoom 0', () => {
    expect(parseZoom('0')).toBe(0)
  })

  test('parses valid zoom 22', () => {
    expect(parseZoom('22')).toBe(22)
  })

  test('parses mid-range zoom', () => {
    expect(parseZoom('5')).toBe(5)
  })

  test('rejects zoom > 22', () => {
    expect(() => parseZoom('25')).toThrow('between 0 and 22')
  })

  test('rejects negative zoom', () => {
    expect(() => parseZoom('-1')).toThrow('between 0 and 22')
  })

  test('rejects non-integer', () => {
    expect(() => parseZoom('abc')).toThrow('between 0 and 22')
  })
})

describe('parseUrl', () => {
  test('parses valid http URL', () => {
    expect(parseUrl('https://example.com/style.json')).toBe(
      'https://example.com/style.json',
    )
  })

  test('normalizes URL', () => {
    const result = parseUrl('https://EXAMPLE.COM/style.json')
    expect(result).toBe('https://example.com/style.json')
  })

  test('rejects invalid URL', () => {
    expect(() => parseUrl('not-a-url')).toThrow()
  })
})

describe('runDownload', () => {
  function makeDeps(overrides = {}) {
    const chunks = []
    return {
      download: vi.fn().mockReturnValue(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
            controller.close()
          },
        }),
      ),
      prompt: {
        input: vi.fn(),
        number: vi.fn(),
      },
      createOutputStream: vi.fn().mockReturnValue(
        new WritableStream({
          write(chunk) {
            chunks.push(chunk)
          },
        }),
      ),
      reporter: vi.fn().mockReturnValue({ write: vi.fn() }),
      isMapboxURL: vi.fn().mockReturnValue(false),
      mapboxApiUrl: 'https://api.mapbox.com',
      isTTY: false,
      ...overrides,
    }
  }

  test('downloads with all args provided (no prompts)', async () => {
    const deps = makeDeps()

    await runDownload(
      {
        styleUrl: 'https://example.com/style.json',
        bbox: [11, 47, 12, 47.5],
        zoom: 5,
        output: 'out.smp',
        token: undefined,
      },
      deps,
    )

    expect(deps.download).toHaveBeenCalledWith(
      expect.objectContaining({
        bbox: [11, 47, 12, 47.5],
        maxzoom: 5,
        styleUrl: 'https://example.com/style.json',
      }),
    )
    expect(deps.prompt.input).not.toHaveBeenCalled()
    expect(deps.prompt.number).not.toHaveBeenCalled()
  })

  test('prompts for missing styleUrl', async () => {
    const deps = makeDeps()
    deps.prompt.input.mockResolvedValue('https://example.com/style.json')

    await runDownload(
      {
        styleUrl: undefined,
        bbox: [11, 47, 12, 47.5],
        zoom: 5,
        output: 'out.smp',
        token: undefined,
      },
      deps,
    )

    expect(deps.prompt.input).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Style URL to download' }),
    )
    expect(deps.download).toHaveBeenCalledWith(
      expect.objectContaining({
        styleUrl: 'https://example.com/style.json',
      }),
    )
  })

  test('prompts for missing bbox', async () => {
    const deps = makeDeps()
    deps.prompt.number
      .mockResolvedValueOnce(11) // west
      .mockResolvedValueOnce(47) // south
      .mockResolvedValueOnce(12) // east
      .mockResolvedValueOnce(47.5) // north

    await runDownload(
      {
        styleUrl: 'https://example.com/style.json',
        bbox: undefined,
        zoom: 5,
        output: 'out.smp',
        token: undefined,
      },
      deps,
    )

    expect(deps.prompt.number).toHaveBeenCalledTimes(4)
    expect(deps.download).toHaveBeenCalledWith(
      expect.objectContaining({ bbox: [11, 47, 12, 47.5] }),
    )
  })

  test('prompts for missing zoom', async () => {
    const deps = makeDeps()
    deps.prompt.number.mockResolvedValueOnce(5)

    await runDownload(
      {
        styleUrl: 'https://example.com/style.json',
        bbox: [11, 47, 12, 47.5],
        zoom: undefined,
        output: 'out.smp',
        token: undefined,
      },
      deps,
    )

    expect(deps.prompt.number).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Max zoom level to download' }),
    )
    expect(deps.download).toHaveBeenCalledWith(
      expect.objectContaining({ maxzoom: 5 }),
    )
  })

  test('prompts for Mapbox token when URL is Mapbox', async () => {
    const deps = makeDeps({ isMapboxURL: vi.fn().mockReturnValue(true) })
    deps.prompt.input.mockResolvedValueOnce('pk.test-token')

    await runDownload(
      {
        styleUrl: 'mapbox://styles/mapbox/streets-v12',
        bbox: [11, 47, 12, 47.5],
        zoom: 5,
        output: 'out.smp',
        token: undefined,
      },
      deps,
    )

    expect(deps.prompt.input).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Mapbox access token' }),
    )
    expect(deps.download).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'pk.test-token' }),
    )
  })

  test('does not prompt for token when already provided', async () => {
    const deps = makeDeps({ isMapboxURL: vi.fn().mockReturnValue(true) })

    await runDownload(
      {
        styleUrl: 'mapbox://styles/mapbox/streets-v12',
        bbox: [11, 47, 12, 47.5],
        zoom: 5,
        output: 'out.smp',
        token: 'pk.existing-token',
      },
      deps,
    )

    expect(deps.prompt.input).not.toHaveBeenCalled()
    expect(deps.download).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'pk.existing-token' }),
    )
  })

  test('appends .smp extension to output if missing', async () => {
    const deps = makeDeps()

    await runDownload(
      {
        styleUrl: 'https://example.com/style.json',
        bbox: [11, 47, 12, 47.5],
        zoom: 5,
        output: 'mymap',
        token: undefined,
      },
      deps,
    )

    expect(deps.createOutputStream).toHaveBeenCalledWith('mymap.smp')
  })

  test('does not double .smp extension', async () => {
    const deps = makeDeps()

    await runDownload(
      {
        styleUrl: 'https://example.com/style.json',
        bbox: [11, 47, 12, 47.5],
        zoom: 5,
        output: 'mymap.smp',
        token: undefined,
      },
      deps,
    )

    expect(deps.createOutputStream).toHaveBeenCalledWith('mymap.smp')
  })

  test('prompts for output when TTY and missing required args', async () => {
    const deps = makeDeps({ isTTY: true })
    deps.prompt.input
      .mockResolvedValueOnce('https://example.com/style.json') // styleUrl prompt
      .mockResolvedValueOnce('my-map') // output prompt
    deps.prompt.number
      .mockResolvedValueOnce(11) // west
      .mockResolvedValueOnce(47) // south
      .mockResolvedValueOnce(12) // east
      .mockResolvedValueOnce(47.5) // north
      .mockResolvedValueOnce(5) // zoom

    await runDownload(
      {
        styleUrl: undefined,
        bbox: undefined,
        zoom: undefined,
        output: undefined,
        token: undefined,
      },
      deps,
    )

    // Should have prompted for output filename
    expect(deps.prompt.input).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Output filename (.smp extension will be added)',
      }),
    )
    expect(deps.createOutputStream).toHaveBeenCalledWith('my-map.smp')
  })
})
