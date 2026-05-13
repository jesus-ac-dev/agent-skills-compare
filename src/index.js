import { searchRepos, fetchRepoDetails, parseRepoUrl } from './github/searchRepos.js'
import { listFilesRecursive, filterRelevantFiles, fetchFile } from './github/fetchFiles.js'
import { classifyProject } from './analysis/classifyProject.js'
import { QuotaError } from './analysis/providers/BaseProvider.js'
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

async function recordFileError(repoId, message, filePath) {
  const { data } = await supabase.from('repos').select('error_count').eq('id', repoId).single()
  const next = (data?.error_count ?? 0) + 1
  await supabase.from('repos').update({ error_count: next, last_error: message }).eq('id', repoId)

  if (filePath) {
    await supabase
      .from('files_sources')
      .update({ status: 'error' })
      .match({ repo_id: repoId, path: filePath })
  }
}

/**
 * Returns maps of URL to hash and Hash to existing analysis for a repo.
 */
async function loadAnalyzedHashes(repoId) {
  const { data, error } = await supabase
    .from('files_sources')
    .select(
      `
      url,
      hash,
      analysis (
        id,
        summary,
        maturity,
        score,
        use_cases,
        classes (name),
        analysis_domains (domains (name)),
        analysis_activities (activities (name)),
        analysis_tags (tags (name))
      )
    `
    )
    .eq('repo_id', repoId)

  if (error) {
    logger.warn(`loadAnalyzedHashes(${repoId}) error: ${error.message}`)
    return { urlToHash: new Map(), hashToAnalysis: new Map() }
  }

  const urlToHash = new Map()
  const hashToAnalysis = new Map()

  for (const row of data ?? []) {
    // analysis comes as an array or object depending on PostgREST
    const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
    if (analysis && analysis.id != null) {
      urlToHash.set(row.url, row.hash)

      if (!hashToAnalysis.has(row.hash)) {
        hashToAnalysis.set(row.hash, {
          summary: analysis.summary,
          maturity: analysis.maturity,
          score: analysis.score,
          use_cases: analysis.use_cases,
          class: analysis.classes?.name,
          domains: (analysis.analysis_domains ?? []).map((d) => d.domains?.name).filter(Boolean),
          activities: (analysis.analysis_activities ?? [])
            .map((a) => a.activities?.name)
            .filter(Boolean),
          tags: (analysis.analysis_tags ?? []).map((t) => t.tags?.name).filter(Boolean)
        })
      }
    }
  }
  return { urlToHash, hashToAnalysis }
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
 * Processes one repo.
 */
export async function processRepo(repo) {
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

  const { urlToHash, hashToAnalysis } = await loadAnalyzedHashes(repoId)
  const sourceTypeId = await resolveClosedId('source_types', 'github_file')
  const branch = repo.default_branch || 'main'

  let skippedCount = 0
  const skippedUrls = []

  for (const filePath of relevantFiles) {
    const fileUrl = `${repo.html_url}/blob/${branch}/${filePath}`
    try {
      const content = await fetchFile(repo.owner.login, repo.name, filePath)
      if (!content) continue
      const hash = generateHash(content)

      // Skip when an analysis already exists for the same content at this URL.
      if (urlToHash.get(fileUrl) === hash) {
        skippedCount++
        skippedUrls.push(fileUrl)
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
            status: 'pending',
            last_checked: new Date().toISOString()
          },
          { onConflict: 'url' }
        )
        .select('id')
        .single()

      if (fsError) throw new Error(`files_sources upsert: ${fsError.message}`)

      const existingAnalysis = hashToAnalysis.get(hash)
      if (existingAnalysis) {
        logger.info(`Reusing existing analysis for duplicate file: ${filePath}`)
        await persistClassification(fileSource.id, existingAnalysis)
        await supabase.from('files_sources').update({ status: 'reused' }).eq('id', fileSource.id)
      } else {
        const classification = await classifyProject(content)
        await persistClassification(fileSource.id, classification)
        await supabase.from('files_sources').update({ status: 'completed' }).eq('id', fileSource.id)

        // Cache it for subsequent files in this repo run
        hashToAnalysis.set(hash, classification)
      }
    } catch (err) {
      if (err instanceof QuotaError) {
        await setRepoStatus(repoId, { last_error: err.message })
        throw err
      }
      logger.error(`File failed (${filePath}): ${err.message}`)
      await recordFileError(repoId, `${filePath}: ${err.message}`, filePath)
    }
  }

  // Bulk update skipped files status (batching to avoid hitting limits)
  if (skippedUrls.length > 0) {
    logger.info(`Skipped ${skippedCount} unchanged files in ${repo.full_name}.`)
    const batchSize = 100
    for (let i = 0; i < skippedUrls.length; i += batchSize) {
      const batch = skippedUrls.slice(i, i + batchSize)
      await supabase
        .from('files_sources')
        .update({ status: 'skipped', last_checked: new Date().toISOString() })
        .in('url', batch)
    }
  }

  await setRepoStatus(repoId, {
    status: 'done',
    last_processed_at: new Date().toISOString()
  })
}

/**
 * Returns repos that need work.
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
  return (data ?? []).sort((a, b) => (a.status === 'processing' ? -1 : 1))
}

/**
 * Hydrates a DB repo row into the GitHub-shaped object.
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
      ? `Starting pipeline (resume-only mode; provider: ${provider.name})`
      : `Starting pipeline (query: "${query}", provider: ${provider.name})`
  )

  try {
    let curatedUrls = []
    if (!resumeOnly) {
      ;({ curatedUrls } = await seedCuratedRepos())
    }

    if (curatedUrls.length > 0) {
      const { data: curatedRows } = await supabase
        .from('repos')
        .select('id, repo_url, name, status')
        .in('repo_url', curatedUrls)
        .in('status', ['pending', 'processing'])

      if (curatedRows && curatedRows.length > 0) {
        const orderMap = new Map(curatedUrls.map((u, i) => [u, i]))
        const ordered = [...curatedRows].sort(
          (a, b) => orderMap.get(a.repo_url) - orderMap.get(b.repo_url)
        )
        logger.info(`Processing ${ordered.length} curated repo(s) with priority.`)
        for (const dbRepo of ordered) {
          const repo = await hydrateRepoFromDb(dbRepo)
          await processRepo(repo)
        }
      }
    }

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

    if (resumeOnly) return

    const repos = await searchRepos(query)
    logger.info(`Found ${repos.length} repositories from search.`)
    for (const repo of repos) {
      await processRepo(repo)
    }

    logger.info('Pipeline completed successfully.')
  } catch (error) {
    if (error instanceof QuotaError) {
      logger.error(`Stopping pipeline — LLM quota exhausted (${error.name}). Re-run after reset.`)
      process.exitCode = 1
      return
    }
    logger.error('Pipeline failed:', error.message)
    process.exitCode = 1
  }
}

main()
