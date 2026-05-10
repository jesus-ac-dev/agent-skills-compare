import { searchRepos } from './github/searchRepos.js'
import { listFilesRecursive, filterRelevantFiles, fetchFile } from './github/fetchFiles.js'
import { classifyProject } from './analysis/classifyProject.js'
import { generateHash } from './utils/hash.js'
import logger from './utils/logger.js'
import { supabase } from './db/supabaseClient.js'
import { resolveClosedId, upsertOpenId } from './db/lookups.js'

async function setRepoStatus(repoId, patch) {
  const { error } = await supabase.from('repos').update(patch).eq('id', repoId)
  if (error) logger.error(`Failed to update repo ${repoId} status:`, error.message)
}

async function recordFileError(repoId, message) {
  const { data } = await supabase.from('repos').select('error_count').eq('id', repoId).single()
  const next = (data?.error_count ?? 0) + 1
  await supabase.from('repos').update({ error_count: next, last_error: message }).eq('id', repoId)
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
    const id = await resolveClosedId('domains', domain)
    if (id) {
      await supabase.from('analysis_domains').insert({ analysis_id: analysisId, domain_id: id })
    } else {
      logger.warn(`Unknown domain from classifier: ${domain}`)
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

  const sourceTypeId = await resolveClosedId('source_types', 'github_file')
  const branch = repo.default_branch || 'main'

  for (const filePath of relevantFiles) {
    try {
      logger.info(`Processing file: ${filePath}`)
      const content = await fetchFile(repo.owner.login, repo.name, filePath)
      if (!content) continue

      const fileTypeId = await resolveClosedId(
        'file_types',
        filePath.endsWith('.md') ? 'markdown' : 'text'
      )

      const { data: fileSource, error: fsError } = await supabase
        .from('files_sources')
        .upsert(
          {
            repo_id: repoId,
            url: `${repo.html_url}/blob/${branch}/${filePath}`,
            path: filePath,
            hash: generateHash(content),
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
      logger.error(`File failed (${filePath}): ${err.message}`)
      await recordFileError(repoId, `${filePath}: ${err.message}`)
    }
  }

  await setRepoStatus(repoId, {
    status: 'done',
    last_processed_at: new Date().toISOString()
  })
}

async function main() {
  const query = process.argv[2] || 'agent skills'
  logger.info(`Starting pipeline for query: "${query}"`)
  try {
    const repos = await searchRepos(query)
    logger.info(`Found ${repos.length} repositories.`)
    for (const repo of repos) {
      await processRepo(repo)
    }
    logger.info('Pipeline completed successfully.')
  } catch (error) {
    logger.error('Pipeline failed:', error.message)
  }
}

main()
