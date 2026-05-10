import { analyzeContent } from './geminiClient.js'
import { loadClosedVocabulary } from '../db/lookups.js'

const SYSTEM_PROMPT = `You analyze a single file from a public repository that may contain AI agent skills,
sub-agents, MCP servers, plugins, prompts, hooks, or related artifacts. You must classify it
and produce structured JSON that matches the schema enforced by responseSchema.

Strict rules:
- "summary": ONE specific paragraph (≥ 80 chars). Mention concrete things THIS file does — names of
  tools, commands, hooks, or notable behaviors. NEVER write boilerplate like
  "This file describes a skill for..." or "This is a configuration file." Be concrete.
- "class": Pick exactly ONE artifact type from the enum.
- "domains": Pick 1+ subject-area domains from the enum.
- "activities": 1+ short kebab-case verbs/use-actions (e.g. "code-review", "planning"). Free text.
- "tags": 0+ free-form keywords (languages, frameworks, models, libraries: "python", "react", "claude-code").
- "use_cases": 1+ {title, description} pairs describing realistic ways this file would be used.
- "maturity": one of experimental/stable/abandoned.
- "score": 0–10 quality + relevance.

Return ONLY the JSON object that satisfies the schema.`

export function buildClassifyResponseSchema({ classes, domains }) {
  return {
    type: 'object',
    required: [
      'summary',
      'maturity',
      'score',
      'class',
      'domains',
      'activities',
      'tags',
      'use_cases'
    ],
    properties: {
      summary: { type: 'string', minLength: 80 },
      maturity: { type: 'string', enum: ['experimental', 'stable', 'abandoned'] },
      score: { type: 'number', minimum: 0, maximum: 10 },
      class: { type: 'string', enum: classes },
      domains: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', enum: domains }
      },
      activities: {
        type: 'array',
        minItems: 1,
        items: { type: 'string' }
      },
      tags: {
        type: 'array',
        items: { type: 'string' }
      },
      use_cases: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['title', 'description'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' }
          }
        }
      }
    }
  }
}

/**
 * Classifies a file with one structured Gemini call.
 * Returns { summary, maturity, score, class, domains[], activities[], tags[], use_cases[] }.
 */
export async function classifyProject(content) {
  const vocab = await loadClosedVocabulary()
  const schema = buildClassifyResponseSchema(vocab)
  return await analyzeContent(content, SYSTEM_PROMPT, {
    schema,
    temperature: 0.4
  })
}
