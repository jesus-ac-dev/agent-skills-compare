import axios from 'axios'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'

dotenv.config()

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

function authHeaders() {
  return GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {}
}

/**
 * Searches for repositories on GitHub based on a query.
 * @param {string} query - The search query.
 * @returns {Promise<Array>} A list of matching repositories.
 */
export async function searchRepos(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`
  try {
    logger.info(`Searching GitHub for: ${query}`)
    const response = await axios.get(url, { headers: authHeaders() })
    return response.data.items
  } catch (error) {
    logger.error('Error searching GitHub:', error.response?.data || error.message)
    throw error
  }
}

/**
 * Fetches a single repo's metadata. Returns the same shape as searchRepos items
 * so callers can pass it directly into the pipeline.
 *
 * @param {string} owner
 * @param {string} name
 * @returns {Promise<object>}
 */
export async function fetchRepoDetails(owner, name) {
  const url = `https://api.github.com/repos/${owner}/${name}`
  const response = await axios.get(url, { headers: authHeaders() })
  return response.data
}

/**
 * Parses a GitHub repo URL like https://github.com/owner/name into { owner, name }.
 */
export function parseRepoUrl(repoUrl) {
  const match = String(repoUrl).match(/github\.com\/([^/]+)\/([^/?#]+)/)
  if (!match) throw new Error(`Cannot parse owner/name from URL: ${repoUrl}`)
  return { owner: match[1], name: match[2].replace(/\.git$/, '') }
}

// Simple CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const query = process.argv[2] || 'agent skills'
  searchRepos(query)
    .then((repos) => {
      logger.info(`Found ${repos.length} repositories.`)
      repos.slice(0, 5).forEach((repo) => {
        console.log(
          `- ${repo.full_name} (${repo.stargazers_count} stars): ${repo.html_url} (Avatar: ${repo.owner.avatar_url})`
        )
      })
    })
    .catch((err) => logger.error(err))
}
