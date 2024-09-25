import assert from 'node:assert/strict'

const PRECISION = 1e-6

/**
 * Assert that two bounding boxes are equal within 6 decimal places.
 * @param {number[]} actual
 * @param {number[]} expected
 * @param {string} msg
 */
export function assertBboxEqual(actual, expected, msg) {
  assert.equal(actual.length, expected.length, `${msg}: length`)
  for (let i = 0; i < actual.length; i++) {
    assert(
      Math.abs(actual[i] - expected[i]) < PRECISION,
      `${msg}:\n    ${actual[i]} - ${expected[i]} > ${PRECISION}`,
    )
  }
}
