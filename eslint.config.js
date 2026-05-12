import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'
import neostandard from 'neostandard'
import globals from 'globals'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const neoConfigs = neostandard({
  noStyle: true,
  globals: {
    ...globals.node,
    ...globals.es2024
  }
}).map((c) => ({
  ...c,
  files: ['**/*.{js,mjs,cjs}']
}))

const nextConfigs = compat.config({ extends: ['next/core-web-vitals'] }).map((c) => ({
  ...c,
  files: ['**/*.{ts,tsx}']
}))

export default [
  {
    ignores: [
      'node_modules/**',
      'supabase/.branches/**',
      'supabase/.temp/**',
      'src/lib/supabase/types.ts',
      'coverage/**',
      '.next/**',
      'next-env.d.ts'
    ]
  },
  ...neoConfigs,
  ...nextConfigs
]
