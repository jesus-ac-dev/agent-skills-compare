import { analyzeContent } from './geminiClient.js'

const CLASSIFY_PROMPT = `
Analyze the following project documentation and classify it.
1. Determine its maturity (experimental, stable, abandoned).
2. Provide a score from 0 to 10 based on quality and relevance.
3. Provide a concise summary of what the project/file is about.
4. Classify it into one of the following CATEGORIES: Iot Engineer, programming-languages, security, data-ai, database, devops.
5. Provide a SUB-CATEGORY (a more specific name within the category).
6. Classify it into one of the following CLASSES: skills, agents, commands, settings, hooks, mcps, plugins, agentic tools.

Return the result as a JSON object:
{
  "maturity": "stable",
  "score": 8.5,
  "summary": "Detailed description of the project.",
  "category": "data-ai",
  "sub_category": "Large Language Models",
  "class": "agents"
}
`

/**
 * Classifies a project based on content.
 * @param {string} content
 */
export async function classifyProject(content) {
  return await analyzeContent(content, CLASSIFY_PROMPT)
}
