import js from '@eslint/js'
import { globalIgnores } from 'eslint/config'
import globals from 'globals'

/** @type {import('eslint').Linter.Config[]} */
export default [
  globalIgnores(['./dist']),
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {},
  },
]
