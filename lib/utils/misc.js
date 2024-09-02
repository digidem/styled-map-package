/**
 * Dumb and quick clone an object. Won't keep undefined properties. Types could
 * be tighted so that return type excludes undefined properties, but not really
 * needed.
 *
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

export function noop() {}
