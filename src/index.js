import { searchRepos, fetchRepoDetails, parseRepoUrl } from './github/searchRepos.js'
import { listFilesRecursive, filterRelevantFiles, fetchFile } from './github/fetchFiles.js'
import { classifyProject } from './analysis/classifyProject.js'
import { GroqDailyQuotaError } from './analysis/providers/groqProvider.js'
import { getActiveProvider } from './analysis/providers/factory.js'
import { generateHash } from './utils/hash.js'
import logger from './utils/logger.js'
import { supabase } from './db/supabaseClient.js'
import { resolveClosedId, upsertOpenId } from './db/lookups.js'
import { seedCuratedRepos } from './seed/curatedRepos.js'

async function setRepoStatus(repoId, patch) {
  const { error } = await supabase.from('repos').update(patch).eq('id', repoId)
  if (error) logger.error(`Failed to update repo ${repoId} status:`, error.message)
}

async function recordFileError(repoId, message) {
  const { data } = await supabase.from('repos').select('error_count').eq('id', repoId).single()
  const next = (data?.error_count ?? 0) + 1
  await supabase.from('repos').update({ error_count: next, last_error: message }).eq('id', repoId)
}

/**
 * Returns a Set of file URLs that already have a current analysis row for this repo.
 * "Current" = files_sources.hash matches what's in DB (no need to re-check, since we
 * compare against the freshly-computed hash before each Groq call).
 */
async function loadAnalyzedHashes(repoId) {
  const { data, error } = await supabase
    .from('files_sources')
    .select('url, hash, analysis(id)')
    .eq('repo_id', repoId)
  if (error) {
    logger.warn(`loadAnalyzedHashes(${repoId}) error: ${error.message}`)
    return new Map()
  }
  const map = new Map()
  for (const row of data ?? []) {
    if (row.analysis && row.analysis.id != null) {
      map.set(row.url, row.hash)
    }
  }
  return map
}

async function persistClassification(fileSourceId, payload) {
  const {
    summary,
    maturity,
    score,
    class: className,
    domains = [],
    activities = [],
    tags = [],
    use_cases: useCases = []
  } = payload

  const classId = await resolveClosedId('classes', className)

  const { data: analysisRow, error: analysisErr } = await supabase
    .from('analysis')
    .upsert(
      {
        file_source_id: fileSourceId,
        summary,
        use_cases: useCases,
        class_id: classId,
        maturity,
        score,
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
      },
      { onConflict: 'file_source_id' }
    )
    .select('id')
    .single()

  if (analysisErr) throw new Error(`analysis upsert: ${analysisErr.message}`)
  const analysisId = analysisRow.id

  // Wipe previous M2M rows so re-runs don't accumulate stale links.
  await Promise.all([
    supabase.from('analysis_domains').delete().eq('analysis_id', analysisId),
    supabase.from('analysis_activities').delete().eq('analysis_id', analysisId),
    supabase.from('analysis_tags').delete().eq('analysis_id', analysisId)
  ])

  // Domains: prompt steers the classifier to the existing list, but if a new
  // legitimate value comes back (e.g. "marketing"), upsert it instead of dropping.
  for (const domain of domains) {
    const id = await upsertOpenId('domains', domain)
    if (id) {
      await supabase.from('analysis_domains').insert({ analysis_id: analysisId, domain_id: id })
    }
  }

  for (const activity of activities) {
    const id = await upsertOpenId('activities', activity)
    if (id) {
      await supabase
        .from('analysis_activities')
        .insert({ analysis_id: analysisId, activity_id: id })
    }
  }

  for (const tag of tags) {
    const id = await upsertOpenId('tags', tag)
    if (id) {
      await supabase.from('analysis_tags').insert({ analysis_id: analysisId, tag_id: id })
    }
  }
}

/**
 * Processes one repo. Throws GroqDailyQuotaError if the LLM daily quota
 * is exhausted mid-loop — the repo is left as 'processing' so the next run
 * resumes it.
 */
