/**
 * Browser file I/O helpers. Uses @vitest/browser/context built-in commands
 * (readFile, writeFile) and a custom readdir command for directory listings.
 * All commands execute on the Vitest server (Node.js side).
 */
import { commands } from '@vitest/browser/context'

/**
 * Convert a URL object or string to a path suitable for Vitest server commands.
 *
 * Vite may serve filesystem files with a /@fs/ prefix, in which case the
 * pathname is an absolute filesystem path. Otherwise the pathname is
 * root-relative (e.g. /test/write-read.js → test/write-read.js).
 *
 * Passing an absolute path to commands.readFile/writeFile/readdir still works
 * because path.resolve(root, '/abs/path') === '/abs/path'.
 *
 * @param {string | URL} url
 * @returns {string}
 */
function toServerPath(url) {
  const pathname = new URL(url instanceof URL ? url.href : url).pathname
  // Vite serves files outside the configured root with /@fs/ prefix
  if (pathname.startsWith('/@fs/')) {
    return pathname.slice(4) // strip /@fs → absolute path like /home/user/...
  }
  return pathname.slice(1) // strip leading '/' → root-relative path
}

/**
 * Read a text file.
 * @param {string | URL} url
 * @returns {Promise<string>}
 */
export async function readTextFile(url) {
  // @ts-ignore - commands.readFile is a built-in browser command
  return commands.readFile(toServerPath(url), 'utf-8')
}

/**
 * Write a text file.
 * @param {string | URL} url
 * @param {string} content
 */
export async function writeTextFile(url, content) {
  // @ts-ignore - commands.writeFile is a built-in browser command
  return commands.writeFile(toServerPath(url), content)
}

/**
 * List entries in a directory.
 * @param {string | URL} url
 * @returns {Promise<string[]>}
 */
export async function readdir(url) {
  // @ts-ignore - commands.readdir is a custom browser command
  return commands.readdir(toServerPath(url))
}
