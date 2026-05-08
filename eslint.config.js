import neostandard from 'neostandard'
import globals from 'globals'

export default [
  {
    ignores: [
      'node_modules/**',
      'supabase/.branches/**',
      'supabase/.temp/**',
      'src/lib/supabase/types.ts',
      'coverage/**'
    ]
  },
  ...neostandard({
    noStyle: true,
    globals: {
      ...globals.node,
      ...globals.es2024
    }
  })
]
