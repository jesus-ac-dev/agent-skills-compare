import axios from 'axios'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'

dotenv.config()

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

/**
 * Searches for repositories on GitHub based on a query.
 * @param {string} query - The search query.
 * @returns {Promise<Array>} A list of matching repositories.
 */
export async function searchRepos(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`

  const headers = {}
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`
  }

  try {
    logger.info(`Searching GitHub for: ${query}`)
    const response = await axios.get(url, { headers })
    return response.data.items
  } catch (error) {
    logger.error('Error searching GitHub:', error.response?.data || error.message)
    throw error
  }
}

// Simple CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const query = process.argv[2] || 'agent skills'
  searchRepos(query)
    .then((repos) => {
      logger.info(`Found ${repos.length} repositories.`)
      repos.slice(0, 5).forEach((repo) => {
        console.log(`- ${repo.full_name} (${repo.stargazers_count} stars): ${repo.html_url}`)
      })
    })
    .catch((err) => logger.error(err))
}
