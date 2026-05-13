/**
 * Validate + normalise a GitHub repo URL.
 *
 * Returns `null` if the URL does not look like https://github.com/<owner>/<repo>
 * (rejects trailing path segments like /blob/main/x.md to keep the surface tight).
 * Owner is lowercased to match Supabase's case-sensitive unique constraint
 * on repos.repo_url.
 *
 * @param {string} url
 * @returns {{ repo_url: string, name: string } | null}
 */
export function normaliseGithubUrl(url) {
  if (typeof url !== 'string') return null
  const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/.exec(url.trim())
  if (!match) return null
  const owner = match[1].toLowerCase()
  const repo = match[2]
  return { repo_url: `https://github.com/${owner}/${repo}`, name: repo }
}
