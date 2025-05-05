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
  },
  {
    // Publishing code that uses default exports can affect usage of the published module.
    // See https://github.com/digidem/styled-map-package/pull/45 for more context.
    name: 'no default exports in source',
    files: ['lib/**/*.js'],
    rules: {
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
    },
  },
]
