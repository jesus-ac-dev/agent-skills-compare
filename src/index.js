import { searchRepos } from './github/searchRepos.js'
import { listFilesRecursive, filterRelevantFiles, fetchFile } from './github/fetchFiles.js'
import { extractUseCases } from './analysis/extractUseCases.js'
import { classifyProject } from './analysis/classifyProject.js'
import { generateHash } from './utils/hash.js'
import logger from './utils/logger.js'
import { supabase } from './db/supabaseClient.js'

/**
 * Main pipeline orchestrator.
 */
async function main() {
  const query = process.argv[2] || 'agent skills'
  logger.info(`Starting pipeline for query: "${query}"`)

  try {
    // 1. Search for repositories
    const repos = await searchRepos(query)
    logger.info(`Found ${repos.length} repositories.`)

    for (const repo of repos.slice(0, 3)) {
      // Limit to 3 for initial run
      logger.info(`Processing repository: ${repo.full_name}`)

      // 2. Save/Update repository in DB
      const { data: dbRepo, error: repoError } = await supabase
        .from('repos')
        .upsert(
          {
            name: repo.name,
            repo_url: repo.html_url,
            stars: repo.stargazers_count,
            last_commit: repo.pushed_at
          },
          { onConflict: 'repo_url' }
        )
        .select()
        .single()

      if (repoError) {
        logger.error(`Error saving repo ${repo.full_name}:`, repoError.message)
        continue
      }

      // 3. List and filter relevant files
      const allFiles = await listFilesRecursive(repo.owner.login, repo.name)
      const relevantFiles = filterRelevantFiles(allFiles)
      logger.info(`Found ${relevantFiles.length} relevant files in ${repo.full_name}.`)

      for (const filePath of relevantFiles.slice(0, 5)) {
        // Limit files per repo
        logger.info(`Processing file: ${filePath}`)

        // 4. Fetch file content
        const content = await fetchFile(repo.owner.login, repo.name, filePath)
        if (!content) continue

        const contentHash = generateHash(content)

        // 5. Save source and file in DB
        // Determine the correct branch for the URL (simplification)
        const branch = repo.default_branch || 'main'
        const { data: dbSource, error: sourceError } = await supabase
          .from('sources')
          .upsert(
            {
              url: `${repo.html_url}/blob/${branch}/${filePath}`,
              type: 'github_file',
              repo_id: dbRepo.id,
              hash: contentHash
            },
            { onConflict: 'url' }
          )
          .select()
          .single()

        if (sourceError) {
          logger.error(`Error saving source ${filePath}:`, sourceError.message)
          continue
        }

        const { data: dbFile, error: fileError } = await supabase
          .from('files')
          .upsert({
            source_id: dbSource.id,
            repo_id: dbRepo.id,
            path: filePath,
            content,
            hash: contentHash,
            type: 'markdown'
          })
          .select()
          .single()

        if (fileError) {
          logger.error(`Error saving file ${filePath}:`, fileError.message)
          continue
        }

        // 6. Analyze with Gemini
        try {
          const useCases = await extractUseCases(content)
          const classification = await classifyProject(content)

          // 7. Save analysis in DB
          const { error: analysisError } = await supabase.from('analysis').insert({
            file_id: dbFile.id,
            summary: classification.summary || 'Summary placeholder',
            use_cases: useCases,
            maturity: classification.maturity,
            score: classification.score,
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
          })

          if (analysisError) {
            logger.error(`Error saving analysis for ${filePath}:`, analysisError.message)
          }
        } catch (analysisErr) {
          logger.error(`Analysis failed for ${filePath}:`, analysisErr.message)
        }
      }
    }

    logger.info('Pipeline completed successfully.')
  } catch (error) {
    logger.error('Pipeline failed:', error.message)
  }
}

main()
