import { searchRepos } from './github/searchRepos.js'
import { listFilesRecursive, filterRelevantFiles, fetchFile } from './github/fetchFiles.js'
import { extractUseCases } from './analysis/extractUseCases.js'
import { classifyProject } from './analysis/classifyProject.js'
import { generateHash } from './utils/hash.js'
import logger from './utils/logger.js'
import { supabase } from './db/supabaseClient.js'

/**
 * Helper to get ID from lookup tables.
 */
async function getLookupId(table, name) {
  if (!name) return null
  const { data, error } = await supabase.from(table).select('id').ilike('name', name).single()

  if (error) {
    logger.debug(`Lookup failed for ${name} in ${table}: ${error.message}`)
    return null
  }
  return data.id
}

/**
 * Helper to get or create sub-category ID.
 */
async function getOrCreateSubCategoryId(categoryName, subCategoryName) {
  if (!categoryName || !subCategoryName) return null
  const categoryId = await getLookupId('categories', categoryName)
  if (!categoryId) return null

  const { data, error } = await supabase
    .from('sub_categories')
    .upsert({ name: subCategoryName, category_id: categoryId }, { onConflict: 'name,category_id' })
    .select('id')
    .single()

  if (error) {
    logger.error(`Error saving sub-category ${subCategoryName}:`, error.message)
    return null
  }
  return data.id
}

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

    // Process one repository at a time as requested
    for (const repo of repos) {
      logger.info(`Processing repository: ${repo.full_name}`)

      // 2. Save/Update repository in DB
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

      // Process all relevant files in the repository
      for (const filePath of relevantFiles) {
        logger.info(`Processing file: ${filePath}`)

        // 4. Fetch file content
        const content = await fetchFile(repo.owner.login, repo.name, filePath)
        if (!content) continue

        const contentHash = generateHash(content)

        // 5. Save file_source in DB
        const branch = repo.default_branch || 'main'
        const fileUrl = `${repo.html_url}/blob/${branch}/${filePath}`

        const sourceTypeId = await getLookupId('source_types', 'github_file')
        const fileTypeId = filePath.endsWith('.md')
          ? await getLookupId('file_types', 'markdown')
          : await getLookupId('file_types', 'text')

        const { data: dbFileSource, error: fileSourceError } = await supabase
          .from('files_sources')
          .upsert(
            {
              repo_id: dbRepo.id,
              url: fileUrl,
              path: filePath,
              hash: contentHash,
              source_type_id: sourceTypeId,
              file_type_id: fileTypeId,
              status: 'processed',
              last_checked: new Date().toISOString()
            },
            { onConflict: 'url' }
          )
          .select()
          .single()

        if (fileSourceError) {
          logger.error(`Error saving file_source ${filePath}:`, fileSourceError.message)
          continue
        }

        // 6. Analyze with Gemini
        try {
          const useCases = await extractUseCases(content)
          const classification = await classifyProject(content)

          const subCategoryId = await getOrCreateSubCategoryId(
            classification.category,
            classification.sub_category
          )
          const classId = await getLookupId('classes', classification.class)

          // 7. Save analysis in DB
          const { error: analysisError } = await supabase.from('analysis').insert({
            file_source_id: dbFileSource.id,
            summary: classification.summary,
            use_cases: useCases,
            sub_category_id: subCategoryId,
            class_id: classId,
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

      // After finishing one repo completely, we can decide if we want to continue to the next
      // The requirement was "para um repo de cada vez", which I interpret as finishing one fully.
      // If the user wants ONLY one repo per execution, I could break here.
      // But usually "one at a time" means serial processing. I'll leave it as a loop for now.
      // logger.info(`Finished processing repository: ${repo.full_name}`)
    }

    logger.info('Pipeline completed successfully.')
  } catch (error) {
    logger.error('Pipeline failed:', error.message)
  }
}

main()
