/**
 * Node.js file I/O helpers. In the browser project these are replaced via
 * vitest config alias with io.browser.js, which uses @vitest/browser/context.
 */
import fs from 'node:fs/promises'

/**
 * Read a text file. Accepts a path string or URL (file:// or http://).
 * @param {string | URL} url
 * @returns {Promise<string>}
 */
export async function readTextFile(url) {
  return fs.readFile(url, 'utf-8')
}

/**
 * Write a text file.
 * @param {string | URL} url
 * @param {string} content
 */
export async function writeTextFile(url, content) {
  return fs.writeFile(url, content)
}

/**
 * List entries in a directory.
 * @param {string | URL} url
 * @returns {Promise<string[]>}
 */
export async function readdir(url) {
  return fs.readdir(url)
}
