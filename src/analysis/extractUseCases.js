import { analyzeContent } from './geminiClient.js'

const USE_CASE_PROMPT = `
Analyze the following documentation and extract a list of use cases.
Return the result as a JSON array of objects, each with 'title' and 'description'.
Example: [{"title": "Example Use Case", "description": "Does something useful."}]
`

/**
 * Extracts use cases from content.
 * @param {string} content
 */
export async function extractUseCases(content) {
  return await analyzeContent(content, USE_CASE_PROMPT)
}
