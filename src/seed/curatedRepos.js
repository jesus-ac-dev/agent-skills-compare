import { readFile } from 'node:fs/promises'
import { supabase } from '../db/supabaseClient.js'
import logger from '../utils/logger.js'

const CONFIG_PATH = new URL('../../config/curated-repos.json', import.meta.url)

const GITHUB_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/

function normaliseGithubUrl(url) {
  const match = GITHUB_URL_RE.exec(url)
  if (!match) return null
  const owner = match[1].toLowerCase()
  const repo = match[2]
  return { repo_url: `https://github.com/${owner}/${repo}`, name: repo }
}

/**
 * Seed the `repos` table with curated URLs that may not surface from search.
 * Idempotent: existing rows are left untouched (ON CONFLICT DO NOTHING).
 *
 * @returns {Promise<{inserted: number, skipped: number, invalid: number}>}
 */
export async function seedCuratedRepos() {
  let raw
  try {
    raw = await readFile(CONFIG_PATH, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn(`No curated-repos.json found at ${CONFIG_PATH.pathname}; skipping seed.`)
      return { inserted: 0, skipped: 0, invalid: 0 }
    }
    throw err
  }

  let entries
  try {
    entries = JSON.parse(raw)
  } catch (err) {
    throw new Error(`curated-repos.json: invalid JSON — ${err.message}`)
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    return { inserted: 0, skipped: 0, invalid: 0 }
  }

  const seen = new Set()
  const rows = []
  let invalid = 0

  for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string') {
      logger.warn(`curated-repos: skipping entry without url: ${JSON.stringify(entry)}`)
      invalid++
      continue
    }
    const normalised = normaliseGithubUrl(entry.url)
    if (!normalised) {
      logger.warn(`curated-repos: skipping invalid GitHub URL: ${entry.url}`)
      invalid++
      continue
    }
    if (seen.has(normalised.repo_url)) continue
    seen.add(normalised.repo_url)
    rows.push({ repo_url: normalised.repo_url, name: normalised.name, status: 'pending' })
  }

  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, invalid }
  }

  const { data, error } = await supabase
    .from('repos')
    .upsert(rows, { onConflict: 'repo_url', ignoreDuplicates: true })
    .select()

  if (error) {
    throw new Error(`curated-repos: supabase upsert failed — ${error.message}`)
  }

  const inserted = data?.length ?? 0
  const skipped = rows.length - inserted

  logger.info(
    `Seeded ${inserted} new curated repos (${skipped} already in DB, ${invalid} invalid skipped).`
  )

  return { inserted, skipped, invalid }
}