async function processRepo(repo) {
  logger.info(`Processing repository: ${repo.full_name}`)

  const { data: dbRepo, error: repoError } = await supabase
    .from('repos')
    .upsert(
      {
        name: repo.name,
        repo_url: repo.html_url,
        avatar_url: repo.owner.avatar_url,
        stars: repo.stargazers_count,
        last_commit: repo.pushed_at
      },
      { onConflict: 'repo_url' }
    )
    .select('id')
    .single()

  if (repoError) {
    logger.error(`Error saving repo ${repo.full_name}:`, repoError.message)
    return
  }
  const repoId = dbRepo.id

  await setRepoStatus(repoId, {
    status: 'processing',
    error_count: 0,
    last_error: null
  })

  let allFiles
  try {
    allFiles = await listFilesRecursive(repo.owner.login, repo.name)
  } catch (e) {
    logger.error(`Failed to list files for ${repo.full_name}: ${e.message}`)
    await setRepoStatus(repoId, {
      status: 'failed',
      last_error: e.message,
      last_processed_at: new Date().toISOString()
    })
    return
  }

  const relevantFiles = filterRelevantFiles(allFiles)
  logger.info(`Found ${relevantFiles.length} relevant files in ${repo.full_name}.`)

  const analyzedHashes = await loadAnalyzedHashes(repoId)
  const sourceTypeId = await resolveClosedId('source_types', 'github_file')
  const branch = repo.default_branch || 'main'

  let skipped = 0
  for (const filePath of relevantFiles) {
    const fileUrl = `${repo.html_url}/blob/${branch}/${filePath}`
    try {
      const content = await fetchFile(repo.owner.login, repo.name, filePath)
      if (!content) continue
      const hash = generateHash(content)

      // Skip when an analysis already exists for the same content.
      if (analyzedHashes.get(fileUrl) === hash) {
        skipped++
        continue
      }

      logger.info(`Processing file: ${filePath}`)
      const fileTypeId = await resolveClosedId(
        'file_types',
        filePath.endsWith('.md') ? 'markdown' : 'text'
      )

      const { data: fileSource, error: fsError } = await supabase
        .from('files_sources')
        .upsert(
          {
            repo_id: repoId,
            url: fileUrl,
            path: filePath,
            hash,
            source_type_id: sourceTypeId,
            file_type_id: fileTypeId,
            last_checked: new Date().toISOString()
          },
          { onConflict: 'url' }
        )
        .select('id')
        .single()

      if (fsError) throw new Error(`files_sources upsert: ${fsError.message}`)

      const classification = await classifyProject(content)
      await persistClassification(fileSource.id, classification)
    } catch (err) {
      if (err instanceof GroqDailyQuotaError) {
        // Bubble up — repo stays 'processing' for resume on next run.
        await setRepoStatus(repoId, { last_error: err.message })
        throw err
      }
      logger.error(`File failed (${filePath}): ${err.message}`)
      await recordFileError(repoId, `${filePath}: ${err.message}`)
    }
  }

  if (skipped > 0) logger.info(`Skipped ${skipped} unchanged files in ${repo.full_name}.`)

  await setRepoStatus(repoId, {
    status: 'done',
    last_processed_at: new Date().toISOString()
  })
}

/**
 * Returns repos that need work: status='processing' (interrupted runs) first,
 * then status='pending' (newly upserted, not yet started). 'done' and 'failed'
 * are skipped — failures stay sticky until something marks them pending again.
 */
async function findResumableRepos() {
  const { data, error } = await supabase
    .from('repos')
    .select('id, repo_url, name, status')
    .in('status', ['processing', 'pending'])
  if (error) {
    logger.error(`findResumableRepos error: ${error.message}`)
    return []
  }
  // 'processing' first (interrupted runs take priority), then 'pending'.
  return (data ?? []).sort((a, b) => (a.status === 'processing' ? -1 : 1))
}

/**
 * Hydrates a DB repo row into the GitHub-shaped object processRepo expects.
 */
async function hydrateRepoFromDb(dbRepo) {
  const { owner, name } = parseRepoUrl(dbRepo.repo_url)
  return await fetchRepoDetails(owner, name)
}

async function main() {
  const args = process.argv.slice(2)
  const resumeOnly = args.includes('--resume')
  const positional = args.filter((a) => !a.startsWith('--'))
  const query = positional[0] || 'agent skills'

  const provider = await getActiveProvider()
  logger.info(
    resumeOnly
      ? `Starting pipeline (resume-only mode — no new GitHub search; provider: ${provider.name})`
      : `Starting pipeline (query: "${query}", provider: ${provider.name})`
  )

  try {
    // 1. Seed the curated list (skipped in --resume mode per spec).
    if (!resumeOnly) {
      await seedCuratedRepos()
    }

    // 2. Resume any repos that were left mid-flight (includes freshly seeded pending rows).
    const resumable = await findResumableRepos()
    if (resumable.length > 0) {
      logger.info(`Resuming ${resumable.length} repo(s) from previous runs.`)
      for (const dbRepo of resumable) {
        const repo = await hydrateRepoFromDb(dbRepo)
        await processRepo(repo)
      }
    } else if (resumeOnly) {
      logger.info('No resumable repos found — nothing to do.')
    }

    if (resumeOnly) {
      logger.info('Pipeline completed (resume-only).')
      return
    }

    // 3. Fan out to GitHub search for new candidates.
    const repos = await searchRepos(query)
    logger.info(`Found ${repos.length} repositories from search.`)
    for (const repo of repos) {
      await processRepo(repo)
    }

    logger.info('Pipeline completed successfully.')
  } catch (error) {
    if (error instanceof GroqDailyQuotaError) {
      logger.error('Stopping pipeline — LLM daily quota exhausted. Re-run after reset.')
      return
    }
    logger.error('Pipeline failed:', error.message)
    process.exitCode = 1
  }
}

main()
