/**
 * Classify a file path into a high-level "kind" used to pick the right
 * classifier prompt, plus a fine-grained file_type name for the BD column.
 *
 * Keep this list tight — the classifier only cares about the broad kind
 * (markdown vs code vs config). file_types in the BD seed should match
 * the names returned here.
 */

const EXT_TO_FILE_TYPE = {
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.html': 'html',
  '.htm': 'html',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.txt': 'prompt'
}

const FILE_TYPE_TO_KIND = {
  markdown: 'markdown',
  javascript: 'code',
  typescript: 'code',
  python: 'code',
  shell: 'code',
  json: 'config',
  yaml: 'config',
  html: 'markdown', // close enough; HTML is mostly prose for our purposes
  prompt: 'prompt',
  text: 'text'
}

function getExt(path) {
  const lower = String(path ?? '').toLowerCase()
  const lastDot = lower.lastIndexOf('.')
  if (lastDot < 0) return ''
  return lower.slice(lastDot)
}

/**
 * @param {string} path - File path (e.g. "src/foo/bar.ts").
 * @returns {'markdown' | 'code' | 'config' | 'prompt' | 'text'}
 */
export function detectFileKind(path) {
  return FILE_TYPE_TO_KIND[detectFileTypeName(path)] ?? 'text'
}

/**
 * @param {string} path
 * @returns {string} One of the names seeded in the `file_types` table.
 */
export function detectFileTypeName(path) {
  const ext = getExt(path)
  return EXT_TO_FILE_TYPE[ext] ?? 'text'
}
