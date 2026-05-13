import axios from 'axios'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'

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
    logger.error(`Error listing files in ${owner}/${repo}:`, error.message)
    // Fallback to trying 'master' if 'main' fails
    if (branch === 'main') {
      return listFilesRecursive(owner, repo, 'master')
    }
    throw error
  }
}

/**
 * Filters for relevant files based on patterns and extensions.
 * @param {Array<string>} files
 */
export function filterRelevantFiles(files) {
  const binaryExtensions = [
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

  // The user explicitly wants "ALL files" and "no relevant patterns".
  // We only exclude common binary extensions to prevent sending garbage to LLMs.
  return files.filter((file) => {
    const lowerFile = file.toLowerCase()
    const isBinary = binaryExtensions.some((ext) => lowerFile.endsWith(ext))
    // Also ignore common non-source directories if needed, but user said "all files".
    // For now, let's just skip binaries.
    return !isBinary
  })
}
