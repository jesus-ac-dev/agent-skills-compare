import { analyzeContent } from './groqClient.js'
import { loadClosedVocabulary } from '../db/lookups.js'

function buildSystemPrompt({ classes, domains }) {
  return `You analyze a single file from a public repository that may contain AI agent skills,
sub-agents, MCP servers, plugins, prompts, hooks, or related artifacts. Classify it and return
ONLY a single JSON object (no prose, no markdown fences) with EXACTLY these keys:
summary, maturity, score, class, domains, activities, tags, use_cases.

Field rules:
- "summary": ONE specific paragraph (≥ 80 chars). Mention concrete things THIS file does — names of
  tools, commands, hooks, or notable behaviors. NEVER write boilerplate like
  "This file describes a skill for..." or "This is a configuration file." Be concrete.
- "maturity": one of "experimental", "stable", "abandoned".
- "score": number 0–10 (quality + relevance).
- "class": pick EXACTLY ONE from this closed list — ${classes.join(', ')}.
- "domains": array, 1+ entries, each MUST be from this closed list — ${domains.join(', ')}.
- "activities": array, 1+ short kebab-case verbs/use-actions (e.g. "code-review", "planning",
  "debugging", "documentation"). Free vocabulary, but stick to lowercase kebab-case.
- "tags": array, 0+ free-form keywords (languages, frameworks, models, libraries:
  "python", "react", "claude-code", "langchain", "postgres"). Lowercase.
- "use_cases": array, 1+ objects of shape {"title": string, "description": string}.

Return ONLY the JSON object.`
}

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
 * Classifies a file with one structured LLM call (Groq, Llama 3.3 70B by default).
 * Returns { summary, maturity, score, class, domains[], activities[], tags[], use_cases[] }.
 */
export async function classifyProject(content) {
  const vocab = await loadClosedVocabulary()
  const schema = buildClassifyResponseSchema(vocab)
  const prompt = buildSystemPrompt(vocab)
  return await analyzeContent(content, prompt, {
    schema,
    temperature: 0.4
  })
}
