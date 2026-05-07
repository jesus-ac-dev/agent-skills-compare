import axios from 'axios';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

/**
 * Fetches a single file content from a GitHub repository.
 * @param {string} owner - Repo owner.
 * @param {string} repo - Repo name.
 * @param {string} path - File path.
 * @returns {Promise<string>} File content.
 */
export async function fetchFile(owner, repo, path) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const headers = { 'Accept': 'application/vnd.github.v3.raw' };
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  try {
    const response = await axios.get(url, { headers });
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      logger.warn(`File not found: ${path} in ${owner}/${repo}`);
      return null;
    }
    logger.error(`Error fetching file ${path}:`, error.message);
    throw error;
  }
}

/**
 * Lists files in a repository recursively using the Git Trees API.
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 */
export async function listFilesRecursive(owner, repo, branch = 'main') {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

  const headers = {};
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  try {
    const response = await axios.get(url, { headers });
    return response.data.tree
      .filter(item => item.type === 'blob')
      .map(item => item.path);
  } catch (error) {
    logger.error(`Error listing files in ${owner}/${repo}:`, error.message);
    // Fallback to trying 'master' if 'main' fails
    if (branch === 'main') {
        return listFilesRecursive(owner, repo, 'master');
    }
    throw error;
  }
}

/**
 * Filters for relevant files based on patterns and extensions.
 * @param {Array<string>} files
 */
export function filterRelevantFiles(files) {
    const relevantExtensions = ['.md', '.txt'];
    const relevantPatterns = [
        'README',
        'docs/',
        'agents/',
        'skills/',
        'workflows/',
        'examples/',
        '.claude/'
    ];

    return files.filter(file => {
        const lowerFile = file.toLowerCase();
        return (
            relevantExtensions.some(ext => lowerFile.endsWith(ext)) &&
            (relevantPatterns.some(pattern => lowerFile.includes(pattern.toLowerCase())))
        );
    });
}
