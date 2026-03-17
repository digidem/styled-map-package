import { describe, expect, test, vi } from 'vitest'

import { runView } from '../../lib/commands/view.js'

describe('runView', () => {
  function makeDeps(overrides = {}) {
    return {
      Reader: vi.fn().mockImplementation(() => ({ getStyle: vi.fn() })),
      createServer: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response('tile data')),
      }),
      openApp: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
      readViewerHtml: vi
        .fn()
        .mockResolvedValue(new Uint8Array([60, 104, 116, 109, 108, 62])), // <html>
      listen: vi
        .fn()
        .mockResolvedValue('http://127.0.0.1:3000'),
      ...overrides,
    }
  }

  test('creates reader with filepath', async () => {
    const deps = makeDeps()

    await runView({ port: 3000, filepath: 'test.smp' }, deps)

    expect(deps.Reader).toHaveBeenCalledWith('test.smp')
  })

  test('creates server with /map base', async () => {
    const deps = makeDeps()

    await runView({ port: 3000, filepath: 'test.smp' }, deps)

    expect(deps.createServer).toHaveBeenCalledWith({ base: '/map' })
  })

  test('logs server address', async () => {
    const deps = makeDeps()

    await runView({ port: 3000, filepath: 'test.smp' }, deps)

    expect(deps.log).toHaveBeenCalledWith(
      'server listening on http://127.0.0.1:3000',
    )
  })

  test('returns the server address', async () => {
    const deps = makeDeps()

    const address = await runView(
      { port: 3000, filepath: 'test.smp' },
      deps,
    )

    expect(address).toBe('http://127.0.0.1:3000')
  })

  test('opens browser when open option is true', async () => {
    const deps = makeDeps()

    await runView({ port: 3000, filepath: 'test.smp', open: true }, deps)

    expect(deps.openApp).toHaveBeenCalledWith('http://127.0.0.1:3000')
  })

  test('does not open browser by default', async () => {
    const deps = makeDeps()

    await runView({ port: 3000, filepath: 'test.smp' }, deps)

    expect(deps.openApp).not.toHaveBeenCalled()
  })

  test('passes port to listen', async () => {
    const deps = makeDeps()

    await runView({ port: 8080, filepath: 'test.smp' }, deps)

    expect(deps.listen).toHaveBeenCalledWith(8080, expect.any(Function))
  })

  test('handler serves HTML at /', async () => {
    const deps = makeDeps()
    const htmlBytes = new Uint8Array([60, 104, 62]) // <h>
    deps.readViewerHtml.mockResolvedValue(htmlBytes)

    // Capture the handler passed to listen
    deps.listen.mockImplementation(async (_port, handler) => {
      const req = new Request('http://localhost:3000/')
      const res = await handler(req)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('text/html')
      expect(res.headers.get('Content-Length')).toBe('3')
      return 'http://127.0.0.1:3000'
    })

    await runView({ port: 3000, filepath: 'test.smp' }, deps)
  })

  test('handler delegates /map/* to smpServer', async () => {
    const deps = makeDeps()
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('tile'))
    deps.createServer.mockReturnValue({ fetch: mockFetch })

    deps.listen.mockImplementation(async (_port, handler) => {
      const req = new Request('http://localhost:3000/map/style.json')
      await handler(req)
      expect(mockFetch).toHaveBeenCalledWith(req, expect.anything())
      return 'http://127.0.0.1:3000'
    })

    await runView({ port: 3000, filepath: 'test.smp' }, deps)
  })

  test('handler returns 404 for unknown paths', async () => {
    const deps = makeDeps()

    deps.listen.mockImplementation(async (_port, handler) => {
      const req = new Request('http://localhost:3000/unknown')
      const res = await handler(req)
      expect(res.status).toBe(404)
      return 'http://127.0.0.1:3000'
    })

    await runView({ port: 3000, filepath: 'test.smp' }, deps)
  })
})
