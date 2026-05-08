import { analyzeContent } from './geminiClient.js'

const CLASSIFY_PROMPT = `
Analyze the following project documentation and classify it.
Determine its maturity (experimental, stable, abandoned) and provide a score from 0 to 10 based on quality and relevance.
Return the result as a JSON object: {"maturity": "stable", "score": 8.5, "tags": ["mcp", "agent"]}
`

/**
 * Classifies a project based on content.
 * @param {string} content
 */
export async function classifyProject(content) {
  return await analyzeContent(content, CLASSIFY_PROMPT)
}
