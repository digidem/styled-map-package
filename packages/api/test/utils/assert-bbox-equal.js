const PRECISION = 1e-6

/**
 * Assert that two bounding boxes are equal within 6 decimal places.
 * @param {number[]} actual
 * @param {number[]} expected
 * @param {string} msg
 */
export function assertBboxEqual(actual, expected, msg) {
  if (actual.length !== expected.length) {
    throw new Error(`${msg}: length`)
  }
  for (let i = 0; i < actual.length; i++) {
    if (!(Math.abs(actual[i] - expected[i]) < PRECISION)) {
      throw new Error(
        `${msg}:\n    ${actual[i]} - ${expected[i]} > ${PRECISION}`,
      )
    }
  }
}
