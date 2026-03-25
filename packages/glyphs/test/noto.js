import { describe, expect, test, vi } from 'vitest'

import fs from 'node:fs'

import { notoGlyphFallback } from '../lib/noto.js'

describe('notoGlyphFallback', () => {
  test('returns gzipped PBF with correct headers for a known range', () => {
    const response = notoGlyphFallback('Any Font', '0-255')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/x-protobuf')
    expect(response.headers.get('Content-Encoding')).toBe('gzip')
    expect(Number(response.headers.get('Content-Length'))).toBeGreaterThan(20)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=604800')
  })

  test('returns non-empty body for known range', async () => {
    const response = notoGlyphFallback('Any Font', '0-255')
    const body = await response.arrayBuffer()
    expect(body.byteLength).toBeGreaterThan(20)
    expect(body.byteLength).toBe(Number(response.headers.get('Content-Length')))
  })

  test('known range body is larger than empty fallback', async () => {
    const known = notoGlyphFallback('Any Font', '0-255')
    const unknown = notoGlyphFallback('Any Font', '60000-60255')
    const knownBody = await known.arrayBuffer()
    const unknownBody = await unknown.arrayBuffer()
    expect(knownBody.byteLength).toBeGreaterThan(unknownBody.byteLength)
  })

  test('returns empty gzipped PBF for unknown range', () => {
    const response = notoGlyphFallback('Any Font', '60000-60255')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/x-protobuf')
    expect(response.headers.get('Content-Encoding')).toBe('gzip')
    // Empty gzip is 20 bytes
    expect(Number(response.headers.get('Content-Length'))).toBe(20)
  })

  test('returns empty gzipped PBF for CJK range (excluded)', () => {
    // CJK Unified Ideographs range — excluded from bundle,
    // MapLibre renders these client-side
    const response = notoGlyphFallback('Noto Sans', '19968-20223')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Encoding')).toBe('gzip')
    expect(Number(response.headers.get('Content-Length'))).toBe(20)
  })

  test('ignores fontstack parameter', () => {
    const r1 = notoGlyphFallback('Noto Sans Regular', '0-255')
    const r2 = notoGlyphFallback('Comic Sans', '0-255')
    expect(Number(r1.headers.get('Content-Length'))).toBe(
      Number(r2.headers.get('Content-Length')),
    )
  })

  test('caches PBF reads', () => {
    const spy = vi.spyOn(fs, 'readFileSync')
    // Use a range not yet accessed by other tests
    notoGlyphFallback('Font', '768-1023')
    notoGlyphFallback('Font', '768-1023')
    // readFileSync should only be called once — second call hits cache
    const calls = spy.mock.calls.filter((c) =>
      String(c[0]).includes('768-1023'),
    )
    expect(calls).toHaveLength(1)
    spy.mockRestore()
  })
})
