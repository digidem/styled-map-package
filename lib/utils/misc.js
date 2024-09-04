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

/**
 * Like `Object.hasOwn`, but refines the type of `key`.
 *
 * @template {Record<string, unknown>} T
 * @param {T} obj
 * @param {string} key
 * @returns {key is (keyof T)}
 */
export function hasOwn(obj, key) {
  return Object.hasOwn(obj, key)
}
