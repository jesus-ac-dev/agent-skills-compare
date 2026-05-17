import axios from 'axios'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'
import { detectFileKind } from '../utils/fileKind.js'

dotenv.config()

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

/**
 * Fetches a single file content from a GitHub repository.
 * @param {string} owner - Repo owner.
 * @param {string} repo - Repo name.
 * @param {string} path - File path.
 * @returns {Promise<string>} File content.
 */
export async function fetchFile(owner, repo, path) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`

  const headers = { Accept: 'application/vnd.github.v3.raw' }
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`
  }

  try {
    // responseType:'text' + identity transformResponse prevents axios from
    // auto-parsing JSON files (e.g. marketplace.json) into Objects, which
    // would then break generateHash() expecting a string/Buffer.
    const response = await axios.get(url, {
      headers,
      responseType: 'text',
      transformResponse: [(data) => data]
    })
    return typeof response.data === 'string' ? response.data : String(response.data ?? '')
  } catch (error) {
    if (error.response?.status === 404) {
      logger.warn(`File not found: ${path} in ${owner}/${repo}`)
      return null
    }
    logger.error(`Error fetching file ${path}:`, error.message)
    throw error
  }
}

/**
 * Lists files in a repository recursively using the Git Trees API.
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 */
export async function listFilesRecursive(owner, repo, branch = 'main') {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`

  const headers = {}
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`
  }

  try {
    const response = await axios.get(url, { headers })
    return response.data.tree.filter((item) => item.type === 'blob').map((item) => item.path)
  } catch (error) {
    // Fallback to trying 'master' if 'main' fails, without logging a false
    // error when the fallback succeeds.
    if (branch === 'main') {
      return listFilesRecursive(owner, repo, 'master')
    }
    logger.error(`Error listing files in ${owner}/${repo} (${branch}):`, error.message)
    throw error
  }
}

const BINARY_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.exe',
  '.bin',
  '.pyc',
  '.node',
  '.dll',
  '.so',
  '.dylib',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.ico'
]

// Directories that essentially never contain agentic artefacts we care about.
// Matched as a path segment (so 'dist' won't match 'distributed/').
const NOISE_DIR_SEGMENTS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'vendor',
  '__pycache__',
  'target',
  'test-fixtures',
  '__snapshots__',
  '.git',
  // Test infrastructure: a project's tests describe how it tests itself,
  // not the agentic skill / workflow / prompt we want to learn from.
  // Keeping product code (cline-style agent loops) but dropping anything
  // under a test directory.
  'tests',
  'test',
  '__tests__',
  '__test__',
  'spec',
  'e2e',
  'cypress',
  'playwright'
]

// Filename-level blocklist (matched against basename, case-insensitive).
const NAME_BLOCKLIST = [
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
  /^pnpm-lock\.yaml$/i,
  /^licen[cs]e(\..+)?$/i,
  /^changelog(\..+)?$/i,
  /^contributing(\..+)?$/i,
  /^code_of_conduct(\..+)?$/i,
  /^\.gitignore$/i,
  /^\.editorconfig$/i,
  /^\.prettierrc.*$/i,
  /^\.eslintrc.*$/i,
  /^tsconfig.*\.json$/i,
  /^tailwind\.config\..+$/i,
  /^vite\.config\..+$/i,
  /\.lock$/i,
  /\.min\.js$/i,
  /\.map$/i,
  /\.snap$/i,
  // Test/spec filenames in any directory (catches *.test.ts, foo.spec.py, etc.)
  /\.(test|spec)\.[a-z0-9]+$/i
]

// Paths that whitelist non-markdown/non-code files (config + prompt) as
// agentic-relevant even when their kind would normally be rejected.
const AGENTIC_PATH_MARKERS = [
  /(^|\/)\.claude\//i,
  /(^|\/)\.codex\//i,
  /(^|\/)\.cursor\//i,
  /(^|\/)\.opencode\//i,
  /(^|\/)agents?\//i,
  /(^|\/)skills?\//i,
  /(^|\/)prompts?\//i,
  /(^|\/)plugins?\//i,
  /(^|\/)hooks?\//i,
  /(^|\/)mcp\//i
]

// Config filenames that ARE the agentic artefact themselves (registration manifests).
const AGENTIC_CONFIG_FILENAMES = new Set([
  'mcp.json',
  'plugin.json',
  'marketplace.json',
  'manifest.json',
  'agent.json',
  'claude_plugin.json'
])

function basename(path) {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

function hasExtension(path) {
  const name = basename(path)
  return name.includes('.') && !name.startsWith('.') ? true : /\.[a-z0-9]+$/i.test(name)
}

function isInAgenticPath(path) {
  return AGENTIC_PATH_MARKERS.some((re) => re.test(path))
}

/**
 * Decides whether a single file path is worth sending to the LLM. Layered:
 *   A) drop noise directories (node_modules, dist, ...)
 *   B) drop name blocklist (lockfiles, LICENSE, tsconfig, ...)
 *   C) reject by file-kind unless rescued by an agentic-path marker:
 *      - markdown/code → keep
 *      - config       → keep only if in agentic path OR filename is a known manifest
 *      - prompt (.txt)→ keep only if in agentic path
 *      - text/unknown → drop
 *   D) drop extension-less paths (submodule refs, ill-formed entries)
 *   E) drop binaries (existing behaviour)
 */
export function isAgenticRelevant(path) {
  if (!path || typeof path !== 'string') return false
  const lower = path.toLowerCase()

  if (BINARY_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false

  const segments = path.split('/')
  if (segments.some((seg) => NOISE_DIR_SEGMENTS.includes(seg))) return false

  const name = basename(path)
  if (NAME_BLOCKLIST.some((re) => re.test(name))) return false

  if (!hasExtension(path)) return false

  const kind = detectFileKind(path)
  switch (kind) {
    case 'markdown':
    case 'code':
      return true
    case 'config':
      return AGENTIC_CONFIG_FILENAMES.has(name.toLowerCase()) || isInAgenticPath(path)
    case 'prompt':
      return isInAgenticPath(path)
    case 'text':
    default:
      return false
  }
}

/**
 * Filters a list of file paths down to those worth analysing.
 * @param {Array<string>} files
 */
export function filterRelevantFiles(files) {
  return files.filter(isAgenticRelevant)
}
